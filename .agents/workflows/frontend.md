---
description: 
---

# Frontend workflow

Apply this workflow to new or changed UI, including fixes to an existing screen.

## Delegation

Spawn a dedicated frontend implementation subagent. It owns implementation, interaction testing, responsive verification, commit, push, and PR handoff. An exploration/research subagent may provide context, but never substitutes for this required implementation subagent; the primary agent must not perform the implementation itself. If Agent Manager cannot expose live transcript output, report that limitation and keep the implementation subagent running. Do not substitute primary-agent implementation unless the user explicitly changes the workflow.

## Implementation

- Reproduce supplied designs closely and use meaningful demo data when real data is unavailable.
- Treat supplied HTML, screenshots, and mockups as immutable visual reference material. Preserve HTML in the task description verbatim, and translate its observable requirements into a checklist before coding: content, images, colors, typography, spacing, responsive layout, and interaction states.
- When the reference contains example content, the no-real-data/demo state must render that content faithfully. Do not silently replace required images, cards, rows, or labels with empty states, placeholders, or a different data shape.
- Implement all interactions represented by the reference or existing page.
- Do not leave clickable-looking buttons, links, tabs, date controls, menus, modal actions, filters, or exports as no-ops. Implement them, remove them, or deliberately disable them with an explanation.
- Make state-changing controls update an observable UI or data outcome, not only their visual styling.

## Acceptance

- Add regression coverage at the correct seam for each new or repaired interaction.
- Verify the rendered application interactively in a browser at desktop and mobile widths. A screenshot alone is insufficient, but visual review of screenshots or the live rendered page is required for reference-matching work; DOM structure, CSS class names, or a successful page load are not evidence of visual fidelity.
- Compare the rendered result against the supplied reference before committing. Check the reference checklist explicitly, including image loading, color and typography, all specified rows/cards, and desktop/mobile layout. Fix differences before asking the user for more design direction when the reference is already specific.
- Exercise every relevant control and assert its expected visible/data result; include open/close, navigation, filtering/date changes, editing/deleting, exports, and error/empty states when present.
- Record focused test results and identify pre-existing failures separately. Only call a command successful when it exited zero; a build or lint failure elsewhere in the repository must be reported as a blocker, not as a passing verification result.
- Before staging and handoff, inspect `git status --short`; do not commit generated screenshots, browser artifacts, temporary logs, or unrelated user files.
- Unit Test, Integration Test, and lint check only be used to check whether the code is error or the API contract is correct. Those should not be used as proof that the work is done or correct.

## Handoff

Stage only intended files, commit, push, and open or update the PR. Link its URL to the related work item when applicable.
