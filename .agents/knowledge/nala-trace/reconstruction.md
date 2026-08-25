# Nala Trace reconstruction heuristics

Nala Trace reconstructs conversation and operation evidence from the stored
Codex hook payload. It does not read rollout-log or transcript files because
those formats are undocumented and can drift between Codex versions.

## Conversation

`UserPromptSubmit` events become `user` conversation items and `Stop` and
`SubagentStop` events become `assistant` conversation items. Each emitted
conversation item retains its source timeline event ID so the UI can render
messages, tool calls, and lifecycle records in captured order. Content is
selected from the event payload in this order:

- user prompt: `prompt`, `user_prompt`, `content`, `text`
- assistant stop: `last_assistant_message`, `response`, `stop_message`,
  `message`, `content`, `text`

The first non-null, non-empty value is preserved as JSON. Missing content is
skipped while the event remains in the timeline. The stored turn ID and event
timestamp are retained on emitted items.

## Skill evidence

A skill invocation is explicit when the payload contains a non-empty `skill`
or `skill_name` field, either at the event root or inside `tool_input`. Captured
`skills` arrays are also explicit evidence, with one record per non-empty skill
name. A tool whose name contains `skill` is recognized: a `tool_input.name`
value is treated as inferred evidence, and a tool name without a usable skill
name is reported as ambiguous. A read of a canonical
`.../skills/<name>/SKILL.md` document is inferred skill evidence, including
project, user-level, plugin, Windows, and duplicate-separator paths. The
detector does not infer a skill from arbitrary prose or from a path that merely
contains the word `skill`.

## File-operation evidence

The detector is intentionally conservative:

- `apply_patch` file headers are explicit evidence. Add/update maps to
  `write`, delete maps to `delete`, and move maps to `modify`.
- Recognized file tools and structured `operation`/`action` values provide
  explicit read/write/delete evidence from fields such as `file_path`, `path`,
  `target_file`, and `filename`.
- A small set of shell markers (`cat`, `Get-Content`, `Set-Content`,
  `Out-File`, `tee`, redirection, `rm`, and `Remove-Item`) provides inferred
  evidence when a path can be extracted.
- A concrete path without a recognizable action is returned as
  `operation=ambiguous` and `confidence=ambiguous`; no certain read or write
  claim is made.

Every typed skill/file record retains its source event ID and tool-call
metadata when available. This is evidence, not proof of complete filesystem
activity: `unified_exec` and `WebSearch` may not emit complete hook pairs, and
the detector does not claim operations for events that were never captured.
