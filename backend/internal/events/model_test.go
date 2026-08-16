package events

import (
	"strings"
	"testing"
)

func TestDecodeAcceptsEverySupportedEventName(t *testing.T) {
	for _, name := range SupportedEventNames() {
		t.Run(name, func(t *testing.T) {
			event, err := Decode([]byte(`{"session_id":"session-1","hook_event_name":"` + name + `","future_field":{"kept":true}}`))
			if err != nil {
				t.Fatalf("Decode returned error: %v", err)
			}
			if event.SessionID != "session-1" || event.HookEventName != name {
				t.Fatalf("unexpected event: %+v", event)
			}
			if string(event.Payload["future_field"]) != `{"kept":true}` {
				t.Fatalf("unknown field was not retained: %s", event.Payload["future_field"])
			}
		})
	}
}

func TestDecodePreservesOptionalRawFieldsAndNulls(t *testing.T) {
	event, err := Decode([]byte(`{"session_id":"session-1","hook_event_name":"PreToolUse","turn_id":null,"tool_input":{"secret":"do-not-log"},"response":[1,2]}`))
	if err != nil {
		t.Fatalf("Decode returned error: %v", err)
	}
	if event.TurnID != nil || string(event.ToolInput) != `{"secret":"do-not-log"}` || string(event.Response) != `[1,2]` {
		t.Fatalf("optional fields were not preserved: %+v", event)
	}
}

func TestDecodeValidationErrorsNameFieldWithoutPayload(t *testing.T) {
	_, err := Decode([]byte(`{"session_id":"session-1","hook_event_name":"Unknown","token":"secret-value"}`))
	if err == nil || !strings.Contains(err.Error(), "hook_event_name") || strings.Contains(err.Error(), "secret-value") {
		t.Fatalf("unexpected validation error: %v", err)
	}
}

func TestDecodeRejectsMalformedRequiredAndOptionalFields(t *testing.T) {
	for name, input := range map[string]string{
		"missing session": `{"hook_event_name":"Stop"}`,
		"empty hook name": `{"session_id":"s","hook_event_name":" "}`,
		"bad turn":        `{"session_id":"s","hook_event_name":"Stop","turn_id":3}`,
		"bad JSON":        `{"session_id":`,
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := Decode([]byte(input)); err == nil {
				t.Fatal("Decode unexpectedly accepted invalid payload")
			}
		})
	}
}
