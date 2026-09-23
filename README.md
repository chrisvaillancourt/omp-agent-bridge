# OMP Review Bridge

Request an independent Claude Code review from an OMP session without opening another harness or copying the result back manually.

This is an **OMP plugin containing a custom tool and a skill**, backed by the **official Claude Code CLI in one-shot mode**. It is not an OMP model provider, Claude Agent SDK application, MCP server, or ACP adapter.

```text
/skill:claude-review or a review request to OMP
    → claude_review tool
    → explicit approval for this invocation
    → independent supervisor
    → official claude -p process using its own Team login
    → validated findings returned to OMP
```

**Billing warning:** subscription authentication does not guarantee that a request stays within included allowance. If the Team organization has paid usage credits enabled, a review may charge them. This bridge cannot read that balance or enforce a zero-additional-spend limit. Every review requires a fresh interactive approval; headless review calls are refused.

## What is implemented

- Static review of tracked changes against an explicit Git base: either base-to-HEAD in a clean tracked checkout, or base-to-working-tree including tracked uncommitted changes.
- A pinned Team organization, CLI version, profile selection, and Sonnet model.
- A restricted read-only Claude tool profile, controlled child environment, output limits, cancellation, and deadlines.
- Structured findings with repository-relative locations and reviewed-target identity.
- One in-flight review per local bridge configuration, with no bridge-level automatic retry.
- A linked OMP installation and offline compatibility/behavior checks.

Each review starts a new Claude Code process. There is no conversation resume, daemon, automatic post-implementation hook, unattended batch mode, editing, test execution, or review publication. The skill guides OMP's workflow; it does not launch work by itself.

## Installation and setup

### Prerequisites

- **macOS:** configuration explicitly rejects other platforms. The compatibility check uses macOS `sandbox-exec`, and lifecycle handling uses POSIX process groups.
- **Bun 1.3.14 or newer** and Git.
- **OMP:** runtime integration was verified with **18.2.11**.
- **Official Claude Code:** initially verified with **2.1.281**. The current version gate accepts the 2.1 series starting at that version, then pins the exact configured version. A later version is not automatically considered verified.
- A working **Claude Team subscription login** established through Claude Code's own login flow. Other account types are not accepted by the current metadata checks.
- Socket Firewall (`sfw`) for the dependency-install command below. This project's installation procedure keeps dependency screening in place.

Do not retrieve a token or supply an API key to configure this bridge. If you need to sign in or change accounts, do it through the official Claude Code UI first.

### Install from a local checkout

Run these commands from the bridge repository, reviewing their side effects first:

```sh
sfw bun install --frozen-lockfile
bun run configure
bun run check
bun run link
```

| Command | Effect |
| --- | --- |
| Dependency install | Installs the locked dependencies. No Claude inference. |
| `configure` | Finds `claude` on PATH, checks its version and nonsecret account metadata, and writes user-scoped bridge configuration. No inference. |
| `check` | Checks the pinned version/account and exercises Claude's JSON Schema parser without credentials and with OS networking denied. No inference. |
| `link` | Runs `omp plugin link .`, registering this checkout as a user-scoped plugin. No inference. |

For a deliberately selected Claude profile that is already logged in:

```sh
bun run configure /absolute/path/to/claude-profile
```

Omitting the profile means the default Claude profile, not an inherited `CLAUDE_CONFIG_DIR` override. The bridge deliberately filters the ambient environment. Configuration does not log you in, copy credentials, change billing settings, or prove that paid credits are disabled.

The development dependency on OMP supplies TypeScript interfaces. During the initial install, Bun blocked the transitive `onnxruntime-node` and `protobufjs` postinstall scripts; the documented checks and installed OMP CLI worked without enabling them. Do not enable dependency lifecycle scripts merely to eliminate that notice.

### How the tool and skill are installed

The [package manifest](package.json) declares:

```json
"omp": {
  "extensions": ["./src/extension.ts"]
}
```

`omp plugin link .` symlinks the package into OMP's plugin directory and records it as enabled. Under the default user data layout, the link is:

```text
~/.omp/plugins/node_modules/omp-review-bridge → this checkout
```

