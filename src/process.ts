import { spawn } from "node:child_process";

export class BridgeError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

// Child groups are killed even when the leader exits: an inherited pipe must
// not keep the bridge alive. The supervisor also owns an independent deadline.
export async function run(
  executable: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; input?: string; signal?: AbortSignal; timeoutMs?: number; maxBytes?: number },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  if (options.signal?.aborted) throw new BridgeError("cancelled", "Task cancelled.");
  const { promise, resolve, reject } = Promise.withResolvers<{ code: number | null; stdout: string; stderr: string }>();
  const child = spawn(executable, args, { cwd: options.cwd, env: options.env, detached: true, stdio: "pipe" });
  let failure: BridgeError | undefined;
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let bytes = 0;
  const kill = () => {
    if (child.pid) {
      try { process.kill(-child.pid, "SIGKILL"); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) child.kill("SIGKILL"); }
    }
  };
  const stop = (error: BridgeError) => {
    failure ??= error;
    kill();
    // A detached descendant can retain pipe fds after the child group is dead.
    // Failed commands need no further output; successful commands still drain.
    child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
  };
  const abort = () => stop(new BridgeError("cancelled", "Task cancelled."));
  const timer = setTimeout(() => stop(new BridgeError("timeout", "Task exceeded its wall-clock deadline.")), options.timeoutMs ?? 15_000);
  const collect = (target: Buffer[]) => (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > (options.maxBytes ?? 2_000_000)) stop(new BridgeError("output_limit", "Command output exceeded the bridge limit."));
    else if (!failure) target.push(chunk);
  };
  child.stdout.on("data", collect(stdout));
  child.stderr.on("data", collect(stderr));
  child.stdin.on("error", () => {}); // Classify early exits from exit/result, not EPIPE.
  child.on("error", () => { failure = new BridgeError("launch_failed", "Could not launch the configured executable."); });
  child.on("exit", kill);
  child.on("close", (code) => {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    if (failure) reject(failure);
    else resolve({ code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
  });
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  child.stdin.end(options.input);
  return promise;
}
