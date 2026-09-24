import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/process.ts";

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const extension = fileURLToPath(new URL("../src/extension.ts", import.meta.url));

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bridge-headless-")); temporary.push(root);
  const cwd = await realpath(root);
  const state = join(cwd, ".config", "omp-agent-bridge");
  const profile = join(cwd, ".claude");
  const executable = join(cwd, "fixture-claude");
  const organization = randomUUID();
  await mkdir(state, { recursive: true });
  await mkdir(profile);
  // An isolated executable boundary replaces the paid provider, not the bridge.
  // Real child processes perform work; no test reads a user's login or config.
  await writeFile(executable, `#!${process.execPath}
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
if (process.argv.includes('--version')) console.log('2.1.281 (Claude Code)');
else if (process.argv.includes('auth')) console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai',apiProvider:'firstParty',subscriptionType:'team',orgId:${JSON.stringify(organization)},configDirectory:${JSON.stringify(profile)}}));
else {
  await Bun.stdin.text();
  appendFileSync('dispatch.log','dispatched\\n');
  const answer = readFileSync('input.txt','utf8').toUpperCase();
  writeFileSync('result.txt',answer);
  const model = process.argv[process.argv.indexOf('--model')+1];
  console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,modelUsage:{[model]:{}},structured_output:{answer,limitations:[]}}));
}
`);
  await chmod(executable, 0o700);
  await writeFile(join(state, "config.json"), JSON.stringify({ version: 1, claude: executable, claudeVersion: "2.1.281", profile, organization, model: "claude-opus-5-5", explicitProfile: false }));
  await writeFile(join(cwd, "input.txt"), "non-interactive work\n");
  return { cwd, state, env: { HOME: cwd, PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin` } };
}

test.skipIf(process.platform !== "darwin")("a piped CLI task completes work with stdin closed and releases its lock", async () => {
  const f = await fixture();
  const result = await run(process.execPath, [cli, "task", "Process the fixture input.", "--mode", "work"], { cwd: f.cwd, env: f.env });
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: "succeeded", mode: "work", cwd: f.cwd });
  expect(await readFile(join(f.cwd, "result.txt"), "utf8")).toBe("NON-INTERACTIVE WORK\n");
  expect(await readFile(join(f.cwd, "dispatch.log"), "utf8")).toBe("dispatched\n");
  await expect(stat(join(f.state, "task.lock"))).rejects.toMatchObject({ code: "ENOENT" });
});

test.skipIf(process.platform !== "darwin")("a cancelled headless OMP task never dispatches work", async () => {
  const f = await fixture();
  const script = join(f.cwd, "cancel.ts");
  await writeFile(script, `
import register from ${JSON.stringify(extension)};
let tool;
register({registerTool(value){tool=value;}});
const controller=new AbortController(); controller.abort();
const result=await tool.execute('cancelled-task',{prompt:'Must not execute.',mode:'work'},controller.signal,undefined,{cwd:process.cwd(),hasUI:false,ui:{confirm(){throw new Error('UI must not be accessed');}}});
console.log(JSON.stringify(result));
`);
  const result = await run(process.execPath, [script], { cwd: f.cwd, env: f.env });
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ isError: true, details: { status: "failed", code: "cancelled" } });
  await expect(stat(join(f.cwd, "dispatch.log"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(stat(join(f.cwd, "result.txt"))).rejects.toMatchObject({ code: "ENOENT" });
});