OMP loads the extension, which registers `claude_review`, and discovers the sibling `skills/claude-review/SKILL.md` through its plugin capability provider. **The skill is bundled with the plugin; it was not copied into `~/.omp/agent/skills/`.** OMP can use different data roots when configured for XDG storage.

Verify the installed skill:

```sh
omp read skill://claude-review
```

Start a **fresh OMP session** after linking or changing tool registration/skill metadata. The symlink exposes subsequent file edits without another copy or install, but an already-running session may retain loaded code or instructions. Moving/deleting the checkout breaks the link; relink the new location and restart OMP.

To disable the plugin without deleting its source or account pin:

```sh
omp plugin disable omp-review-bridge
```

## Requesting a review

Start OMP at the **target Git repository root**, not necessarily this bridge repository. Invoke:

```text
/skill:claude-review
```

Or ask: “Get a Claude review of these changes against main.” Establish the actual base and requirements with OMP; the skill's detailed workflow is in [SKILL.md](skills/claude-review/SKILL.md).

The tool's request fields are:

| Field | Meaning |
| --- | --- |
| `base` | Commit or ref, resolved to a commit before approval. This is a direct diff base, not an automatic merge-base calculation. |
| `workingTree` | Defaults to `false`. Set `true` to include tracked uncommitted changes. |
| `requirements` | Intended behavior and review focus, without the implementing agent's favorable conclusions. |

There is no caller-supplied executable, credential, environment, model, tool list, arbitrary argv, or repository field. The repository comes from the OMP invocation context.

OMP displays the repository, base/HEAD, model, and billing warning before dispatch. Declining approval sends no inference request. Each subsequent invocation, including an attempt after failure, requires another approval. OMP's general tool approval classification is `exec`; the bridge's own confirmation is separate.

### Standalone operator command

From the target repository root, in an interactive terminal:

```sh
bun /absolute/path/to/omp-review-bridge/src/cli.ts review main \
  'Describe the required behavior and review focus here.' --working-tree
```

Omit `--working-tree` for a clean tracked checkout. The CLI requires both stdin and stdout to be terminals and asks you to type `REVIEW ONCE`. Piping the invocation will not bypass this gate.

The CLI's requirements argument is visible in its process arguments; use it only for suitable nonsecret text. The bridge sends the assembled diff and prompt to Claude over stdin, rather than placing them in Claude's argv.

### Scope and results

- Untracked files are not included in the diff target. Decide explicitly whether to stage/commit new files before asking for review. This exclusion is not a filesystem secrecy boundary: Claude can read repository context through its permitted tools.
- The reviewer reads the live checkout. Before/after identities detect many target changes but do not create an immutable filesystem snapshot. Stop concurrent writes during review.
- The target identity covers resolved base, HEAD, diff, and Git status. It is not a digest of every file or a general tamper-proof workspace guarantee.
- A successful response contains `status: "succeeded"`, the target identity, and a review with `summary`, `findings`, and `limitations`. Each finding has `priority` (`P0`–`P3`), `title`, `body`, `file`, and `line`.
- A failed response contains `status: "failed"`, a machine-readable `code`, and a sanitized `message`. Partial findings are not reported as a completed review.
- Treat findings and priority labels as reviewer suggestions. OMP should assess them against the requirements before acting. Empty findings are not proof of correctness.

## Why this design

### Integration choice

| Alternative | Decision |
| --- | --- |
| One-shot official `claude -p` | Chosen: documented automation interface, clear process lifetime, official client owns authentication. |
| OMP custom tool plus skill | Chosen: structured input/output and approval in code; review workflow in conditional instructions. Bundled as one plugin to avoid copied installations. |
| Skill plus ad hoc shell commands | Not the durable interface: would make each agent reconstruct execution, permissions, parsing, and cancellation. The standalone CLI remains an operator surface. |
| Persistent stream-JSON CLI | Not needed for one review at a time; adds protocol and session lifecycle state. |
| Claude Agent SDK | Not inherently separately billed, but subscription-authentication permission for this third-party integration was less explicit than invoking the unmodified CLI. Not selected. |
| Local MCP wrapper | Useful if several harnesses need this operation; unnecessary for the current OMP-only integration. |
| `claude mcp serve` | Exposes Claude Code's tools, not an independent Claude conversation/reviewer. |
| ACP adapter | Adds another integration layer without resolving the subscription-policy question. |
| Claude credentials in an OMP provider | Wrong boundary: runs OMP's agent loop and requires handling credentials outside the official client. Excluded. |

