# Session evaluation contract

New evaluations use schema v2. The sample is illustrative; replace all event references and findings with evidence from the actual trace. Send this shape to `POST /sessions/{session_id}/evaluation`:

```json
{
  "schema_version": "2",
  "source": "session-evaluator",
  "verdict": "fail",
  "critique": "The user required a verified change. The assistant reported completion, but the captured session contains no corresponding command result; the outcome therefore remains unverified.",
  "review_signals": [
    {
      "name": "verification_claim_without_evidence",
      "count": 1,
      "severity": "warning",
      "detail": "A completion claim is not backed by a captured verification result.",
      "occurrences": [
        {
          "event_id": "event-1",
          "event_kind": "assistant_turn",
          "occurred_at": "2026-10-24T07:31:38Z",
          "summary": "The assistant said the check passed, but no command or result appears in the trace.",
          "impact": "The user cannot independently confirm the reported outcome."
        }
      ]
    }
  ],
  "judge_alignment": {"status": "not_recorded"},
  "evaluation_ledger": {
    "project": "nala-trace",
    "improvements": [
      {
        "target_type": "workflow_instructions",
        "path": ".agents/workflows/backend.md",
        "change": "Require the agent to record the exact verification command and its immediate exit status before reporting completion.",
        "reason": "The captured turn reports successful verification without a corresponding command/result.",
        "evidence_event_ids": ["event-1"]
      }
    ]
  }
}
```

For v2, each signal `count` must equal the number of occurrence entries. Every occurrence needs a real event ID, readable description, and impact. Every improvement needs a `target_type` (`agent_behavior`, `agent_instructions`, `skill_instructions`, or `workflow_instructions`) and exact evidence event IDs. Paths may target only agent instruction Markdown (for example, `AGENTS.md` or `.agents/**/*.md`); `agent_behavior` may omit a path. Never target product code. For unrecorded alignment, send `{"status":"not_recorded"}` and omit human-label fields. `critique` may be empty only for an `unknown` verdict. Schema v1 remains accepted for legacy clients and records, but does not provide exact occurrence or improvement-target guarantees. The API returns the normalized evaluation and `updated_at`; retain only sanitized response evidence.
