# Codex hook delivery

Nala Trace observes Codex lifecycle events on a best-effort basis. The hook
client is deliberately not part of the Codex success path:

- A malformed event, missing runtime configuration, unavailable API, non-2xx
  response, or timeout is swallowed.
- The client performs one bounded POST and does not retry synchronously.
- The executable exits with status 0 for both successful delivery and delivery
  loss, so an observability outage cannot block a Codex session.
- The client never prints the event payload, bearer credential, or response
  body. Operators should use the ingestion API/Mongo health checks and server
  logs to investigate loss; a successful Codex command alone does not prove
  the event was stored.

## Runtime configuration

The repository installer `bash scripts/install-hook.sh` builds the client,
creates the project-local file `.codex/nala-trace.env`, and copies the checked-
in manifest to `.codex/hooks.json`. The manifest invokes
`backend/bin/hook-client.exe` relative to the current project directory, so
Codex does not need to inherit a PATH entry. The client also accepts explicit
process environment values, which take
precedence over file values. `CODEX_TRACE_CONFIG_FILE` can select one explicit
file. Otherwise, the client checks `.codex/nala-trace.env` in the hook process's
current project directory, then the user-level fallback
`%USERPROFILE%\\.codex\\nala-trace.env` on Windows or
`$HOME/.codex/nala-trace.env` on macOS/Linux. Do not put credentials in
`hooks.json`:

```text
CODEX_TRACE_API_URL=https://trace.example.test/ingest
# Set CODEX_TRACE_API_TOKEN to the raw key created by the README's Nala Labs
# login and POST /api/auth/api-key steps. Keep this file user-readable only.
CODEX_TRACE_API_TIMEOUT=2s
```

The token is intentionally absent from this repository.

The project config is ignored and must remain user-readable only. Use the
user-level file when one configuration should apply across projects.

## Manifest and trust

`/hooks.json` is the repository manifest. It registers the nine canonical
events and sends each event as JSON on stdin to
`backend/bin/hook-client.exe`. The installer copies it to `.codex/hooks.json`.
Follow the manual, step-by-step `curl` sequence in the repository README to
verify delivery against the running API and real dependencies.

Review and trust the project-relative hook command when Codex prompts for hook
approval. Keep runtime credentials outside the committed manifest.

## Known coverage gaps

The current project contract explicitly records two gaps: `unified_exec` and
`WebSearch` are not guaranteed to emit the same PreToolUse/PostToolUse hook
coverage as ordinary tool events. Do not interpret a missing event for either
path as proof that the underlying tool was not used.
