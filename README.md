# Nala Trace

Nala Trace observes Codex sessions through Codex lifecycle hooks. A small
fire-and-forget hook client sends each captured event to a Go API, the API
stores events in MongoDB, and a React dashboard reconstructs sessions for
debugging and evaluation.

The hook client is deliberately outside Codex's success path. It performs one
bounded request, never prints event or credential data, swallows delivery
failures, and exits with status 0 so an observability outage cannot break a
Codex session.

## How it works

![How Nala Trace observes a Codex session](docs/diagrams/nala-trace-how-it-works.svg)

In short: Codex sends lifecycle JSON to `hook-client`, the client makes one
bounded authenticated request to the Go API, the API stores hook payloads in
MongoDB, and the React viewer reads reconstructed sessions through the API.

The repository manifest, [hooks.json](hooks.json), registers these lifecycle
events. Each command hook receives the lifecycle payload as JSON on stdin:

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `SubagentStart`
- `SubagentStop`
- `PreCompact`
- `PostCompact`
- `Stop`

The API reconstructs conversation messages, tool-call timelines, skill
evidence, and file-operation evidence from stored hook payloads. It does not
read undocumented Codex rollout or transcript files.

## Prerequisites

- Go 1.23 or newer
- Node.js and npm
- Docker, or another MongoDB 7-compatible deployment
- A Nala Labs API key for machine-to-machine hook delivery
- Access to the shared Nala Labs PostgreSQL `api_key` table for API-key validation
- Codex Desktop with hooks enabled

The default local addresses are:

| Service | Address |
| --- | --- |
| Nala Trace API | `http://127.0.0.1:3003` |
| React dashboard | `http://localhost:5005` |
| Nala Labs auth API | `http://127.0.0.1:8080` |
| MongoDB | `mongodb://127.0.0.1:27017` |

## Run Nala Trace locally

### 1. Start MongoDB

Use the repository's local MongoDB default, or point `MONGO_URI` at an existing
MongoDB deployment:

```bash
docker run -d --name codex-trace-mongo -p 27017:27017 mongo:7
```

### 2. Configure and start the Go API

Copy the non-secret example to the ignored local configuration file. Supply
secret values through the configured secret store; never commit them to
`backend/.env` or this README.

```bash
cp backend/.env.example backend/.env
cd backend
go run .
```

The API reads `backend/.env` when started from `backend/`. If Vault is not part
of the local run, remove or unset `VAULT_ADDR` so Vault loading is not
activated. If Vault, PostgreSQL, or Nala Labs authentication is enabled, use
the real configured services and credentials for that environment.

Check liveness from another terminal:

```bash
curl --fail-with-body --silent --show-error http://127.0.0.1:3003/healthz
```

`/healthz` reports the configured dependency status. Protected routes are:

- `POST /ingest` — accept one authenticated Codex hook event.
- `GET /sessions` — list owner-scoped session summaries.
- `GET /sessions/:id` — read one reconstructed owner-scoped trace.

Protected requests accept either of these Nala Labs credentials:

- `Authorization: Bearer <application-session JWT>` — Nala Trace forwards the
  JWT to Nala Labs `GET /api/auth/session` for validation and identity claims.
- `X-Nala-Labs-API-Key: <API key>` — Nala Trace hashes the key and resolves its
  owner from the shared PostgreSQL `api_key` table.

The hook client uses the API-key path and sends `CODEX_TRACE_API_TOKEN` as
`X-Nala-Labs-API-Key`. The Nala Labs authentication service is needed to issue
or revoke keys and to validate session JWTs; it is not contacted for each
API-key request.

