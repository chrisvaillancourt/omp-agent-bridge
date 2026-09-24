import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { childEnvironment, configDigest, loadConfig, preflight } from "./config.ts";
import { BridgeError } from "./process.ts";
import { answerSchema } from "./result.ts";
import { modelSchema, prepareTask, requestSchema } from "./request.ts";

const responseSchema = z.discriminatedUnion("status", [
  answerSchema.extend({ status: z.literal("succeeded"), cwd: z.string(), model: modelSchema, mode: requestSchema.shape.mode }),
  z.object({ status: z.literal("failed"), code: z.string(), message: z.string() }).strict(),
]);
export type Result = z.infer<typeof responseSchema>;
const BILLING_WARNING = "This task uses your Claude Team login. Paid usage credits may be charged, including model-specific charges before included allowance is exhausted. The bridge cannot enforce included-only usage or read the paid-credit balance. Approve exactly one invocation, with no bridge retries. Check /usage afterward.";

export async function delegate(cwd: string, input: unknown, confirm: (warning: string) => Promise<boolean>, signal?: AbortSignal): Promise<Result> {
  let started = false;
  try {
    const parsed = requestSchema.parse(input);
    const config = await loadConfig();
    const task = await prepareTask(cwd, parsed, config.model);
    await preflight(config);
    if (signal?.aborted) throw new BridgeError("cancelled", "Task cancelled before approval.");
    const authority = task.request.mode === "work"
      ? "WORK: Claude can edit files, run arbitrary commands, access the network, and create temporary experiments as your OS user. Permission checks are bypassed; this is not a sandbox. Files outside this directory and other local credentials may be accessible to its commands. Failed/cancelled tasks can leave changes and external effects; there is no rollback."
      : "READ-ONLY: Read/Grep/Glob only, with Claude restricted-mode file policy. No shell commands or edits; not an independent OS sandbox.";
    if (!await confirm(`${BILLING_WARNING}\n\nDirectory: ${task.cwd}\nModel: ${task.request.model}\nExecution deadline: ${task.request.timeoutSeconds} seconds\n\n${authority}\n\nTask:\n${task.request.prompt}`)) {
      throw new BridgeError("approval_required", "Task was not approved. No inference was sent.");
    }
    if (signal?.aborted) throw new BridgeError("cancelled", "Task cancelled before dispatch.");
    const bun = Bun.which("bun");
    if (!bun) throw new BridgeError("runtime_missing", "Bun must be installed to supervise Claude independently of OMP.");
    const { promise, resolve, reject } = Promise.withResolvers<Result>();
    const worker = spawn(bun, [fileURLToPath(new URL("./worker.ts", import.meta.url))], { cwd: task.cwd, env: childEnvironment(undefined, task.request.mode === "work"), stdio: "pipe" });
    started = true;
    const output: Buffer[] = [];
    let bytes = 0;
    let failure: BridgeError | undefined;
    // Closing the lease pipe lets the independent worker kill its Claude group.
    const cancel = () => { failure ??= new BridgeError("cancelled", "Task cancelled."); worker.stdin.end(); };
    const supervisorMs = task.request.timeoutSeconds * 1000 + 60_000;
    const timeout = setTimeout(() => { failure = new BridgeError("timeout", "Task supervisor exceeded its deadline."); worker.stdin.end(); }, supervisorMs + 5_000);
    const forceStop = setTimeout(() => worker.kill("SIGKILL"), supervisorMs + 10_000);
    worker.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1_000_000) { failure = new BridgeError("output_limit", "Task result exceeded the limit."); worker.stdin.end(); }
      else output.push(chunk);
    });
    worker.stderr.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1_000_000) { failure = new BridgeError("output_limit", "Task diagnostics exceeded the limit."); worker.stdin.end(); }
    });
    worker.stdin.on("error", () => {});
    worker.on("error", () => { failure = new BridgeError("launch_failed", "Could not start the task supervisor."); });
    worker.on("close", (code) => {
      clearTimeout(timeout); clearTimeout(forceStop); signal?.removeEventListener("abort", cancel);
      if (failure) return reject(failure);
      try {
        if (code !== 0) throw new Error();
        const result = responseSchema.parse(JSON.parse(Buffer.concat(output).toString("utf8")));
        if (result.status === "succeeded" && (result.cwd !== task.cwd || result.model !== task.request.model || result.mode !== task.request.mode)) throw new Error();
        resolve(result);
      } catch { reject(new BridgeError("invalid_result", "Task supervisor returned no valid result.")); }
    });
    signal?.addEventListener("abort", cancel, { once: true });
    worker.stdin.write(JSON.stringify({ ...task, configDigest: configDigest(config) }) + "\n");
    if (signal?.aborted) cancel();
    return await promise;
  } catch (error) {
    const message = error instanceof BridgeError ? error.message : "Task request or local state is invalid. No completed answer is available.";
    return { status: "failed", code: error instanceof BridgeError ? error.code : "invalid_request", message: `${message}${started ? " The task may have consumed usage or left changes; inspect the workspace. No rollback was performed." : ""}` };
  }
}
