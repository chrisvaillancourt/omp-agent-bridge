import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { z } from "zod";
import { delegate } from "./bridge.ts";
import { requestSchema } from "./request.ts";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "claude_task",
    label: "Delegate to Claude Code",
    description: "Delegate a task to the official Claude Code CLI in interactive or non-interactive sessions. Work mode supports edits, shell commands, and experiments under auto permissions; read-only mode is explicit. Starts without a bridge confirmation and may charge paid credits. Load the claude-bridge skill first.",
    approval: "exec",
    parameters: z.toJSONSchema(requestSchema, { target: "draft-7", io: "input" }),
    async execute(_id, params, signal, onUpdate, ctx) {
      onUpdate?.({ content: [{ type: "text", text: "Delegating task to Claude Code; paid credits may be charged." }] });
      const result = await delegate(ctx.cwd, params, signal);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result, isError: result.status !== "succeeded" };
    },
  });
}