### Authentication, policy, and billing

The original goal was included Team allowance only. The operating environment had paid credits enabled, and disabling them required an administrator. The implemented compromise is **explicit approval for each potentially paid invocation**, not an included-only spending guarantee. API keys, cloud providers, gateways, and bridge-managed billing fallbacks remain excluded.

As checked on **2026-09-23**, Anthropic's [subscription accounting notice](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) says SDK, `claude -p`, and third-party app usage still draw from subscription limits; its older separate-credit proposal is paused. That is a billing statement, not blanket authorization for every SDK embedding.

Anthropic's [legal guidance](https://code.claude.com/docs/en/legal-and-compliance) permits an end user to sign into the unmodified Claude Code binary with their own subscription, including when another platform hosts it. **Interpretation:** invoking that binary locally for the same user fits this permission more clearly than reusing its credentials in another client. Anthropic does not explicitly endorse this plugin. Recheck the terms before expanding the use case or distributing a service.

The bridge builds a small child environment instead of copying OMP's environment. It lets the official CLI access its stored login, verifies first-party Team metadata before dispatch, and pins the organization/profile. A fixed Sonnet model avoids inheriting an arbitrary default. The same-model `--fallback-model` flag is not permission to switch providers or billing methods; CLI-internal retries may still occur.

**A model pin, account check, deadline, or unchanged usage display cannot prevent paid-credit charges.** Check Claude Code `/usage` before and after approved work. A failed or cancelled invocation may already have consumed usage, and reporting may lag. Do not use live reviews when zero additional charges are a hard requirement and the organization's paid capacity remains enabled.

### Review authority and privacy

The worker supplies safe/restricted mode, Read/Grep/Glob, `dontAsk`, disabled normal customizations, strict empty MCP configuration, no Chrome, and no session persistence. It denies shell, edit/write, agent, network-fetch, and MCP tools. This avoids inheriting broad permissions, hooks, and integrations from an ordinary interactive Claude session.

Administrator-managed policy still applies and remains trusted. Restricted-mode file confinement is Claude's policy, **not an independent OS filesystem sandbox**. This project has not proven resistance to hostile repository content or every descendant process escape. Use only repositories and data you are authorized to send to Claude.

The bridge does not copy credentials or maintain a prompt/result log. It suppresses raw Claude diagnostic output in favor of bounded failure information. OMP can still store tool inputs/results, the standalone CLI prints its result, and Anthropic processes submitted content under the applicable account policy. `--no-session-persistence` is not a zero-retention guarantee.

`AGENTS.md` governs agents maintaining this repository. The review skill governs OMP's review workflow. Neither is automatically loaded by the delegated Claude process in safe mode; its fixed review prompt and execution policy are implemented in the worker.

### Lifecycle and compatibility decisions

- **Separate supervisor:** the parent keeps a stdin lease open. EOF or a termination signal requests cancellation, and the supervisor has its own deadline. This is intended to outlive an OMP adapter failure long enough to terminate the Claude process group.
- **Process groups and bounded pipes:** timeout/cancellation kill the group, and stdout/stderr are drained concurrently to avoid a blocked pipe preventing termination. No provider-side cancellation or usage refund is implied.
- **Single-flight lock:** concurrent requests do not silently fan out usage. A force-killed supervisor can leave a stale lock; recovery is deliberately manual.
- **Version pin:** upgrades require a compatibility decision instead of silently changing authentication, flag, or result behavior.
- **Draft 7 schema:** the initial CLI validator rejected Zod's default Draft 2020-12 metaschema before review execution. The generated schema now targets Draft 7.
- **Two JSON envelope forms:** the installed CLI returned verbose event arrays as well as the expected result-object form. The parser accepts an object or an array ending in exactly one terminal result; it rejects ambiguous or incomplete results.
- **macOS login environment:** a sanitized launch initially appeared logged out until OS account variables were preserved. Explicitly setting the default config directory also selected a different Keychain entry on the tested machine. Configuration preserves whether profile selection was explicit rather than treating those paths as equivalent.
- **`--bare` exception:** bare mode bypasses subscription login, so it is excluded from real reviews. The offline parser check deliberately uses it without credentials and with OS networking denied. Do not reuse that launch profile for review execution.

