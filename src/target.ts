import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { z } from "zod";
import { childEnvironment } from "./config.ts";
import { BridgeError, run } from "./process.ts";

export const requestSchema = z.object({
  base: z.string().min(1).max(200).regex(/^[^\s\x00-\x1f]+$/).refine((s) => !s.startsWith("-")),
  workingTree: z.boolean().default(false),
  requirements: z.string().min(1).max(32_000),
}).strict();
export type Request = z.infer<typeof requestSchema>;
export type Target = { root: string; base: string; head: string; workingTree: boolean; digest: string; diff: string; untracked: boolean };

export async function captureTarget(cwd: string, request: Request, signal?: AbortSignal): Promise<Target> {
  const root = await realpath(cwd);
  const git = async (args: string[]) => {
    const r = await run("/usr/bin/git", ["-c", "core.fsmonitor=false", "--no-pager", ...args], { cwd: root, env: { ...childEnvironment(), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0" }, signal, maxBytes: 512_000 });
    if (r.code !== 0) throw new BridgeError("invalid_target", "Cannot resolve the Git review target. Use a repository root and a valid base commit.");
    return r.stdout;
  };
  if (await realpath((await git(["rev-parse", "--show-toplevel"])).trim()) !== root) throw new BridgeError("invalid_target", "Start the review from the Git repository root.");
  const base = (await git(["rev-parse", "--verify", "--end-of-options", `${request.base}^{commit}`])).trim();
  const head = (await git(["rev-parse", "--verify", "HEAD^{commit}"])).trim();
  const trackedChanges = await git(["diff", "--no-ext-diff", "--no-textconv", "--name-only", "HEAD", "--"]);
  if (!request.workingTree && trackedChanges.length) throw new BridgeError("dirty_target", "Tracked changes exist. Use workingTree=true to review them, or finish committing first.");
  const diff = await git(["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--full-index", base, ...(request.workingTree ? [] : [head]), "--"]);
  if (!diff.trim()) throw new BridgeError("empty_target", "No tracked changes against the selected base. Nothing was sent to Claude.");
  const untracked = Boolean(await git(["ls-files", "--others", "--exclude-standard", "-z"]));
  // Status catches staged-only changes that cancel out in the working tree.
  const status = await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const digest = createHash("sha256").update(base).update(head).update(diff).update(status).digest("hex");
  return { root, base, head, workingTree: request.workingTree, digest, diff, untracked };
}
