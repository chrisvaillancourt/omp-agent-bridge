# OMP Agent Bridge

Delegate a scoped task from OMP to the official Claude Code CLI, then inspect its answer and any workspace changes in OMP. The bridge is an OMP plugin with a custom `claude_task` tool and the bundled `claude-bridge` skill. It is not an OMP model provider, Claude Agent SDK application, MCP server, or ACP adapter. The package and plugin name is `omp-agent-bridge`.

```text
/skill:claude-bridge or a delegation request in OMP
    → claude_task(prompt, mode, optional model/deadline)
    → fresh interactive approval for one invocation
    → supervisor and official claude -p using the user's own Team login
    → answer and limitations returned to OMP
```

**Billing:** Team subscription authentication does not guarantee an invocation stays within included allowance. Paid usage credits may be charged; the bridge cannot read the balance or enforce zero additional spend. Approval is required for every invocation, including another attempt after a failure. Headless invocations are refused. Check Claude Code `/usage` around approved work if cost matters; a failed or cancelled invocation may have consumed usage, and reporting may lag.

## Installation and setup

### Prerequisites

- **macOS:** configuration rejects other platforms. Offline compatibility checking uses `sandbox-exec`; lifecycle handling uses POSIX process groups.
- **Bun 1.3.14 or newer**. OMP integration was initially verified with **18.2.11**; renamed-plugin discovery was also verified with **18.3.0**.
- **Official Claude Code CLI:** the earlier review bridge was verified with **2.1.281**. Its 2.1-series gate starts there and pins the exact configured version; a later version is not automatically verified for this task bridge.
- A working **Claude Team login** established in Claude Code's own flow. Other account types are rejected by the configured account metadata checks.
- Socket Firewall (`sfw`) for the dependency-install command below, which retains dependency screening.

Do not retrieve a token or supply an API key to configure this bridge. Sign in or change accounts through the official CLI first.

From this local checkout, review the side effects and run:

```sh
sfw bun install --frozen-lockfile
bun run configure
bun run check
bun run link
```

| Command | Effect |
| --- | --- |
| Dependency install | Installs locked dependencies; no Claude inference. |
| `configure` | Checks the executable version and nonsecret account metadata, then writes user-scoped configuration; no inference. |
| `check` | Checks the pinned version/account and exercises the JSON Schema parser without credentials and with OS networking denied; no inference. |
| `link` | Registers this checkout as a user-scoped OMP plugin; no inference. |

For a deliberately selected, already logged-in Claude profile, use `bun run configure /absolute/path/to/claude-profile`. Omitting the profile selects the default Claude profile, not an inherited `CLAUDE_CONFIG_DIR` override. Configuration does not log you in, copy credentials, change billing settings, or prove paid credits are disabled. An initial dependency install blocked transitive `onnxruntime-node` and `protobufjs` postinstall scripts; the installed OMP CLI and earlier checks worked without enabling them. Do not enable lifecycle scripts just to eliminate that notice.

The manifest loads `./src/extension.ts`; `omp plugin link .` links this package into OMP (under the default layout, `~/.omp/plugins/node_modules/omp-agent-bridge → this checkout`). The bundled skill is discovered at `skills/claude-bridge/SKILL.md`, not copied into `~/.omp/agent/skills/`. XDG storage can move OMP's data root. Verify discovery with `omp read skill://claude-bridge`. Start a **fresh OMP session** after linking or changing registration/skill metadata: the link exposes file edits, but a running session may retain code or instructions. Moving the checkout breaks the link; relink at its new location and restart OMP. To disable without removing the checkout or account pin, run `omp plugin disable omp-agent-bridge`.

## Delegating a task

Start OMP in the directory Claude should work in. The bridge canonicalizes that invocation directory; it does not require a Git repository, a base ref, or a clean working tree. Invoke `/skill:claude-bridge` or ask OMP to delegate a specific task. Give the primary requirements and relevant paths in the prompt. For an independent review, gather the actual diff/base and requirements yourself and pass that evidence in the prompt or as workspace files: the bridge does **not** capture a Git diff or target identity automatically.

| `claude_task` field | Meaning |
| --- | --- |
| `prompt` | Task and evidence, 1–32,000 characters. |
| `mode` | Required: `work` permits implementation and experiments, including experiments during a review; `read-only` deliberately limits a task to static reading. |
| `model` | Optional exact `claude-…` model ID containing a numeric version; defaults to the configured model (`claude-sonnet-5` by default). No aliases. |
| `timeoutSeconds` | Optional integer execution deadline, 1–1,800 seconds; defaults to 600. The supervisor allows another 60 seconds for preflight and lifecycle overhead, with parent watchdog actions 5/10 seconds later. |

