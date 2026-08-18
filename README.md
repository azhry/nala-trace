# Nala Trace

Nala Trace captures Codex hook events through a Go API, stores them in MongoDB, and presents a React viewer for session and evaluation analysis.

## Local verification

The backend and frontend intentionally run without committed credentials. Start from `backend/.env.example` and supply secret values through a local secret store only when enabling the relevant subsystem.

```powershell
cd backend
go run .
```

In another terminal:

```powershell
cd frontend
npm install
npm run dev
```

These are separate processes: the Go API listens on `http://localhost:3003` and
the Vite development server listens on `http://localhost:5005`. Vite proxies
`/api` and `/healthz` to the Go API. The current UI uses hash navigation, so a
session detail URL is `http://localhost:5005/#/sessions/<id>`; `/sessions/<id>`
is not a frontend route implemented by this app.

Run the source checks from the repository root:

```bash
make verify
```

Hook installation, runtime environment, best-effort failure behavior, and
known Codex coverage gaps are documented in
[.agents/knowledge/nala-trace/hooks.md](.agents/knowledge/nala-trace/hooks.md).

Nala Trace's live behavior is verified manually, step by step, with `curl`
against the running API backed by real Vault, MongoDB, PostgreSQL, Redis, and
Kafka. The API listens on port `3003` by default. Nala Trace validates the key
locally by hashing it and querying the shared Nala Labs PostgreSQL `api_key`
table, then stores the returned owner ID with the event.

1. Create a real Nala Labs API key. API-key management requires a Nala Labs
   session JWT; it does not accept an API key as its management credential.
   Source the local Nala Labs account file, then use the admin test account:

   ```bash
   command -v curl jq
   export NALA_LABS_AUTH_URL="${NALA_LABS_AUTH_URL:-http://127.0.0.1:8080}"
   source .agents/.env
   export NALA_LABS_USERNAME="$CASDOOR_ADMIN_TEST_USERNAME"
   export NALA_LABS_PASSWORD="$CASDOOR_ADMIN_TEST_PASSWORD"
   NALA_LABS_JWT="$(curl --silent --show-error --fail-with-body \
     --header 'Content-Type: application/json' \
     --data "$(jq -n --arg u "$NALA_LABS_USERNAME" --arg p "$NALA_LABS_PASSWORD" \
       '{username: $u, password: $p}')" \
     "$NALA_LABS_AUTH_URL/api/auth/login" | jq -er '.token')"
   export CODEX_TRACE_API_TOKEN="$(curl --silent --show-error --fail-with-body \
     --header 'Content-Type: application/json' \
     --header "Authorization: Bearer $NALA_LABS_JWT" \
     --data '{"name":"nala-trace-local","permissions":["trace:read","trace:write"]}' \
     "$NALA_LABS_AUTH_URL/api/auth/api-key" | jq -er '.apiKey')"
   unset NALA_LABS_USERNAME NALA_LABS_PASSWORD NALA_LABS_JWT \
     CASDOOR_ADMIN_TEST_USERNAME CASDOOR_ADMIN_TEST_PASSWORD
   export API_BASE_URL="${NALA_TRACE_URL:-http://127.0.0.1:3003}"
   SESSION_ID="curl-live-$(date +%s%N)"
   EVENT_JSON="{\"session_id\":\"$SESSION_ID\",\"hook_event_name\":\"Stop\"}"
   ```

   Login must return HTTP 200 and API-key creation must return HTTP 201. The
   raw `apiKey` is returned once. Keep it only in `CODEX_TRACE_API_TOKEN`; if
   it is lost, repeat the same two API calls to create a new key.

2. Verify all real dependencies are healthy. Expect HTTP 200, `status` `ok`,
   and `ok` for Casdoor, Vault, PostgreSQL, MongoDB, Redis, and Kafka:

   ```bash
   curl --silent --show-error --include "$API_BASE_URL/healthz"
   ```

3. Verify protected routes reject missing credentials. Expect HTTP 401 for
   both requests:

   ```bash
   curl --silent --show-error --include "$API_BASE_URL/sessions?limit=10"
   curl --silent --show-error --include \
     --request POST \
     --header 'Content-Type: application/json' \
     --data "$EVENT_JSON" \
     "$API_BASE_URL/ingest"
   ```

4. Ingest a valid event with the real Nala Labs API key. Expect HTTP 202 and
   `{"accepted":true}`:

   ```bash
   curl --silent --show-error --include \
     --request POST \
     --header 'Content-Type: application/json' \
     --header "X-Nala-Labs-API-Key: $CODEX_TRACE_API_TOKEN" \
     --data "$EVENT_JSON" \
     "$API_BASE_URL/ingest"
   ```

5. Verify malformed input is rejected before persistence. Expect HTTP 400 with
   the `invalid_event` error code:

   ```bash
   curl --silent --show-error --include \
     --request POST \
     --header 'Content-Type: application/json' \
     --header "X-Nala-Labs-API-Key: $CODEX_TRACE_API_TOKEN" \
     --data '{"hook_event_name":"Stop"}' \
     "$API_BASE_URL/ingest"
   ```

6. Deliver the same valid event again. Expect HTTP 202 again because ingestion
   is append-only and does not silently deduplicate events:

   ```bash
   curl --silent --show-error --include \
     --request POST \
     --header 'Content-Type: application/json' \
     --header "X-Nala-Labs-API-Key: $CODEX_TRACE_API_TOKEN" \
     --data "$EVENT_JSON" \
     "$API_BASE_URL/ingest"
   ```

7. Read sessions with the same real key. Find `$SESSION_ID` in the response
   and confirm it contains the resolved `user_id` and `event_count` `2`, proving
   API-key owner resolution, MongoDB persistence, and owner-scoped reads:

   ```bash
   curl --silent --show-error --include \
     --header "X-Nala-Labs-API-Key: $CODEX_TRACE_API_TOKEN" \
     "$API_BASE_URL/sessions?limit=100"
   ```

Never commit or paste the real key into this repository or a pull request.

## Production images

Build the services from their own contexts so ignored local configuration and generated artifacts are not sent to Docker:

```powershell
docker build --file backend/Dockerfile --tag nala-trace-backend:local backend
docker build --file frontend/Dockerfile --tag nala-trace-frontend:local frontend
```

The backend listens on port `3003` and keeps `/healthz` available for liveness.
The frontend image is a separate Node/Vite process on port `8080`. In a
production deployment, an ingress or equivalent same-origin gateway must route
the frontend's relative `/api` and `/healthz` requests to the Go API; the
frontend image does not contain Nginx or a backend process. Runtime secrets are
supplied outside the images.
