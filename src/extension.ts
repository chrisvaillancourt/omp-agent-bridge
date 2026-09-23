import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { review } from "./review.ts";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "claude_review",
    label: "Claude Code Review",
    description: "Request an independent, read-only Claude Code review of tracked changes against a Git base. Requires explicit interactive approval for each request because Team paid credits may be charged. Load the claude-review skill first.",
    approval: "exec",
    parameters: pi.zod.object({
      base: pi.zod.string().describe("Base commit or ref; resolved and pinned before approval."),
      workingTree: pi.zod.boolean().optional().describe("Include tracked uncommitted changes. Untracked files are excluded."),
      requirements: pi.zod.string().describe("Requirements and review focus, without your conclusions."),
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      const result = await review(ctx.cwd, params, async (warning) => {
        if (!ctx.hasUI) return false;
        const approved = await ctx.ui.confirm("Approve one Claude review", warning, { signal });
        if (approved) onUpdate?.({ content: [{ type: "text", text: "Running approved Claude Code review…" }] });
        return approved;
      }, signal);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result, isError: result.status !== "succeeded" };
    },
  });
}
