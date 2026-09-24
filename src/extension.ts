import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { z } from "zod";
import { delegate } from "./bridge.ts";
import { requestSchema } from "./request.ts";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "claude_task",
    label: "Delegate to Claude Code",
    description: "Delegate a task to the official Claude Code CLI. Work mode supports edits, shell commands, and experiments; read-only mode is explicit. Requires fresh interactive approval of the task, model, authority, and possible paid credits. Load the claude-bridge skill first.",
    approval: "exec",
    parameters: z.toJSONSchema(requestSchema, { target: "draft-7", io: "input" }),
    async execute(_id, params, signal, onUpdate, ctx) {
      if (!ctx.hasUI) {
        const result = { status: "failed", code: "approval_required", message: "An interactive session must approve each task. No inference was sent." };
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result, isError: true };
      }
      const result = await delegate(ctx.cwd, params, async (warning) => {
        const approved = await ctx.ui.confirm("Approve one delegated task", warning, { signal });
        if (approved) onUpdate?.({ content: [{ type: "text", text: "Running approved Claude Code task…" }] });
        return approved;
      }, signal);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result, isError: result.status !== "succeeded" };
    },
  });
}
