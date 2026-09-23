import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { configure, loadConfig, preflight } from "./config.ts";
import { BridgeError } from "./process.ts";
import { review } from "./review.ts";
import { checkSchema } from "./compatibility.ts";

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "configure") {
    if (args.length > 1) throw new BridgeError("invalid_request", "Usage: bun run configure [Claude config directory]");
    const claude = Bun.which("claude");
    if (!claude) throw new BridgeError("runtime_missing", "Install the official Claude Code CLI and sign in first.");
    await configure(claude, args[0] ? resolve(args[0]) : undefined);
    console.log("Pinned Claude executable version and Team organization using nonsecret metadata. No inference sent. Each review still requires explicit approval; no billing guarantee is implied.");
  } else if (command === "check") {
    if (args.length) throw new BridgeError("invalid_request", "Usage: bun run check");
    const config = await loadConfig(); await preflight(config);
    await checkSchema(config);
    console.log(JSON.stringify({ ready: true, claudeVersion: config.claudeVersion, model: config.model, subscription: "team", billing: "per-review-approval-required", schemaCompatible: true, inferenceSent: false }));
  } else if (command === "review") {
    if (args.length < 2 || args.length > 3 || (args[2] && args[2] !== "--working-tree")) throw new BridgeError("invalid_request", "Usage: bun run /path/to/src/cli.ts review BASE REQUIREMENTS [--working-tree], from the target repository root");
    const controller = new AbortController();
    const interrupt = () => controller.abort();
    process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
    try {
      const result = await review(process.cwd(), { base: args[0], requirements: args[1], workingTree: args[2] === "--working-tree" }, async (warning) => {
        if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
        const terminal = createInterface({ input: process.stdin, output: process.stderr });
        try { return (await terminal.question(`${warning}\nType REVIEW ONCE to proceed: `)).trim() === "REVIEW ONCE"; }
        finally { terminal.close(); }
      }, controller.signal);
      console.log(JSON.stringify(result, null, 2));
      if (result.status !== "succeeded") process.exitCode = 1;
    } finally { process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt); }
  } else {
    console.log("OMP Review Bridge\n\nconfigure [PROFILE]  Pin the current official CLI version and Team account (no inference).\ncheck                Verify the pinned version and account (no inference).\nreview BASE REQUIREMENTS [--working-tree]\n                     Review from a Git root; requires a terminal confirmation for one request.\n\nInstall in OMP: omp plugin link /absolute/path/to/omp-review-bridge\nThen start a fresh OMP session and invoke /skill:claude-review.\n\nOnly tracked changes are reviewed. Claude has Read/Grep/Glob, not shell or writes.\nPaid credits may be charged. This bridge cannot enforce included-allowance-only billing.\nNormal Claude customizations are disabled; administrator policy remains trusted.\nClaude service processing and OMP conversation retention still apply.");
    if (command && command !== "--help") process.exitCode = 1;
  }
} catch (error) {
  console.error(JSON.stringify({ status: "failed", code: error instanceof BridgeError ? error.code : "setup_failed", message: error instanceof BridgeError ? error.message : "Bridge setup failed; no inference was sent." }));
  process.exitCode = 1;
}
