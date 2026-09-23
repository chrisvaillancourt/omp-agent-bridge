---
name: claude-review
description: Request an independent Claude Code review after implementation or for an explicit second opinion on a Git diff. Uses the approval-gated claude_review tool, not an OMP model-provider credential.
---

# Claude Code review

1. Establish the requirements, Git base, and target repository root. Finish edits before requesting review. Use `workingTree: true` for tracked uncommitted changes; otherwise the tracked checkout must be clean. Untracked files are excluded: have the user decide whether to include them through normal staging/commit workflow rather than silently broadening scope.
2. Call `claude_review` with `base`, `workingTree`, and `requirements`. Give Claude primary evidence and review focus, not your conclusions. The tool resolves commits, captures the diff, and requires interactive user approval for exactly one request.
3. If approval is declined, setup is missing, or the target changes, report that no completed review is available. Resolve the stated prerequisite; do not bypass the tool using a shell, provider token, SDK, or alternate billing route. Headless sessions cannot approve reviews.
4. For a successful result, assess each finding against the code and requirements. Explain accepted/rejected findings, fix accepted defects when authorized, and retain limitations. An empty findings list is not proof of correctness. Another review requires another approval.
5. Report the exact reviewed base/HEAD and whether tracked working-tree changes were included. Ask the user to compare Claude Code `/usage` after the run when paid credits are enabled.

## Boundaries

Paid credits may be charged; subscription authentication is not a zero-cost guarantee. Each confirmation authorizes one request, not future reviews or retries. The bridge never changes billing settings or switches to API/provider credentials.

The reviewer uses the official CLI with normal customizations disabled and only Read/Grep/Glob. Administrator policy remains trusted. This is static review: no tests, commands, edits, or publication. Repository-root confinement is Claude's restricted-mode policy, not a separate OS sandbox. Inputs/results appear in the OMP conversation and are processed by Anthropic; do not claim zero retention.

Setup and non-inference diagnostics are available through the repository's `configure` and `check` package scripts. CLI upgrades require rechecking compatibility and reconfiguring the pinned version. Use the package's `link` script for durable OMP installation; do not copy generated tool files into another tree.
