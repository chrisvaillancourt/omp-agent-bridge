import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { childEnvironment, loadConfig, preflight } from "./config.ts";
import { BridgeError } from "./process.ts";
import { reviewSchema } from "./result.ts";
import { captureTarget, requestSchema } from "./target.ts";

const responseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("succeeded"), target: z.object({ base: z.string(), head: z.string(), workingTree: z.boolean(), digest: z.string() }), review: reviewSchema }),
  z.object({ status: z.literal("failed"), code: z.string(), message: z.string() }),
]);
export type Result = z.infer<typeof responseSchema>;
export const BILLING_WARNING = "This review uses your Claude Team login. Paid usage credits may be charged even though no API key is used. The bridge cannot enforce included-allowance-only usage or read the paid-credit balance. Approve exactly one review (120-second execution limit, no bridge retries)? Check /usage afterward.";

export async function review(cwd: string, input: unknown, confirm: (warning: string) => Promise<boolean>, signal?: AbortSignal): Promise<Result> {
  try {
    const request = requestSchema.parse(input);
    const config = await loadConfig();
    await preflight(config);
    const target = await captureTarget(cwd, request, signal);
    if (!await confirm(`${BILLING_WARNING}\n\nRepository: ${target.root}\nBase: ${target.base}\nHEAD: ${target.head}\nWorking tree: ${target.workingTree}\nModel: ${config.model}`)) {
      throw new BridgeError("approval_required", "Review was not approved. No inference was sent.");
    }
    if (signal?.aborted) throw new BridgeError("cancelled", "Review cancelled.");
    const bun = Bun.which("bun");
    if (!bun) throw new BridgeError("runtime_missing", "Bun must be installed to supervise Claude independently of OMP.");
    const { promise, resolve, reject } = Promise.withResolvers<Result>();
    const worker = spawn(bun, [fileURLToPath(new URL("./worker.ts", import.meta.url))], { cwd: target.root, env: childEnvironment(), stdio: "pipe" });
    let output = "";
    let bytes = 0;
    let failure: BridgeError | undefined;
    // Closing the lease pipe lets the independent worker kill its Claude group.
    const cancel = () => { failure ??= new BridgeError("cancelled", "Review cancelled."); worker.stdin.end(); };
    const timeout = setTimeout(() => { failure = new BridgeError("timeout", "Review supervisor exceeded its deadline."); worker.stdin.end(); }, 185_000);
    const forceStop = setTimeout(() => worker.kill("SIGTERM"), 190_000);
    worker.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 512_000) { failure = new BridgeError("output_limit", "Review result exceeded the limit."); worker.stdin.end(); }
      else output += chunk.toString("utf8");
    });
    worker.stderr.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 512_000) { failure = new BridgeError("output_limit", "Review diagnostics exceeded the limit."); worker.stdin.end(); }
    });
    worker.stdin.on("error", () => {});
    worker.on("error", () => { failure = new BridgeError("launch_failed", "Could not start the review supervisor."); });
    worker.on("close", (code) => {
      clearTimeout(timeout); clearTimeout(forceStop); signal?.removeEventListener("abort", cancel);
      if (failure) return reject(failure);
      try {
        if (code !== 0) throw new Error();
        resolve(responseSchema.parse(JSON.parse(output)));
      } catch { reject(new BridgeError("invalid_result", "Review supervisor returned no valid result.")); }
    });
    signal?.addEventListener("abort", cancel, { once: true });
    worker.stdin.write(JSON.stringify({ cwd: target.root, request, digest: target.digest }) + "\n");
    if (signal?.aborted) cancel();
    return await promise;
  } catch (error) {
    return { status: "failed", code: error instanceof BridgeError ? error.code : "invalid_request", message: error instanceof BridgeError ? error.message : "Review request or local state is invalid. No review result is available." };
  }
}
