# Maintenance constraints

This plugin delegates scoped tasks to the official Claude Code CLI. Keep subscription
credentials inside that client; introducing an OMP provider, SDK, or other
authentication route requires a separate decision.

Treat live inference as potentially billable. Obtain fresh explicit approval
for each invocation, including another attempt after a failure. An unchanged
usage balance is not a spending guarantee. Preserve the interactive approval
gate and headless refusal.

When changing authentication or CLI compatibility, inspect [account selection](src/config.ts)
and [the offline compatibility check](src/compatibility.ts). Preserve default versus
explicit profile selection and the OS account environment needed for login.
`--bare` is intentional only in the credential-free, network-denied compatibility
check—not in subscription-backed delegation.

When delegating a task, requesting an independent review, or handling setup
prerequisites, read the [bridge workflow](skills/claude-bridge/SKILL.md). Keep
that workflow conditional; do not import it into startup context.

## Commits

Always commit completed changes before handing work back. Group changes by logical
purpose and use Conventional Commit messages (`type(scope): description`, with
scope optional). Keep independent changes in separate commits; commit only your
task's changes and leave unrelated work untouched. Report any blocked commit
instead of bypassing authentication or signing controls. Committing does not
authorize pushing.