There is no caller-supplied executable, credential, environment, tool list, argv, or cwd field. The selected model, directory, mode, deadline, billing warning, and authority are displayed before approval. The interactive confirmation authorizes **one** invocation; declining sends no inference request. OMP's general `exec` tool approval classification and the bridge's own confirmation are separate.

For example, ask OMP to delegate with `{"prompt":"Investigate the parser edge case; use a temporary experiment to validate your conclusion.","mode":"work","model":"claude-opus-5-5"}`. Model availability is determined by your Claude account, not this plugin. The default remains `claude-sonnet-5`; another exact model ID is selected per invocation and displayed for approval. Fable models can require paid credits even before other included allowance is exhausted; Claude's noninteractive mode does not ask for its own additional consent.

**Work authority:** Claude may run arbitrary shell programs, edit or delete files, create temporary experiments, and access the network with the OS user's authority. The bridge disables normal Claude customizations, MCP/Chrome/slash commands, and session persistence, but this is not an OS sandbox or filesystem containment. A failure, timeout, or cancellation does not roll back edits; inspect actual changes before trusting the answer, retrying, or committing. The bridge does not automatically publish or commit work.

Work mode uses Claude's `bypassPermissions` with the default built-in tool set; organization policy still applies. The approved directory is a starting location, not a filesystem fence. Commands can access other local files, credentials, programs, and services. The controlled launch environment and lock govern the bridge's own dispatch, not arbitrary child programs: they do not prevent a shell from launching another harness, exporting data, or detaching a process. Use work mode only for trusted tasks. Normal customizations remain disabled so repository hooks, plugins, and integrations do not silently enlarge the handoff; include relevant repository instructions in the task prompt.

**Read-only authority:** the CLI uses restricted mode, Read/Grep/Glob, `dontAsk`, and denials for shell/edit/write/agent/task/web-fetch/web-search/MCP tools. Administrator-managed policy remains trusted. Restricted-mode file confinement is a Claude policy, not an independent OS security boundary. In either mode, use only data you are authorized to send to Claude.

A successful tool response is `{status: "succeeded", cwd, model, mode, answer, limitations}`. Confirm the reported model and assess the answer against the workspace and requirements. A failed response is `{status: "failed", code, message}`; it is not a completed task and changes may remain. The bridge accepts a matching exact model or the same model with a date suffix, and a successful terminal result only. Each call starts a new process; there is no resumed conversation, automatic post-implementation hook, unattended batch mode, or bridge retry. CLI-internal retries may occur within the invocation.

### Standalone operator command

From the intended working directory in an interactive terminal:

```sh
bun /absolute/path/to/omp-agent-bridge/src/cli.ts task \
  'Inspect the failing behavior and implement the scoped fix.' --mode work \
  --model claude-sonnet-5 --timeout 600
```

For a longer or sensitive prompt, use `--prompt-file /path/to/prompt.txt` instead of the positional prompt. Use `--mode read-only` for consultation. Both stdin and stdout must be terminals; type `RUN ONCE` at the approval prompt. A positional prompt appears in the operator CLI process arguments; the prompt file avoids that exposure. The bridge passes the task to Claude over stdin, not Claude's argv.

## Policy and lifecycle

