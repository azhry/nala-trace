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

Run the baseline checks from the repository root:

```powershell
make test
make test-backend-cover
make test-frontend-lint
make test-frontend-build
```

The backend integration command is credential-free and exercises the configured HTTP server and `/healthz` route. MongoDB lifecycle tests use fakes by default. A future live-Mongo integration suite must be run only with an explicitly configured service and must not add credentials to the repository.

## Production images

Build the services from their own contexts so ignored local configuration and generated artifacts are not sent to Docker:

```powershell
docker build --file backend/Dockerfile --tag nala-trace-backend:local backend
docker build --file frontend/Dockerfile --tag nala-trace-frontend:local frontend
```

The backend listens on port `3003` and keeps `/healthz` available for liveness. The frontend serves the Vite output on port `8080` with SPA fallback and uses relative API paths. Runtime secrets are supplied outside the images.