### 3. Start the React dashboard

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5005`. The frontend is a separate process; Vite proxies
API paths to the Go API during development. Sign in through the configured
Nala Labs flow, open **Sessions**, and select a row to inspect its conversation,
tool calls, skills, and file evidence.

## Install the Codex hook

The checked-in `hooks.json` is the portable Codex hook manifest. It contains
the event registrations and the `hook-client` command, but no URL, token, or
other secret. Keep the executable path and runtime credentials outside the
manifest. Codex expects each event to contain matcher groups with nested
command handlers; do not add a `version`, `known_gaps`, or `stdin` field.

### 1. Build the hook client

From the repository root:

```bash
cd backend
mkdir -p bin
go build -o bin/hook-client ./cmd/hook-client
export PATH="$(pwd)/bin:$PATH"
command -v hook-client
```

The final command must resolve the binary that Codex will launch. On Windows,
build `bin/hook-client.exe` and place that directory on the PATH visible to
Codex Desktop.

### 2. Set runtime configuration

Set these values in the process environment used by Codex. Do not put them in
`hooks.json`, a committed file, a Vite environment file, or a browser bundle.

```bash
export CODEX_TRACE_API_URL="http://127.0.0.1:3003/ingest"
printf 'Paste the Nala Labs API key accepted by the shared api_key table: '
read -r -s CODEX_TRACE_API_TOKEN
printf '\n'
export CODEX_TRACE_API_TOKEN
export CODEX_TRACE_API_TIMEOUT="2s"
```

Obtain the API key through the approved Nala Labs API-key flow for your
environment and keep it in a secret store or the current process only. The
hook client sends it in `X-Nala-Labs-API-Key`; raw Casdoor provider
credentials are not part of this application contract.

### 3. Install and trust the manifest

The Codex configuration location and trust prompt can vary by installed Codex
version. Copy the repository's `hooks.json` to the accepted local configuration
location (for this workspace, `.codex/hooks.json`), then use the Codex hook
configuration flow:

```text
codex
/hooks
```

When Codex asks to approve `hook-client`, review that it invokes the binary
from the PATH above, receives JSON on stdin, and does not contain embedded
credentials. Trust the command only after that review. Keep all nine event
registrations. JSON stdin is part of Codex command-hook behavior and is not a
field in `hooks.json`.

### 4. Generate and inspect a real trace

Start a normal Codex session after the hook is trusted. The hook client will
receive each supported lifecycle event automatically. It sends one bounded
`POST /ingest`, ignores the response body, and returns zero whether delivery
succeeds or fails.

After the session completes, inspect the API using the same API key:

```bash
export API_BASE_URL="http://127.0.0.1:3003"
curl --fail-with-body --silent --show-error \
  --header "X-Nala-Labs-API-Key: $CODEX_TRACE_API_TOKEN" \
  "$API_BASE_URL/sessions?limit=10"
```

Find the new session in the response, then open the dashboard and select it.
If the session is missing, check `/healthz`, the API logs, the hook executable
PATH, the process environment inherited by Codex, and the configured Nala
Labs authority. A successful Codex command alone does not prove that the
event was stored.

## Day-to-day usage

1. Start the API, dashboard, and their configured dependencies.
2. Keep the trusted hook configuration and runtime environment available to
   Codex Desktop.
3. Use Codex normally. Nala Trace records supported lifecycle events in the
   background.
4. Open the dashboard's **Sessions** view and select a session.
5. Read the reconstructed conversation, expand tool calls, and inspect skill
   and file-operation evidence while investigating a trace.
6. Use the protected API endpoints when automating session-list or trace-detail
   checks from a trusted environment.

## Known limitations

- Hook delivery is best effort. The hook client always exits 0, including when
  configuration is missing, the API is unavailable, the response is non-2xx,
  or the request times out. This protects Codex but can result in a missing
  trace.
- `unified_exec` and `WebSearch` are documented coverage gaps. A missing hook
  event for either path is not proof that the underlying tool was not used.
- Hook event reconstruction is evidence-based and conservative. Ambiguous
  skill or file activity is not presented as certain activity.
- The frontend uses hash navigation for session details, for example
  `http://localhost:5005/#/sessions/<id>`.

## Development checks

Run the repository checks from the root:

```bash
make verify
```

Run the test suites independently when changing implementation code:

```bash
cd backend
go test ./...

cd ../frontend
npm test
```

Keep credentials, local `.env` files, `.vault-config` files, API tokens, and
generated artifacts out of commits.
