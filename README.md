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
