# Session annotation contract

New writes use schema v2. The sample is illustrative; replace event IDs and summaries with evidence from the actual trace. Send this shape to `POST /sessions/{session_id}/annotations`:

```json
{
  "schema_version": "2",
  "source": "session-annotator",
  "user_turns": [
    {
      "event_id": "event-user-1",
      "turn_id": "turn-1",
      "signal_type": "constraint",
      "summary": "The user limited the change to agent workflow instructions.",
      "rationale": "This is an explicit boundary on the requested work.",
      "linked_event_ids": ["event-assistant-1"]
    }
  ],
  "turns": [
    {
      "event_id": "event-assistant-1",
      "turn_id": "turn-1",
      "follows_instructions": "yes",
      "performance": "improved",
      "rationale": "The assistant followed the constraint and completed its requested review.",
      "response_summary": "The assistant reported the review outcome and cited its evidence.",
      "scope_adherence": "within_scope",
      "groundedness": "supported",
      "verification": "verified",
      "related_event_ids": ["event-tool-1"]
    }
  ],
  "tools": [
    {
      "event_id": "event-tool-1",
      "tool_use_id": "tool-use-1",
      "tool_name": "Bash",
      "input_summary": "Ran the repository backend test suite.",
      "output_summary": "The command exited successfully and reported all tests passing.",
      "completion_status": "completed",
      "necessary": "yes",
      "rationale": "This provided direct verification of the backend change."
    }
  ],
  "skills": [
    {
      "event_id": "event-skill-1",
      "skill_name": "manual-test-verification",
      "summary": "The skill supplied the required evidence-collection procedure.",
      "necessary": "yes",
      "rationale": "The task required separately reported verification evidence."
    }
  ],
  "files": [
    {
      "event_id": "event-file-1",
      "path": ".agents/workflows/backend.md",
      "operation": "read",
      "summary": "Read the repository's backend verification requirements.",
      "necessary": "yes",
      "rationale": "This file supplied the applicable verification boundary."
    }
  ],
  "capture_gaps": [
    {
      "category": "tool_completion",
      "event_ids": ["event-tool-2"],
      "summary": "The tool call was captured, but its completion hook is absent from this snapshot.",
      "impact": "The command result and side effects cannot be confirmed."
    }
  ],
  "coverage": {
    "user_turns": {"captured": 1, "labeled": 1, "unclear": 0},
    "agent_turns": {"captured": 1, "labeled": 1, "unclear": 0},
    "tool_calls": {"captured": 1, "labeled": 1, "unclear": 0},
    "skill_invocations": {"captured": 1, "labeled": 1, "unclear": 0},
    "file_operations": {"captured": 1, "labeled": 1, "unclear": 0}
  }
}
```

For v2, every coverage category is required. `captured` is the observed trace count and must equal `labeled`; `unclear` counts records with one or more unclear decisions. Every record and cross-reference must use a real event ID. Tool output summaries must say when a completion hook was not captured; never infer completion from a tool-call request alone. Record each known capture gap with observed event IDs, a readable summary, and impact. Use `null` for an absent optional `turn_id` or `tool_use_id`. Schema v1 remains accepted for legacy clients and stored records, but does not imply v2 coverage. The API returns the normalized annotation and `updated_at`; retain only sanitized response evidence.
