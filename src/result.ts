import { z } from "zod";
import { BridgeError } from "./process.ts";
export const answerSchema = z.object({
  answer: z.string().min(1).max(64_000),
  limitations: z.array(z.string().max(4_000)).max(20),
}).strict();
export type Answer = z.infer<typeof answerSchema>;
// Claude Code's local validator does not load the draft-2020-12 metaschema.
export const jsonSchema = z.toJSONSchema(answerSchema, { target: "draft-7" });
const envelopeSchema = z.object({
  type: z.string(), subtype: z.string(), is_error: z.boolean().optional(),
  structured_output: z.unknown().optional(), modelUsage: z.record(z.string(), z.unknown()).optional(),
  permission_denials: z.array(z.unknown()).optional(),
});

export function parseResult(code: number | null, stdout: string, expectedModel: string): Answer {
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
    // Never return raw diagnostics, auth metadata, or partial answers.
    if (/rate_limit|usage limit|quota|rate limit/i.test(stdout)) throw new BridgeError("quota_exhausted", "Claude reported a usage limit; the bridge will not retry.");
    throw new BridgeError("delegate_failed", "Claude did not complete the task successfully. No automatic retry was made.");
  }
  const models = Object.keys(envelope.modelUsage ?? {});
  if (!models.length || models.some((m) => m !== expectedModel && !(m.startsWith(`${expectedModel}-`) && /^[0-9]{8}$/.test(m.slice(expectedModel.length + 1))))) throw new BridgeError("model_mismatch", "Claude reported an unexpected model. Discarded the result; check usage manually.");
  if (envelope.permission_denials?.length) throw new BridgeError("permission_denied", "Claude encountered denied tools; the task is incomplete.");
  const parsed = answerSchema.safeParse(envelope.structured_output);
  if (!parsed.success) {
    throw new BridgeError("invalid_result", "Claude's answer did not satisfy the result contract.");
  }
  return parsed.data;
}
