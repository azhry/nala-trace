---
name: session-evaluator
description: Evaluate an annotated Nala Trace session for task outcome, instruction adherence, scope deviation, unsupported claims, user signals, tool/skill/file decisions, verification, evidence gaps, and agent-instruction improvements. Use when a reviewed session needs a final quality judgment or persisted forensic evaluation.
---

# Session Evaluator

Evaluate a captured session after annotation. The report must be reproducible from the ordered session trace, saved annotation, user requests/responses, and applicable agent instructions. Findings and next steps improve agent behavior or agent instructions—not the product being evaluated.

## Workflow

1. Load the full session detail and persisted annotation. If annotation is missing, stop with that limitation or run [session-annotator](../session-annotator/SKILL.md) first; never silently substitute labels. Read back stored analysis with `GET /sessions/{session_id}/analysis`.
2. Read applicable agent instructions, knowledge, and workflow files. Compare each user request, constraint, clarification, correction, approval/rejection, and final response with observable agent behavior and verification evidence.
3. Audit instruction adherence, scope deviation, unsupported claims/hallucination, tool/skill/file necessity, verification and outcome, user-alignment signals, avoidable retries/rework, handoff quality, and capture limitations. Distinguish agent failure from missing instrumentation; missing evidence is not proof of success or failure.
4. Set `pass` only when scoped requirements are met with sufficient verification evidence. Set `fail` for a material defect or instruction violation. Set `unknown` when evidence is incomplete or contradictory. State what was requested, what happened, the outcome, and decisive evidence in the critique.
5. For each review signal, include exactly one occurrence entry per observed occurrence. Every entry needs the exact event ID, event kind/time when captured, a readable description of what happened, and why it matters. `count` must equal the occurrence list length; an ID list or count alone is not a finding. State severity and keep each finding independently inspectable.
6. Set judge alignment to `not_recorded` unless a real human/dataset label is present. Never invent a human label, agreement value, or benchmark result.
7. Create actionable next steps only when evidence supports them. Each improvement must target agent behavior or an agent-instruction, skill, or workflow Markdown file; prescribe the specific wording/behavior to add, remove, or change; explain the evidence and expected effect; and cite exact evidence event IDs. Never recommend changes to application/product code in this ledger. Use an empty improvements array when no agent-side improvement is justified.
8. Validate [result-schema.md](references/result-schema.md), persist with `POST /sessions/{session_id}/evaluation`, and re-read `GET /sessions/{session_id}/analysis` to verify the stored result.

## Boundaries

- Do not expose private chain-of-thought; the critique is a concise evidence summary.
- Signal detail describes the general pattern; occurrence entries are its concrete events. Do not mine IDs from prose or claim more occurrences than the trace contains.
- Improvement paths are restricted to agent instruction Markdown or a pathless `agent_behavior` action. `evaluation_ledger.project` identifies assessment context only; it is not an improvement target.
- Do not turn one session-specific preference into a repository-wide rule without repeated evidence or an explicit user requirement. Prefer the narrowest instruction file whose scope matches the finding.
- Do not create fake sessions, annotations, labels, API responses, or credentials. If the real API or MongoDB is unavailable, report the failed boundary and leave the evaluation unpersisted.
