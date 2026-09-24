import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseResult } from "../src/result.ts";
import { DEFAULT_MODEL, childEnvironment } from "../src/config.ts";
import { run } from "../src/process.ts";
import { prepareTask } from "../src/request.ts";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((p) => rm(p, { recursive: true, force: true }))); });

const selectedModel = "claude-opus-4-6";
const successful = {
  type: "result", subtype: "success", is_error: false, modelUsage: { [selectedModel]: {} },
  structured_output: { answer: "The sum is incorrect for positive inputs.", limitations: [] },
};

function expectFailure(action: () => unknown, code: string) {
  let failure: unknown;
  try { action(); } catch (error) { failure = error; }
  expect(failure).toMatchObject({ code });
}

test("a failed or incomplete Claude turn cannot masquerade as an answer", () => {
  expect(parseResult(0, JSON.stringify(successful), selectedModel).answer).toContain("sum");
  expectFailure(() => parseResult(1, JSON.stringify(successful), selectedModel), "delegate_failed");
  expectFailure(() => parseResult(0, JSON.stringify({ ...successful, subtype: "error_max_turns" }), selectedModel), "delegate_failed");
  expectFailure(() => parseResult(0, JSON.stringify({ ...successful, permission_denials: [{ tool_name: "Read" }] }), selectedModel), "permission_denied");
  expectFailure(() => parseResult(0, JSON.stringify(successful) + "trailing output", selectedModel), "invalid_result");
});

test("verbose JSON selects one terminal result, not an earlier or duplicate result", () => {
  const events = [{ type: "system", subtype: "init" }, successful];
  expect(parseResult(0, JSON.stringify(events), selectedModel).answer).toBe(successful.structured_output.answer);
  expectFailure(() => parseResult(0, JSON.stringify([...events, successful]), selectedModel), "invalid_result");
  expectFailure(() => parseResult(0, JSON.stringify([...events, { type: "assistant" }]), selectedModel), "invalid_result");
});

test("the reported model must match the selected full model, with an optional date suffix", () => {
  const dated = { ...successful, modelUsage: { [`${selectedModel}-20260923`]: {} } };
  expect(parseResult(0, JSON.stringify(dated), selectedModel).answer).toBe(successful.structured_output.answer);
  expectFailure(() => parseResult(0, JSON.stringify(successful), DEFAULT_MODEL), "model_mismatch");
  expectFailure(() => parseResult(0, JSON.stringify({
    ...successful, modelUsage: { [selectedModel]: {}, "claude-sonnet-5": {} },
  }), selectedModel), "model_mismatch");
});

test("malformed or absent structured answers and quota failures are not successes", () => {
  expectFailure(() => parseResult(0, JSON.stringify({ ...successful, structured_output: { limitations: [] } }), selectedModel), "invalid_result");
  expectFailure(() => parseResult(0, JSON.stringify({ ...successful, structured_output: { answer: "", limitations: [] } }), selectedModel), "invalid_result");
  expectFailure(() => parseResult(1, JSON.stringify({ ...successful, subtype: "error_during_execution", message: "usage limit" }), selectedModel), "quota_exhausted");
});

test("non-Git task workspaces resolve symlinks before approval", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bridge-task-")); temporary.push(dir);
  const linked = `${dir}-link`; temporary.push(linked);
  await symlink(dir, linked);
  const prepared = await prepareTask(linked, {
    prompt: "Inspect this directory.", mode: "read-only", model: selectedModel, timeoutSeconds: 1800,
  }, DEFAULT_MODEL);
  expect(prepared.cwd).toBe(await realpath(dir));
  await expect(prepareTask(join(dir, "missing"), { prompt: "Fix the defect.", mode: "work" }, DEFAULT_MODEL)).rejects.toMatchObject({ code: "invalid_workspace" });
});

test("task requests reject omitted mode, legacy review fields, model aliases and excessive timeouts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bridge-task-")); temporary.push(dir);
  const request = { prompt: "Explain the code.", mode: "work" };
  await expect(prepareTask(dir, { prompt: request.prompt }, DEFAULT_MODEL)).rejects.toBeDefined();
  await expect(prepareTask(dir, { ...request, base: "HEAD", workingTree: true, requirements: "Review" }, DEFAULT_MODEL)).rejects.toBeDefined();
  await expect(prepareTask(dir, { ...request, model: "sonnet" }, DEFAULT_MODEL)).rejects.toBeDefined();
  await expect(prepareTask(dir, { ...request, model: "claude-opus-4-6[1m]" }, DEFAULT_MODEL)).rejects.toBeDefined();
  await expect(prepareTask(dir, { ...request, timeoutSeconds: 1801 }, DEFAULT_MODEL)).rejects.toBeDefined();
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

test("a deadline settles even when a detached descendant retains the output pipes", async () => {
  // Real process exit and inherited OS pipes cannot be advanced with fake timers.
  const dir = await mkdtemp(join(tmpdir(), "bridge-pipes-")); temporary.push(dir);
  const marker = join(dir, "detached.pid");
  const source = `import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs'; const c=spawn(process.execPath,['-e','setTimeout(()=>{},10000)'],{detached:true,stdio:'inherit'}); writeFileSync(${JSON.stringify(marker)},String(c.pid)); setInterval(()=>{},1000);`;
  const pending = run(process.execPath, ["-e", source], { cwd: dir, env: childEnvironment(), timeoutMs: 500 })
    .then(() => ({ code: "unexpected_success" }), (error: unknown) => error);
  let watchdog: NodeJS.Timeout | undefined;
  try {
    const stalled = new Promise((resolve) => { watchdog = setTimeout(() => resolve({ code: "stalled" }), 2500); });
    expect(await Promise.race([pending, stalled])).toMatchObject({ code: "timeout" });
  } finally {
    clearTimeout(watchdog);
    const pid = Number(await readFile(marker, "utf8"));
    try { process.kill(pid, "SIGKILL"); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; }
    await pending;
  }
});

test("cancellation and output overflow cannot return successful partial output", async () => {
  const controller = new AbortController();
  const pending = run(process.execPath, ["-e", "setInterval(()=>{},1000)"], { cwd: tmpdir(), env: childEnvironment(), signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  await expect(run(process.execPath, ["-e", "console.log('x'.repeat(4096))"], { cwd: tmpdir(), env: childEnvironment(), maxBytes: 100 })).rejects.toMatchObject({ code: "output_limit" });
});
