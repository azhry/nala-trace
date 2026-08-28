---
name: session-evaluator
description: Evaluate an annotated Nala Trace session for pass/fail, critique, review signals, judge alignment, and instruction-improvement ledger entries. Use when a reviewed session needs a final quality judgment, evaluator report, or persisted evaluation.
---

# Session Evaluator

Evaluate a captured Nala Trace session after annotation. The evaluation must be reproducible from the session trace, the saved annotation, the user request, and the applicable project instructions.

## Workflow

1. Load the full session detail and its persisted annotation. If annotation is missing, stop with a limitation or run [session-annotator](../session-annotator/SKILL.md) first; do not silently substitute labels.
2. Read the applicable repository instructions, knowledge, and workflow files. Compare the requested outcome with observable behavior and verification evidence.
3. Set `pass` only when the session satisfies the applicable requirements with sufficient evidence. Set `fail` for a material defect or instruction violation. Set `unknown` when evidence is incomplete or contradictory.
4. Record review signals as counted, named observations (for example, unnecessary tool use, missing verification, or a required skill not invoked). Keep each detail tied to event IDs or paths.
5. Set judge alignment to `not_recorded` unless a real human/dataset label is present. Never invent a human label, agreement value, or benchmark result.
6. Record the evaluating project and concrete local instruction/workflow improvements in the ledger. Use an empty improvements array when no evidence supports a change.
7. Validate [result-schema.md](references/result-schema.md), persist with `POST /sessions/{session_id}/evaluation`, and re-read `GET /sessions/{session_id}` to verify the stored result.

## Boundaries

- Do not expose private chain-of-thought; the critique is a concise evidence summary.
- Do not turn one session-specific preference into a repository-wide rule without evidence and an explicit project owner.
- Do not create fake sessions, annotations, labels, API responses, or credentials. If the real API or MongoDB is unavailable, report the failed boundary and leave the evaluation unpersisted.
