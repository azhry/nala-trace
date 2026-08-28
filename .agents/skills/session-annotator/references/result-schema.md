# Session annotation contract

Send a JSON object shaped like this to `POST /sessions/{session_id}/annotations`:

```json
{
  "schema_version": "1",
  "source": "session-annotator",
  "turns": [
    {
      "event_id": "trace-event-id",
      "turn_id": "optional-turn-id",
      "follows_instructions": "yes|no|unclear",
      "performance": "improved|neutral|worsened|unclear",
      "rationale": "Observable evidence supporting the labels."
    }
  ],
  "tools": [
    {
      "event_id": "trace-event-id",
      "tool_use_id": "optional-tool-use-id",
      "necessary": "yes|no|unclear",
      "rationale": "Observable reason the tool call was or was not needed."
    }
  ],
  "skills": [
    {
      "event_id": "trace-event-id",
      "skill_name": "skill-name",
      "necessary": "yes|no|unclear",
      "rationale": "Observable reason the skill invocation was or was not needed."
    }
  ]
}
```

Use `null` for an absent optional `turn_id` or `tool_use_id`. Arrays may be empty, but each emitted record must reference a real event. The API returns the normalized annotation and `updated_at`; retain the raw response only as sanitized evidence.
