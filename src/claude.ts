import type { Config } from "./config.ts";
import type { Request } from "./request.ts";
import { jsonSchema } from "./result.ts";

// The same argument builder is exercised by the credential-free offline check.
export function taskArguments(config: Config, request: Request): string[] {
  const readOnly = request.mode === "read-only";
  const permissionMode = readOnly ? "dontAsk" : "bypassPermissions";
  const settings = {
    forceLoginMethod: "claudeai", forceLoginOrgUUID: config.organization,
    availableModels: [request.model], enforceAvailableModels: true,
    disableAllHooks: true,
    permissions: { defaultMode: permissionMode },
  };
  return [
    "-p", "--safe-mode", "--setting-sources", "",
    "--settings", JSON.stringify(settings), "--model", request.model, "--fallback-model", request.model,
    ...(readOnly ? [
      "--restricted", "--tools", "Read,Grep,Glob", "--allowedTools", "Read,Grep,Glob",
      "--disallowedTools", "Bash,Edit,Write,Agent,Task,WebFetch,WebSearch,mcp__*",
    ] : ["--tools", "default"]),
    "--permission-mode", permissionMode, "--permission-prompts", "none",
    "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--no-chrome",
    "--disable-slash-commands", "--no-session-persistence", "--output-format", "json",
    "--json-schema", JSON.stringify(jsonSchema),
  ];
}
