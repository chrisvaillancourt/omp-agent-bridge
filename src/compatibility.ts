import { homedir } from "node:os";
import { z } from "zod";
import { childEnvironment, type Config } from "./config.ts";
import { BridgeError, run } from "./process.ts";
import { taskArguments } from "./claude.ts";

export async function checkSchema(config: Config): Promise<void> {
  // Bare mode omits subscription credentials; macOS separately denies network.
  // Exercise both real launch profiles plus this credential-free exception.
  for (const mode of ["read-only", "work"] as const) {
    const args = taskArguments(config, { prompt: "Compatibility check", mode, model: config.model, timeoutSeconds: 10 });
    const r = await run("/usr/bin/sandbox-exec", [
      "-p", "(version 1)(allow default)(deny network*)", config.claude,
      "--bare", ...args,
    ], { cwd: homedir(), env: childEnvironment(), input: "Offline compatibility check", timeoutMs: 15_000 });
    try {
      if (r.code !== 1 || /not a valid JSON Schema/.test(r.stderr)) throw new Error();
      const value: unknown = JSON.parse(r.stdout);
      const terminal = Array.isArray(value) ? value.at(-1) : value;
      z.object({ type: z.literal("result"), is_error: z.literal(true) }).parse(terminal);
      if (!/not logged in|API key|login/i.test(r.stdout)) throw new Error();
    } catch {
      throw new BridgeError("schema_incompatible", `Claude CLI ${mode} profile compatibility check failed with networking denied. No inference was permitted.`);
    }
  }
}
