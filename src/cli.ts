import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { configure, loadConfig, preflight } from "./config.ts";
import { BridgeError } from "./process.ts";
import { delegate } from "./bridge.ts";
import { checkSchema } from "./compatibility.ts";
import { requestSchema } from "./request.ts";

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "configure") {
    if (args.length > 1) throw new BridgeError("invalid_request", "Usage: bun run configure [Claude config directory]");
    const claude = Bun.which("claude");
    if (!claude) throw new BridgeError("runtime_missing", "Install the official Claude Code CLI and sign in first.");
    await configure(claude, args[0] ? resolve(args[0]) : undefined);
    console.log("Pinned Claude executable version and Team organization using nonsecret metadata. No inference sent. Each task requires explicit approval; no billing guarantee is implied.");
  } else if (command === "check") {
    if (args.length) throw new BridgeError("invalid_request", "Usage: bun run check");
    const config = await loadConfig(); await preflight(config);
    await checkSchema(config);
    console.log(JSON.stringify({ ready: true, claudeVersion: config.claudeVersion, defaultModel: config.model, subscription: "team", billing: "per-invocation-approval-required", profilesCompatible: ["read-only", "work"], inferenceSent: false }));
  } else if (command === "task") {
    const usage = "Usage: task PROMPT --mode work|read-only [--model ID] [--timeout SECONDS], or task --prompt-file PATH --mode work|read-only [...], from the task working directory";
    let request;
    try {
      const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
        mode: { type: "string" }, model: { type: "string" }, timeout: { type: "string" }, "prompt-file": { type: "string" },
      } });
      if (values["prompt-file"] ? positionals.length !== 0 : positionals.length !== 1) throw new Error();
      let prompt = positionals[0];
      if (values["prompt-file"]) {
        const file = Bun.file(resolve(values["prompt-file"]));
        if (file.size > 128_000) throw new Error();
        prompt = await file.text();
      }
      request = requestSchema.parse({ prompt, mode: values.mode, model: values.model, timeoutSeconds: values.timeout === undefined ? undefined : Number(values.timeout) });
    } catch { throw new BridgeError("invalid_request", usage); }
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new BridgeError("approval_required", "An interactive terminal must approve each task. No inference was sent.");
    const controller = new AbortController();
    const interrupt = () => controller.abort();
    process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
    try {
      const result = await delegate(process.cwd(), request, async (warning) => {
        const terminal = createInterface({ input: process.stdin, output: process.stderr });
        try { return (await terminal.question(`${warning}\nType RUN ONCE to proceed: `, { signal: controller.signal })).trim() === "RUN ONCE"; }
        catch { return false; }
        finally { terminal.close(); }
      }, controller.signal);
      console.log(JSON.stringify(result, null, 2));
      if (result.status !== "succeeded") process.exitCode = 1;
    } finally { process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt); }
  } else {
    console.log(`OMP Agent Bridge

configure [PROFILE]  Pin the official CLI version and Team account (no inference).
check                Verify account/version and both launch profiles offline.
task PROMPT --mode work|read-only [--model ID] [--timeout SECONDS]
task --prompt-file PATH --mode work|read-only [--model ID] [--timeout SECONDS]
                     Delegate from any directory; requires terminal approval.

Install in OMP: omp plugin link /absolute/path/to/omp-agent-bridge
Start a fresh OMP session and invoke /skill:claude-bridge.

Work mode grants shell/edit/network authority as your OS user, not sandboxed access.
Read-only mode permits Read/Grep/Glob. Every call requires fresh approval.
Paid credits may be charged. Deadlines and model selection are not spending caps.
Failed or cancelled work may leave changes; no rollback is performed.
Normal Claude customizations are disabled; administrator policy remains trusted.
Claude service processing and OMP conversation retention still apply.`);
    if (command && command !== "--help") process.exitCode = 1;
  }
} catch (error) {
  console.error(JSON.stringify({ status: "failed", code: error instanceof BridgeError ? error.code : "setup_failed", message: error instanceof BridgeError ? error.message : "Bridge operation failed; inspect local state before another approved invocation." }));
  process.exitCode = 1;
}
