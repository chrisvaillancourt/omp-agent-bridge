import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir, tmpdir, userInfo } from "node:os";
import { dirname, join, isAbsolute } from "node:path";
import { z } from "zod";
import { BridgeError, run } from "./process.ts";
import { modelSchema } from "./request.ts";

export const DEFAULT_MODEL = "claude-sonnet-5";
export const CONFIG_PATH = join(homedir(), ".config", "omp-review-bridge", "config.json");
const configSchema = z.object({
  version: z.literal(1), claude: z.string().refine(isAbsolute),
  claudeVersion: z.string().regex(/^2\.1\.\d+$/), profile: z.string().refine(isAbsolute),
  organization: z.uuid(), model: modelSchema, explicitProfile: z.boolean(),
}).strict();
export type Config = z.infer<typeof configSchema>;
const accountSchema = z.object({
  loggedIn: z.literal(true), authMethod: z.literal("claude.ai"), apiProvider: z.literal("firstParty"),
  subscriptionType: z.literal("team"), orgId: z.uuid(), configDirectory: z.string().refine(isAbsolute),
});

// Never inherit keys, setup tokens, provider/model overrides, proxies, debug
// exporters, or runtime injection. Work mode inherits executable search paths,
// not arbitrary environment variables; its shell still has the user's authority.
export function childEnvironment(profile?: string, work = false): NodeJS.ProcessEnv {
  return {
    HOME: homedir(), PATH: work ? (process.env.PATH ?? "").split(":").filter(isAbsolute).concat(["/usr/bin", "/bin", "/usr/sbin", "/sbin"]).join(":") : "/usr/bin:/bin:/usr/sbin:/sbin",
    LANG: "en_US.UTF-8", TMPDIR: tmpdir(),
    USER: userInfo().username, LOGNAME: userInfo().username,
    ...(profile ? { CLAUDE_CONFIG_DIR: profile } : {}),
    CLAUDE_CODE_SAFE_MODE: "1", ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}

export function configDigest(config: Config): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

export async function loadConfig(): Promise<Config> {
  try { return configSchema.parse(JSON.parse(await readFile(CONFIG_PATH, "utf8"))); }
  catch { throw new BridgeError("not_configured", "Run bun run configure in the bridge repository first. No inference was sent."); }
}

async function cliVersion(claude: string, profile?: string): Promise<string> {
  const r = await run(claude, ["--version"], { cwd: homedir(), env: childEnvironment(profile) });
  const version = /^(2\.1\.(\d+)) \(Claude Code\)\s*$/.exec(r.stdout);
  if (r.code !== 0 || !version || Number(version[2]) < 281) throw new BridgeError("unsupported_version", "Requires official Claude Code 2.1.281 or newer in the 2.1 series.");
  return version[1];
}

async function account(claude: string, profile?: string) {
  const r = await run(claude, ["--safe-mode", "--restricted", "auth", "status", "--json"], { cwd: homedir(), env: childEnvironment(profile) });
  try {
    if (r.code !== 0) throw new Error();
    return accountSchema.parse(JSON.parse(r.stdout));
  } catch {
    throw new BridgeError("subscription_required", "The isolated CLI environment must report a first-party Claude Team subscription login. No inference was sent.");
  }
}

export async function configure(claudePath: string, profile?: string): Promise<void> {
  if (process.platform !== "darwin") throw new BridgeError("unsupported_platform", "This integration is currently verified only on macOS.");
  const claude = await realpath(claudePath);
  const claudeVersion = await cliVersion(claude, profile);
  const a = await account(claude, profile);
  // Keep the installation entry point so updates trip the version gate.
  const c = configSchema.parse({ version: 1, claude: claudePath, claudeVersion, profile: await realpath(a.configDirectory), explicitProfile: profile !== undefined, organization: a.orgId, model: DEFAULT_MODEL });
  await mkdir(dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  await writeFile(CONFIG_PATH, JSON.stringify(c, null, 2) + "\n", { mode: 0o600 });
}

export async function preflight(c: Config): Promise<void> {
  if (process.platform !== "darwin") throw new BridgeError("unsupported_platform", "This integration is currently verified only on macOS.");
  const profile = c.explicitProfile ? c.profile : undefined;
  if (await cliVersion(c.claude, profile) !== c.claudeVersion) throw new BridgeError("version_changed", "Claude Code changed version. Recheck compatibility, then run configure before approving another task.");
  const a = await account(c.claude, profile);
  if (a.orgId !== c.organization || await realpath(a.configDirectory) !== c.profile) throw new BridgeError("account_changed", "Claude account/profile changed. No inference was sent.");
}
