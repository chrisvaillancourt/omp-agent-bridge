import { realpath, stat } from "node:fs/promises";
import { z } from "zod";
import { BridgeError } from "./process.ts";

// Require a versioned first-party model ID, not a floating alias or CLI option.
export const modelSchema = z.string().max(120).regex(/^claude-[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\d+(?:-[a-z0-9]+)*$/);
export const requestSchema = z.object({
  prompt: z.string().trim().min(1).max(32_000).describe("Task, requirements, context, and expected verification."),
  mode: z.enum(["work", "read-only"]).describe("work permits shell commands, edits, and experiments as your OS user; read-only permits Read/Grep/Glob only."),
  model: modelSchema.optional().describe("Exact versioned Claude model ID; omitted uses the configured default."),
  timeoutSeconds: z.number().int().min(1).max(1800).default(600).describe("Claude execution deadline, 1–1800 seconds; not a spending cap."),
}).strict();
export const resolvedRequestSchema = requestSchema.extend({ model: modelSchema });
export type Request = z.infer<typeof resolvedRequestSchema>;

export async function prepareTask(cwd: string, input: unknown, defaultModel: string): Promise<{ cwd: string; request: Request }> {
  const parsed = requestSchema.parse(input);
  const request = resolvedRequestSchema.parse({ ...parsed, model: parsed.model ?? defaultModel });
  try {
    const root = await realpath(cwd);
    if (!(await stat(root)).isDirectory()) throw new Error();
    return { cwd: root, request };
  } catch {
    throw new BridgeError("invalid_workspace", "The task working directory must exist and be a directory. No inference was sent.");
  }
}
