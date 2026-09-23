import { homedir } from "node:os";
import { z } from "zod";
import { childEnvironment, type Config } from "./config.ts";
import { BridgeError, run } from "./process.ts";
import { jsonSchema } from "./result.ts";

export async function checkSchema(config: Config): Promise<void> {
  // This is a parser handshake, not a review. Bare mode omits subscription
  // credentials and macOS denies all networking independently of Claude.
  const r = await run("/usr/bin/sandbox-exec", [
    "-p", "(version 1)(allow default)(deny network*)", config.claude,
    "--bare", "-p", "--tools", "", "--output-format", "json",
    "--json-schema", JSON.stringify(jsonSchema), "Schema compatibility check",
  ], { cwd: homedir(), env: childEnvironment(), timeoutMs: 15_000 });
  try {
    if (r.code !== 1 || /not a valid JSON Schema/.test(r.stderr)) throw new Error();
    const value: unknown = JSON.parse(r.stdout);
    const terminal = Array.isArray(value) ? value.at(-1) : value;
    z.object({ type: z.literal("result"), is_error: z.literal(true) }).parse(terminal);
    if (!/not logged in|API key|login/i.test(r.stdout)) throw new Error();
  } catch {
    throw new BridgeError("schema_incompatible", "Claude CLI schema compatibility check failed with networking denied. No inference was permitted.");
  }
}