## State, limits, and recovery

### Local state

The bridge stores configuration at `~/.config/omp-review-bridge/config.json`: schema version, executable path/version, profile selection, organization ID, and model. These are local metadata, not credential values; do not publish the file. It is created with mode `0600` under a directory created with mode `0700`.

The single-flight lock is `review.lock` beside that file. OMP's plugin link and enablement state are separate from bridge configuration. The current bridge configuration path is fixed under the home directory; it is not scoped to individual OMP profiles.

### Current operational limits

These are execution bounds, not monetary limits. The implementation is authoritative if limits change.

| Bound | Current setting |
| --- | --- |
| Review model | `claude-sonnet-5`; returned model identity is checked |
| Claude execution | 120 seconds |
| Supervisor lifetime | 180 seconds; parent watchdog actions at 185/190 seconds |
| Git command output | 512,000 bytes per command |
| Claude stdout + stderr | 1,000,000 bytes |
| Supervisor stdout + stderr at parent | 512,000 bytes |
| Request requirements | 32,000 characters; serialized worker request also capped at 40,000 bytes |
| Result collections | Up to 100 findings/limitations; text fields up to 16,000 characters |
| Concurrency | One review per local bridge configuration |

### Failures

| Code or symptom | Operator response |
| --- | --- |
| `not_configured` | Inspect prerequisites, then authorize `configure`. It may also indicate an invalid config file. |
| `subscription_required` / `account_changed` | Resolve the intended Team login/profile through Claude Code. Do not supply an API key or copy a token as a workaround. Reconfigure only when changing the pin is intended and authorized. |
| `version_changed` / `unsupported_version` | Inspect compatibility changes and run offline checks. Do not re-pin simply to bypass the gate. |
| `schema_incompatible` | Investigate the CLI/schema contract. The compatibility command denies networking; it is safe from inference billing. |
| `approval_required` | No approval was granted, or the caller is headless. Use an interactive session; do not bypass the confirmation. |
| `invalid_target` / `dirty_target` / `empty_target` | Choose the correct root/base and tracked-change scope. Do not stage or commit unrelated files merely to satisfy the tool. |
| `target_changed` | Stop competing edits and prepare a fresh target. A new invocation needs fresh approval. |
| `busy` | Wait for the active review. If a supervisor was force-killed, verify it and its Claude children are stopped before authorizing removal of the stale lock. The lock contains no PID, so it cannot establish liveness by itself. |
| `quota_exhausted` | Stop; do not switch to paid/API capacity or automatically retry. This classification is not a hard spend stop when the service already has paid credits enabled. |
| `permission_denied` / `model_mismatch` / `invalid_result` / `review_failed` | Do not treat the run as a completed review. Inspect the fixed policy/compatibility and check usage before considering another approved attempt. |
| `timeout` / `cancelled` / `output_limit` | Do not assume cancellation prevented usage. Narrow the review if appropriate; another invocation requires approval. |

To update: obtain authorization for dependency/configuration changes, inspect the relevant OMP/Claude changes, install the locked dependencies, run checks, and re-pin only when satisfied. Changes remain visible through the plugin link; restart OMP to load them. Never change Git authentication, signing, or billing settings to get a check or commit through.

## Verification and implementation record

### Repeatable checks

From this repository:

```sh
bun run typecheck
bun test
bun run check
# Or all three:
bun run verify
```

Type checking and behavioral tests do not need a Claude account. `check` additionally requires the local bridge configuration, the matching Team login/version, and macOS. Its schema-parser subprocess has networking denied; none of these commands requests a live review. They do create/use ordinary local test or CLI state, so “offline” does not mean zero filesystem effects.

