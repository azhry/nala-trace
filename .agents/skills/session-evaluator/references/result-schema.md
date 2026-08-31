# Session evaluation contract

Send a JSON object shaped like this to `POST /sessions/{session_id}/evaluation`:

```json
{
  "schema_version": "1",
  "source": "session-evaluator",
  "verdict": "pass|fail|unknown",
  "critique": "Concise evidence-based assessment.",
  "review_signals": [
    {
      "name": "signal-name",
      "count": 1,
      "severity": "info|warning|critical|unknown",
      "detail": "What the signal shows, with event IDs or paths."
    }
  ],
  "judge_alignment": {
    "status": "aligned|not_aligned|not_recorded",
    "human_label": "optional real label",
    "evaluator_label": "optional evaluator label",
    "agreement": true,
    "dataset": "optional real dataset name"
  },
  "evaluation_ledger": {
    "project": "nala-trace",
    "improvements": [
      {
        "path": ".agents/workflows/frontend.md",
        "change": "Concrete instruction or workflow improvement.",
        "reason": "Evidence supporting the improvement."
      }
    ]
  }
}
```

`evaluation_ledger.project` identifies the project being evaluated; it is context
only and is not an improvement target. Each `improvements[].path` must identify
agent behavior (for example, `agent behavior`), `AGENTS.md`/equivalent agent
guidance, or an agent instruction, skill, or workflow file under `.agents/`,
`.codex/`, `.claude/`, or `.cursor/`. Do not use a product source path as an
improvement target. If the evidence does not support an agent-facing change,
send an empty `improvements` array.

For unrecorded alignment, send `{"status":"not_recorded"}` and omit human-label fields. `critique` may be empty only for an `unknown` verdict. The API returns the normalized evaluation and `updated_at`; retain only sanitized response evidence.
