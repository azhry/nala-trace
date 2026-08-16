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

Run the baseline checks from the repository root:

```powershell
make test
make test-backend-cover
make test-frontend-lint
make test-frontend-build
```

Hook installation, runtime environment, best-effort failure behavior, and
known Codex coverage gaps are documented in [backend/HOOKS.md](backend/HOOKS.md).

The backend integration command is credential-free and exercises the configured HTTP server and `/healthz` route. MongoDB lifecycle tests use fakes by default. A future live-Mongo integration suite must be run only with an explicitly configured service and must not add credentials to the repository.

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