A live smoke is a separate, explicitly approved operation: create a disposable Git repository with a known defect, review its tracked diff, confirm the finding and unchanged target, then compare usage and remove the fixture. Do not embed that operation into unattended verification.

### Evidence from the initial implementation, 2026-09-23

Tested with OMP 18.2.11, Claude Code 2.1.281, and Bun 1.3.14:

- TypeScript checking and six behavioral tests passed, covering incomplete results, verbose-array terminal-result selection, unexpected models/path escapes, target mutations, process-group timeout/descendant cleanup, cancellation, and output overflow.
- Two approved attempts failed local schema validation. The schema fix was exercised without authentication and then with OS networking denied before another live attempt.
- The successful authorized review found an injected subtraction-instead-of-addition defect at `sum.ts:2`; the target remained unchanged. Its P0 severity was excessive for the fixture, illustrating why the caller must assess findings rather than accept labels blindly.
- A fresh OMP runtime registered `claude_review` as active. `omp read skill://claude-review` resolved the bundled skill through the installed package link.
- A non-interactive CLI review returned `approval_required` before inference.
- The operator observed no change in the paid-credit display after the smoke. This is a limited observation, not proof of billing attribution or a future zero-charge guarantee.
- Disposable fixtures and the discovery-only OMP process were removed/stopped. Initial delivery was local: no remote repository or package publication was provisioned.

**Not verified:** live quota exhaustion, account-switch races, parent-crash/force-kill containment, malicious repository escape resistance, alternate operating systems, every OMP UI transport, or provider-side cancellation. These limits are not covered by the successful arithmetic smoke.

### Source map

| File | Responsibility |
| --- | --- |
| [src/extension.ts](src/extension.ts) | OMP tool schema, execution approval classification, interactive confirmation, and result presentation |
| [skills/claude-review/SKILL.md](skills/claude-review/SKILL.md) | Conditional review workflow and interpretation/authorization guidance |
| [src/cli.ts](src/cli.ts) | Operator configure/check/review commands |
| [src/config.ts](src/config.ts) | Local metadata schema, controlled environment, account and version preflight |
| [src/target.ts](src/target.ts) | Git target resolution, diff capture, and change identity |
| [src/review.ts](src/review.ts) | Caller-side approval, supervisor lease, bounded result handling |
| [src/worker.ts](src/worker.ts) | Single-flight lock, revalidation, fixed Claude prompt/flags, result completion |
| [src/process.ts](src/process.ts) | Bounded child process execution and group termination |
| [src/result.ts](src/result.ts) | Draft 7 output schema and result/model validation |
| [src/compatibility.ts](src/compatibility.ts) | Credential-free, network-denied schema parser handshake |
| [tests/bridge.test.ts](tests/bridge.test.ts) | Behavioral regression coverage |
| [AGENTS.md](AGENTS.md) | Repository maintenance and logically grouped Conventional Commit policy |

The repository intentionally keeps the operator guide here, task-specific agent guidance in the skill, and minimal always-loaded maintenance constraints in `AGENTS.md`. There is no parallel global skill copy to synchronize.

## Reference documentation

- [Claude Code programmatic execution](https://code.claude.com/docs/en/headless)
- [Claude Code authentication](https://code.claude.com/docs/en/authentication)
- [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- [Claude subscription accounting notice](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [Claude model configuration and usage credits](https://code.claude.com/docs/en/model-config)
- [Claude Code MCP server distinction](https://code.claude.com/docs/en/mcp#use-claude-code-as-an-mcp-server)
- [OMP plugin linking and capability discovery](https://github.com/can1357/oh-my-pi/blob/v18.2.11/docs/plugin-manager-installer-plumbing.md)
- [OMP extension packaging](https://github.com/can1357/oh-my-pi/blob/v18.2.11/docs/skills/authoring-extensions.md)
- [OMP skill discovery](https://github.com/can1357/oh-my-pi/blob/v18.2.11/docs/skills.md)

OMP users can also read the installed documentation through `omp://plugin-manager-installer-plumbing.md`, `omp://skills/authoring-extensions.md`, and `omp://skills.md`.
