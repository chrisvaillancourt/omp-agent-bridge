import { z } from "zod";
import { BridgeError } from "./process.ts";
import { MODEL } from "./config.ts";

const text = z.string().max(16_000);
export const reviewSchema = z.object({
  summary: text,
  findings: z.array(z.object({
    priority: z.enum(["P0", "P1", "P2", "P3"]), title: text, body: text,
    file: text.min(1), line: z.number().int().positive(),
  }).strict()).max(100),
  limitations: z.array(text).max(100),
}).strict();
export type Review = z.infer<typeof reviewSchema>;
// Claude Code's local validator does not load the draft-2020-12 metaschema.
export const jsonSchema = z.toJSONSchema(reviewSchema, { target: "draft-7" });
const envelopeSchema = z.object({
  type: z.string(), subtype: z.string(), is_error: z.boolean().optional(),
  structured_output: z.unknown().optional(), modelUsage: z.record(z.string(), z.unknown()).optional(),
  permission_denials: z.array(z.unknown()).optional(),
});

export function parseResult(code: number | null, stdout: string): Review {
  let envelope: z.infer<typeof envelopeSchema>;
  try {
    const value: unknown = JSON.parse(stdout);
    if (Array.isArray(value)) {
      const events = z.array(z.object({ type: z.string() }).passthrough()).parse(value);
      if (events.filter((event) => event.type === "result").length !== 1 || events.at(-1)?.type !== "result") throw new Error();
      envelope = envelopeSchema.parse(events.at(-1));
    } else {
      envelope = envelopeSchema.parse(value);
    }
  }
  catch { throw new BridgeError("invalid_result", "Claude returned no valid JSON result."); }
  if (code !== 0 || envelope.type !== "result" || envelope.subtype !== "success" || envelope.is_error !== false) {
    // Never return raw diagnostics, auth metadata, or partial findings.
    if (/rate_limit|usage limit|quota|rate limit/i.test(stdout)) throw new BridgeError("quota_exhausted", "Claude reported a usage limit; the bridge will not retry.");
    throw new BridgeError("review_failed", "Claude did not complete the review successfully. No automatic retry was made.");
  }
  const models = Object.keys(envelope.modelUsage ?? {});
  if (!models.length || models.some((m) => m !== MODEL && !new RegExp(`^${MODEL}-[0-9]{8}$`).test(m))) throw new BridgeError("model_mismatch", "Claude reported an unexpected model. Discarded the result; check usage manually.");
  if (envelope.permission_denials?.length) throw new BridgeError("permission_denied", "Claude encountered denied tools; the review is incomplete.");
  const parsed = reviewSchema.safeParse(envelope.structured_output);
  if (!parsed.success || parsed.data.findings.some((f) => f.file.startsWith("/") || f.file.split(/[\\/]/).includes(".."))) {
    throw new BridgeError("invalid_result", "Claude's structured review did not satisfy the result contract.");
  }
  return parsed.data;
}
