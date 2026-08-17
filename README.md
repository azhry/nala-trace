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

Run the build and live verification from the repository root:

```powershell
make verify
```

Hook installation, runtime environment, best-effort failure behavior, and
known Codex coverage gaps are documented in [backend/HOOKS.md](backend/HOOKS.md).

`make verify-backend-live` runs `backend/verify-live.ps1`, which uses `curl.exe`
against a running API backed by real Vault, MongoDB, PostgreSQL, Redis, and
Kafka. It exercises `/healthz`, `/ingest`, and owner-scoped `/sessions` with a
real Nala Labs API key supplied as `CODEX_TRACE_API_TOKEN`. Nala Trace validates
the key locally by hashing it and querying the shared Nala Labs PostgreSQL
`api_key` table, then stores the returned owner ID with the event. It does not
substitute fake servers, mock databases, or test doubles.

Manual endpoint verification uses `curl.exe` against the running API:

```powershell
$env:CODEX_TRACE_API_TOKEN = '<real key created by Nala Labs; keep it local>'
curl.exe -i http://127.0.0.1:3003/healthz
curl.exe -i -X POST http://127.0.0.1:3003/ingest `
  -H "Content-Type: application/json" `
  -H "X-Nala-Labs-API-Key: $env:CODEX_TRACE_API_TOKEN" `
  --data '{"session_id":"curl-live-check","hook_event_name":"Stop"}'
curl.exe -i "http://127.0.0.1:3003/sessions?limit=10" `
  -H "X-Nala-Labs-API-Key: $env:CODEX_TRACE_API_TOKEN"
```

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
