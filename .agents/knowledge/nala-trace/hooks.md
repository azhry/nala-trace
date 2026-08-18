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

Build the client and put the resulting `hook-client` executable on the PATH
used by Codex. Configure the following values in the process environment, not
in `hooks.json`:

```text
CODEX_TRACE_API_URL=https://trace.example.test/ingest
# Set CODEX_TRACE_API_TOKEN to the raw key created by the README's Nala Labs
# login and POST /api/auth/api-key steps. Keep it in the process environment.
CODEX_TRACE_API_TIMEOUT=2s
```

The token is intentionally absent from this repository.

## Manifest and trust

`/hooks.json` is the repository manifest. It registers the nine canonical
events and sends each event as JSON on stdin to the same `hook-client`
executable. Follow the manual, step-by-step `curl` sequence in the repository
README to verify delivery against the running API and real dependencies.

Copy or adapt the manifest into the Codex configuration location accepted by
the installed Codex version, then review and trust the `hook-client` command
when Codex prompts for hook approval. Keep the executable path and runtime
environment outside the committed manifest.

## Known coverage gaps

The current project contract explicitly records two gaps: `unified_exec` and
`WebSearch` are not guaranteed to emit the same PreToolUse/PostToolUse hook
coverage as ordinary tool events. Do not interpret a missing event for either
path as proof that the underlying tool was not used.
