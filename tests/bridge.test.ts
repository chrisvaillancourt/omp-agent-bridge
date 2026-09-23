import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseResult } from "../src/result.ts";
import { MODEL, childEnvironment } from "../src/config.ts";
import { run } from "../src/process.ts";
import { captureTarget } from "../src/target.ts";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });

const successful = {
  type: "result", subtype: "success", is_error: false, modelUsage: { [MODEL]: {} },
  structured_output: { summary: "One defect", findings: [{ priority: "P1", title: "Wrong sum", body: "Returns subtraction for positive inputs.", file: "math.ts", line: 1 }], limitations: [] },
};

function expectFailure(action: () => unknown, code: string) {
  let failure: unknown;
  try { action(); } catch (error) { failure = error; }
  expect(failure).toMatchObject({ code });
}

test("a failed or incomplete Claude turn cannot masquerade as findings", () => {
  expect(parseResult(0, JSON.stringify(successful)).findings[0].priority).toBe("P1");
  expectFailure(() => parseResult(1, JSON.stringify(successful)), "review_failed");
  expectFailure(() => parseResult(0, JSON.stringify({ ...successful, subtype: "error_max_turns" })), "review_failed");
  expectFailure(() => parseResult(0, JSON.stringify({ ...successful, permission_denials: [{ tool_name: "Read" }] })), "permission_denied");
  expectFailure(() => parseResult(0, JSON.stringify(successful) + "trailing output"), "invalid_result");
});

test("verbose JSON selects one terminal result, not an earlier or duplicate result", () => {
  const events = [{ type: "system", subtype: "init" }, successful];
  expect(parseResult(0, JSON.stringify(events)).findings[0].file).toBe("math.ts");
  expectFailure(() => parseResult(0, JSON.stringify([...events, successful])), "invalid_result");
  expectFailure(() => parseResult(0, JSON.stringify([...events, { type: "assistant" }])), "invalid_result");
});

test("wrong-model or escaping findings are rejected rather than trusted", () => {
  expectFailure(() => parseResult(0, JSON.stringify({ ...successful, modelUsage: { "claude-fable-5-1": {} } })), "model_mismatch");
  const invalid = structuredClone(successful);
  invalid.structured_output.findings[0].file = "../outside.ts";
  expectFailure(() => parseResult(0, JSON.stringify(invalid)), "invalid_result");
});

test("a real working-tree mutation invalidates the captured review identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "review-target-")); temporary.push(dir);
  const git = async (...args: string[]) => {
    const r = await run("/usr/bin/git", args, { cwd: dir, env: { ...childEnvironment(), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
    expect(r.code).toBe(0);
    return r.stdout.trim();
  };
  await git("init", "-b", "main");
  await writeFile(join(dir, "math.ts"), "export const add = (a, b) => a + b;\n");
  await git("add", "math.ts");
  await git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "base");
  const base = await git("rev-parse", "HEAD");
  await writeFile(join(dir, "math.ts"), "export const add = (a, b) => a - b;\n");
  const request = { base, workingTree: true, requirements: "Addition must add." };
  const first = await captureTarget(dir, request);
  expect(first.diff).toContain("a - b");
  await expect(captureTarget(dir, { ...request, workingTree: false })).rejects.toMatchObject({ code: "dirty_target" });
  await writeFile(join(dir, "math.ts"), "export const add = () => 0;\n");
  expect((await captureTarget(dir, request)).digest).not.toBe(first.digest);
});

test("timeout kills descendants, not just the process-group leader", async () => {
  // Real OS process groups and reaping cannot be advanced with JS fake timers.
  const dir = await mkdtemp(join(tmpdir(), "review-process-")); temporary.push(dir);
  const marker = join(dir, "child.pid");
  const source = `import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs'; const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'}); writeFileSync(${JSON.stringify(marker)},String(c.pid)); setInterval(()=>{},1000);`;
  await expect(run(process.execPath, ["-e", source], { cwd: dir, env: childEnvironment(), timeoutMs: 500 })).rejects.toMatchObject({ code: "timeout" });
  const pid = Number(await readFile(marker, "utf8"));
  // Reaping a killed descendant can trail the parent's close event briefly.
  let alive = true;
  for (let i = 0; i < 50 && alive; i++) {
    try { process.kill(pid, 0); await Bun.sleep(10); } catch { alive = false; }
  }
  expect(alive).toBe(false);
});

test("cancellation and output overflow cannot return successful partial output", async () => {
  const controller = new AbortController();
  const pending = run(process.execPath, ["-e", "setInterval(()=>{},1000)"], { cwd: tmpdir(), env: childEnvironment(), signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  await expect(run(process.execPath, ["-e", "console.log('x'.repeat(4096))"], { cwd: tmpdir(), env: childEnvironment(), maxBytes: 100 })).rejects.toMatchObject({ code: "output_limit" });
});
