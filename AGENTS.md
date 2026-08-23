# Project agent instructions

## Required first steps

- Before any task action, load only the immediately required allowlisted key from `.agents/config.md` through a non-printing loader. Never call a generic read tool on this file or render, print, commit, or transmit its contents.
- Read the relevant files under `.agents/knowledge/` before making assumptions about runtime accounts, providers, roles, tiers, endpoints, or test fixtures. Keep secret values out of transcripts and handoff records.
- Write verification scripts and verification command blocks in Bash (`bash`/`sh`) by default, including on Windows. Use Git Bash or WSL when available. Use PowerShell only when the user explicitly requests it or when the verification cannot run in Bash; document that exception. Manual verification must not use `set -o pipefail`, `set -e`, `set -Eeuo pipefail`, or another fail-fast wrapper that can terminate the interactive shell. Run steps independently, capture and print each target command's immediate exit status, and do not treat a wrapper's final exit code as evidence for an earlier command. Leave the terminal open after failures.
- Make sure all the necessary tools and credentials work before taking task actions.
- Do one task at a time. A task is complete only after implementation, verification, commit, push, PR handoff, and relevant tracker update are complete.
- Preserve unrelated dirty files. Never stage, modify, discard, or overwrite another person's work.

## Branches and publication

- Start new work from `main` on a `task/<topic>` branch.
- For a fix to an existing PR, branch from that PR's branch and update the existing PR; do not open a duplicate unless asked.
- Commit, push, and open a PR without requesting permission when the repository/remote is in scope. Use a draft PR unless asked for ready review.

## Human reviewability and PR sequencing

- Treat human attention as a finite review budget. Each PR must represent one coherent behavior or one independently verifiable delivery unit that a human can understand, test, and manually verify in one focused review.
- Apply a hard split when a change contains multiple independent outcomes, crosses unrelated product areas, combines separate migration/behavior or infrastructure/application concerns, or cannot be explained and verified as one focused unit. Do not use an arbitrary line-count threshold as a substitute for review judgment.
- Before implementation, write the PR shape: each PR's focused scope, base branch, review position, dependency chain, merge condition, and manual verification boundary.
- Use stacked PRs when a later review unit depends on an earlier one. State the review and merge order explicitly, keep each branch based on its predecessor, and merge from the bottom of the stack upward.
- Use parallel PRs only when the units have no required dependency or conflicting shared change. Give the group a shared label/order and state that its members may be reviewed or merged independently.
- Every PR description must include a `Review and merge order` section identifying this PR's position, base/dependencies, parallel group, merge conditions, and the human-verification focus. Keep unrelated cleanup out of the review unit.
- Every PR description must include exactly one manual-verification section. It must contain the copy-pasteable Bash command(s), prerequisites, expected result or status, and explicit limitations for any unrun live flow. If a manual-check section already exists, update it in place; never append a second manual-check section or replace the command with a summary of the local result. Before handoff, re-read the rendered PR body and verify the section count and command are present.

## Routing

- For UI/frontend work, read [frontend workflow](.agents/workflows/frontend.md) in full, then spawn the required frontend implementation subagent.
- For backend, API, authentication, database, or migration work, read [backend workflow](.agents/workflows/backend.md) in full before implementation.
- For Linear, GitHub, issue, PR, or release work, read [delivery workflow](.agents/workflows/delivery.md) in full.
- For creating or editing an agent skill, read [skill workflow](.agents/workflows/skills.md) in full.

## Task-ID protocol

For a request containing a Linear issue ID such as `AZH-385`:

1. Read `./.agents/config.md` without printing it.
2. Read [the delivery workflow](.agents/workflows/delivery.md) in full before any task-specific repository search, shell command, connector/API call, or implementation. Before implementation, also read every routing workflow applicable to the target path; changes under `.agents/skills/` require `.agents/workflows/skills.md`.
3. Use the connected Linear tool such as Linear MCP. If it is not immediately visible, discover the available tools first.
4. If the connected Linear tool is genuinely unavailable after discovery, immediately use the documented Linear API fallback. Use the official schema or documentation, load only the required credential without output, and never guess requests or bypass an authorization failure.
5. Read the issue, relations, comments, project, and valid team statuses.
6. If the description is incomplete, analyze it first and update it with the human-readable [Linear issue-description template](.agents/templates/linear-issue-description.md). Keep its top-level structure limited to TL;DR, Process Flow, Before-After, and Implementation Manual Test and Verification. Treat that template as a closed heading schema: copy only its headings in the same order; do not add headings or import sections from another template or repository. Put extra implementation detail in prose or lists under an existing heading, or in the agent-facing comment.
7. Preserve user-supplied reference material (including HTML, screenshots, designs, and examples) verbatim in the appropriate human-description section; never replace, trim, or paraphrase the reference unless the user explicitly asks.
8. After the human description is saved, inspect the relevant code and tests, complete the [Linear agent-comment template](.agents/templates/linear-issue-comment.md), and post it as an agent-facing comment. A mockup, full HTML file, screenshot, or one-line request is reference material, not an implementation-ready contract; the comment must add Category, confirmed code-backed analysis, scope boundaries, implementation plan, Definition of Done, correctness checks, and execution controls.
9. The two Linear updates are a hard readiness gate: private reasoning, a todo list, a chat summary, or a code comment does not satisfy it. Verify both tracker mutations succeeded, then re-read the saved human description and agent comment before creating a branch, editing implementation files, moving the issue active, or delegating implementation.
10. Treat the completed human description and agent comment together as the implementation contract. Only then begin implementation. For frontend work, also follow the frontend workflow and its delegation requirement.

- For visual-reference work, UML sequence diagrams are the default for Process Flow, Before, and After. The readiness re-read must confirm the saved tracker rendering itself, exact inline-asset/source pairing, and that each artifact uses UML sequence notation with actors/participants as lifelines, directional messages, and return/activation markers. Only an explicit source request for another diagram type overrides this default; do not substitute a generic architecture, box, or flowchart diagram. API or text-presence counts alone do not satisfy the gate.
- Before the readiness gate passes, validate the saved description against every heading and instruction in `.agents/templates/linear-issue-description.md`: require exactly the four top-level headings in the template's order, Step 0–4 under Implementation Manual Test and Verification, separate Bash verification blocks with per-step exit statuses, no bracketed placeholders/fake records/mocks, and explicit limitations for unrun live flows. API/text-presence counts alone do not establish template compliance.
- Cross-repository guardrails do not transfer automatically: when a recommendation changes agent behavior, apply the equivalent local rule to this repository's `AGENTS.md` before the next task, or record an explicit exception and verify that the active repository already has an equivalent rule.

## Credentials and delivery preflight

- Never print, echo, commit, or transmit `.agents/config.md` or any secret value.
- Do not use a generic file-read tool that renders `.agents/config.md` into a transcript. Load only the allowlisted key needed for the immediate operation through a non-printing secret-loading mechanism; do not recover or copy a literal credential from prior conversation, tool output, memory, or a previous command.
- Reading config does not export values into the current shell environment. Never assume a credential environment variable is available.
- Prefer authenticated connectors for Linear and GitHub. Do not manually inject project secrets into `curl` or other direct HTTP commands.
- Before changing code for a task that requires GitHub delivery:
   1. Resolve the intended GitHub CLI executable with a platform-appropriate path-inspection command. Verify that it is the official GitHub CLI, not an npm package, shell alias, or wrapper.
   2. Run a non-interactive authentication and repository-access check with that resolved executable, without overriding a working stored credential.
   3. Verify the GitHub connector can access the repository if it will be used.
- If authentication or repository access fails, stop before implementation, record the blocker in Linear, and tell the user exactly which credential/integration must be fixed.
- Never invoke interactive `gh auth login` in an unattended agent workflow.
- Do not write, edit, generate, or stage implementation files until the GitHub delivery preflight succeeds and a `task/<topic>` branch has been created from `main`. If unrelated work makes that unsafe, use an isolated worktree or stop and report the blocker.
- Never report a check as passed, a build as successful, or a task as complete unless the recorded target command exited successfully. For compound command blocks, capture and report each target command's immediate exit status; the wrapper's final exit code is not evidence for an earlier command. State pre-existing failures separately with the exact command and affected path; do not describe a partial compile or filtered output as a successful build.
- Before declaring Vault, Casdoor, PostgreSQL, or another configured runtime dependency unavailable, inspect the relevant project knowledge and configuration sources and use any available read-only infrastructure capability. Distinguish a rejected credential from an unavailable service and from an undeployed application endpoint.
- Before staging and again before handoff, inspect `git status --short` and preserve unrelated files. Put generated screenshots, browser traces, lint captures, and other diagnostics outside the repository or in an ignored temporary directory; remove only artifacts created by the current task.
