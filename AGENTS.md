# Project agent instructions

## Required first steps

- Before any task action, load only the immediately required allowlisted key from `.agents/config.md` through a non-printing loader. Never call a generic read tool on this file or render, print, commit, or transmit its contents.
- Make sure all the necessary tools and credentials work before taking task actions.
- Do one task at a time. A task is complete only after implementation, verification, commit, push, PR handoff, and relevant tracker update are complete.
- Preserve unrelated dirty files. Never stage, modify, discard, or overwrite another person's work.

## Branches and publication

- Start new work from `main` on a `task/<topic>` branch.
- For a fix to an existing PR, branch from that PR's branch and update the existing PR; do not open a duplicate unless asked.
- Commit, push, and open a PR without requesting permission when the repository/remote is in scope. Use a draft PR unless asked for ready review.

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
6. If the description is incomplete, analyze it first and update it with the [Linear issue-description template](.agents/templates/linear-issue-description.md).
7. A mockup, full HTML file, screenshot, or one-line request is reference material, not an implementation-ready task description. Before implementation, add the template's Category, confirmed code-backed analysis, scope boundaries, implementation plan, Definition of Done, and correctness checks to the Linear description.
8. Preserve user-supplied reference material (including HTML, screenshots, designs, and examples) verbatim. Add the implementation contract around it; never replace, trim, or paraphrase the reference unless the user explicitly asks.
9. The Linear update is a hard readiness gate: private reasoning, a todo list, a chat summary, or a code comment does not satisfy it. Verify the tracker mutation succeeded and re-read the description before creating a branch, editing implementation files, moving the issue active, or delegating implementation.
10. Treat the completed issue description as the implementation contract. Only then begin implementation. For frontend work, also follow the frontend workflow and its delegation requirement.

## Credentials and delivery preflight

- Never print, echo, commit, or transmit `.agents/config.md` or any secret value.
- Do not use a generic file-read tool that renders `.agents/config.md` into a transcript. Load only the allowlisted key needed for the immediate operation through a non-printing secret-loading mechanism; do not recover or copy a literal credential from prior conversation, tool output, memory, or a previous command.
- Do not dot-source config files. Load only allowlisted `KEY=value` entries into the current process environment without output.
- Reading config does not export values into the current shell environment. Never assume a credential environment variable is available.
- Prefer authenticated connectors for Linear and GitHub. Do not manually inject project secrets into `curl` or other direct HTTP commands.
- Before changing code for a task that requires GitHub delivery:
   1. Resolve the intended GitHub CLI executable with a platform-appropriate path-inspection command. Verify that it is the official GitHub CLI, not an npm package, shell alias, or wrapper.
   2. Run a non-interactive authentication and repository-access check with that resolved executable, without overriding a working stored credential.
   3. Verify the GitHub connector can access the repository if it will be used.
- If authentication or repository access fails, stop before implementation, record the blocker in Linear, and tell the user exactly which credential/integration must be fixed.
- Never invoke interactive `gh auth login` in an unattended agent workflow.
- Do not write, edit, generate, or stage implementation files until the GitHub delivery preflight succeeds and a `task/<topic>` branch has been created from `main`. If unrelated work makes that unsafe, use an isolated worktree or stop and report the blocker.
- Never report a check as passed, a build as successful, or a task as complete unless the recorded command exited successfully. State pre-existing failures separately with the exact command and affected path; do not describe a partial compile or filtered output as a successful build.
- Before staging and again before handoff, inspect `git status --short` and preserve unrelated files. Put generated screenshots, browser traces, lint captures, and other diagnostics outside the repository or in an ignored temporary directory; remove only artifacts created by the current task.