The [current Claude Code legal guidance](https://code.claude.com/docs/en/legal-and-compliance) distinguishes ordinary end-user use of an **unmodified** Claude Code binary with the user's own subscription login from developer-built products that intermediate credentials or inference. It permits end users to sign into that binary even when another platform hosts it, while imposing conditions on products/services: do not modify its authentication methods, intermediate or resell usage, or use Anthropic/Claude Code branding as a product or feature name. **Interpretation, not Anthropic endorsement:** this local bridge invokes the official binary for its signed-in user and does not transplant its tokens into an OMP provider. The guidance is not blanket permission for SDK embedding or hosted resale; reassess terms before changing distribution or authentication. The public display name is OMP Agent Bridge; “Claude Code” here names the upstream CLI factually.

Anthropic's [subscription accounting notice](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) states that SDK, `claude -p`, and third-party app usage draw from subscription limits, with an older separate-credit proposal paused. This is a billing statement, not general authorization for every integration. A model pin, deadline, account check, or unchanged usage display cannot prevent paid-credit charges. If zero additional charges are required while paid credits are enabled, do not initiate live work.

The bridge passes a controlled child environment to the official CLI while preserving its own stored login and the OS account environment needed for macOS Keychain selection. It pins Team organization/profile and CLI version, uses the configured model as default and a same-model fallback, and never switches to a provider/API credential. Work mode retains a usable PATH for ordinary development tools. Normal customizations are disabled in both modes, but administrator policy is trusted. The bridge does not maintain a prompt/result log or copy credentials; OMP may store tool input/results, the operator CLI prints its result, and Anthropic processes submitted content under the applicable policy. `--no-session-persistence` is not a zero-retention guarantee.

A separate supervisor holds a parent stdin lease: EOF or termination requests cancellation; deadlines terminate the process group. Bounded concurrent stdout/stderr draining prevents a full pipe from blocking termination. These mechanisms do not imply provider-side cancellation or a usage refund. One-flight locking prevents simultaneous requests under this local configuration; a force-killed supervisor can leave a stale lock. The credential-free offline schema check uses `--bare` and network denial; subscription-backed delegation intentionally does not use `--bare`. The CLI schema uses Draft 7 because the initial validator rejected Zod's Draft 2020-12 default. The output parser accepts either a result object or an event array ending in exactly one terminal result; incomplete or ambiguous output is rejected.

## Why the review contract was removed

Git-diff capture and a findings-only schema made the bridge unusable for general questions, non-Git workspaces, implementation, and validation experiments. Those constraints belonged to a review workflow, not the shared process supervisor. `claude_task` now returns a bounded `answer` and `limitations`; review-specific evidence and output expectations belong in the prompt. The old tool, CLI subcommand, and skill were removed rather than retained as aliases.

| Module | Responsibility |
| --- | --- |
| [src/request.ts](src/request.ts) | Generic request validation, explicit authority, model IDs, and canonical working directory |
| [src/bridge.ts](src/bridge.ts) | Approval, approved configuration identity, supervisor lease, and result validation |
| [src/worker.ts](src/worker.ts) | Lock, revalidation, task prompt, execution, and failure reporting |
| [src/claude.ts](src/claude.ts) | Launch profiles shared by live execution and the offline compatibility check |
| [src/config.ts](src/config.ts) | Account/version pin and controlled environment, preserving default versus explicit profile selection |
| [src/process.ts](src/process.ts) | Bounded pipes, cancellation, deadlines, and process-group termination |
| [src/result.ts](src/result.ts) | Draft 7 answer schema, complete-result and selected-model checks |
| [src/extension.ts](src/extension.ts), [src/cli.ts](src/cli.ts) | OMP and interactive operator adapters |
| [skills/claude-bridge/SKILL.md](skills/claude-bridge/SKILL.md) | Conditional task and review workflow |

The wire request is capped at 200,000 bytes; Claude output and supervisor output are each capped at 1,000,000 bytes including stderr. Answers are limited to 64,000 characters with up to 20 limitations of 4,000 characters each. Limits bound execution/output, not monetary spend.

## State and recovery

Configuration is stored at `~/.config/omp-agent-bridge/config.json` (mode `0600` under a `0700` directory), containing executable/version, profile selection, organization ID, and model metadata—not credentials. Do not publish it. `task.lock` is created beside the config for single-flight execution. It has no PID and cannot establish liveness itself. OMP's plugin enablement/link state is separate, and bridge configuration is not scoped to an OMP profile.

### Migrating the earlier installation

This is a clean rename, not an old-name fallback. Before migrating another checkout, stop bridge tasks and confirm the old lock is absent; then uninstall the old `omp-review-bridge` plugin, rename the checkout, and move its configuration directory to `~/.config/omp-agent-bridge` without changing the configuration bytes. Stop if the destination already exists rather than merging or overwriting it. Link this package with `omp plugin link .` and run `bun run verify`. New executions use `task.lock`; never move an active lock to the new name.

Start a fresh session or reload plugins after the move. A running OMP session can retain old tool/skill paths, including expanding `skill://` tokens in shell commands to the removed location. Do not restore old-path symlinks to mask that stale session state.

| Code or symptom | Response |
| --- | --- |
| `not_configured` | Check prerequisites/config validity; authorize `configure` only when appropriate. |
| `subscription_required` / `account_changed` | Resolve the intended Team login/profile in Claude Code. Reconfigure only for an intended, authorized pin change; never copy credentials or substitute an API key. |
| `version_changed` / `unsupported_version` | Inspect CLI compatibility and run offline checks before re-pinning. Do not bypass the version gate to silence it. |
| `schema_incompatible` | Investigate CLI/schema compatibility; the check's schema-parser subprocess is credential-free and network-denied. |
| `approval_required` | Use an interactive session with fresh confirmation; do not bypass headless refusal. |
| `invalid_request` / `invalid_workspace` | Supply the generic request fields and an existing working directory; old review fields are no longer accepted. |
| `config_changed` | Configuration changed while approval was pending. Inspect the intended pin, then request fresh approval. |
| `busy` | Wait for the active task. If a supervisor was force-killed, verify it and its Claude children stopped before authorizing stale-lock removal. |
| `quota_exhausted` | Stop rather than switch to paid/API capacity or auto-retry; classification is not a guaranteed hard spending limit. |
| `permission_denied` / `model_mismatch` / `invalid_result` / `delegate_failed` | Inspect policy, actual changes, compatibility, and usage before considering a newly approved attempt. |
| `timeout` / `cancelled` / `output_limit` | Inspect partial workspace changes and usage. Narrow the task if appropriate; any attempt requires new approval. |

For an upgrade, authorize dependency/config changes, inspect changed OMP/Claude behavior, install locked dependencies, run offline checks, and re-pin only after a compatibility decision. Restart OMP to load updates through the plugin link. Do not change Git authentication/signing or billing settings merely to pass a check or commit. This checkout has no Git remote yet; linking is local and does not publish it.

## Verification record

The earlier **review-only** bridge was checked on 2026-09-23 with OMP 18.2.11, Claude Code 2.1.281, and Bun 1.3.14. Six behavioral tests and TypeScript checking passed at that time. After two approved attempts exposed a local schema incompatibility, an authorized review found an injected arithmetic defect in a disposable Git fixture; the target remained unchanged. Its severity label was excessive. OMP registered the old `claude_review` tool and discovered its then-named skill; a noninteractive review returned `approval_required`. The paid-credit display did not change during that smoke, which proves neither attribution nor future free usage. Fixtures were removed; no remote repository or package publication was provisioned.

**The historical review smoke does not verify live generic delegation.** The refactor was verified locally on the same installed versions:

- TypeScript checking and all eight behavioral tests passed.
- Both real Claude launch profiles passed the credential-free, network-denied compatibility check.
- A disposable executable fixture exercised the actual bridge/supervisor in a non-Git workspace: declined approval prevented dispatch, approved work executed a shell experiment, split UTF-8 output survived parsing, the selected model was validated, a read-only request completed, a configuration change after approval prevented dispatch, and timeout preserved side effects while releasing the lock. This validates bridge mechanics, not Claude's live behavior or permission enforcement.
- A fresh OMP runtime registered and activated `claude_task`, exposed its generated request schema, and no longer exposed `claude_review`. `omp read skill://claude-bridge` resolved the bundled workflow.
- The standalone CLI rejected a headless task. In an actual terminal, `--prompt-file`, mode/model/deadline presentation, and declining `RUN ONCE` were exercised; the result was `approval_required` with no inference dispatch.

Repeat local checks with `bun run verify` (`typecheck`, tests, then `check`). `check` requires the matching local configuration/account/version on macOS. No new live inference was run: real task completion, work-mode edits, and alternative model availability remain unverified. A live smoke needs separate approval and should verify the answer and actual workspace effects, then compare `/usage`. An offline check creates ordinary local state; it does not imply zero filesystem effects.

Previously unverified cases include live quota exhaustion, account-switch races, parent-crash/force-kill containment, hostile repository escape resistance, other operating systems, every OMP UI transport, and provider-side cancellation.

### Rename verification — 2026-09-24

- Renamed the checkout, package/lockfile identity, plugin registration, configuration directory, and lock to `omp-agent-bridge` / `task.lock`.
- Preserved the existing configuration byte-for-byte with its `0600` file and `0700` directory modes; no account, credential, billing, dependency, or version-pin changes.
- `bun run verify` passed after the move: TypeScript, eight tests, and both offline Claude profiles against pinned CLI 2.1.281.
- A fresh OMP 18.3.0 runtime loaded and activated `claude_task` from the new plugin path without the old tool. Direct fresh-process skill lookup loaded the bundled workflow from the renamed installation.
- A deliberately invalid configuration fingerprint exercised creation/removal of `task.lock` and was rejected before preflight/inference. Temporary probes were removed.
- No Git remote was configured, and lookup/list/search found no accessible bridge repository under the expected GitHub owner. No repository was created, renamed remotely, or pushed. No live inference was run.


## References

- [Claude Code programmatic execution](https://code.claude.com/docs/en/headless)
- [Claude Code authentication](https://code.claude.com/docs/en/authentication)
- [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- [Claude model configuration and usage credits](https://code.claude.com/docs/en/model-config)
- [OMP plugin linking and capability discovery](https://github.com/can1357/oh-my-pi/blob/v18.2.11/docs/plugin-manager-installer-plumbing.md)
- [OMP extension packaging](https://github.com/can1357/oh-my-pi/blob/v18.2.11/docs/skills/authoring-extensions.md)
- [OMP skill discovery](https://github.com/can1357/oh-my-pi/blob/v18.2.11/docs/skills.md)
