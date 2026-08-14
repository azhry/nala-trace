# Nala Labs authentication

Nala Labs uses Casdoor as the identity, SSO/OIDC, and role source. The Go
backend owns the password-grant exchange and application session; provider
tokens never enter the browser session. The frontend must resolve the backend
session before rendering the dashboard.

## Local Casdoor application

The development application is `admin/nala-labs` at
`https://casdoor.nalanirvana.com`. Its local callbacks are:

- `http://localhost:8080/api/auth/callback`
- `http://localhost:18080/api/auth/callback`

The application must allow the `password` grant and the backend requests
`openid profile email` scopes for the first-party login form. The
authorization-code callback remains registered for compatibility with the
existing provider contract. If the application is recreated in another
Casdoor database, enable Password Credentials Grant and register the callback
for the ports being used before testing.

The workspace contains an ignored `backend/.env` populated from the local
secret store. Never commit that file, its client secret, the session secret, or
Casdoor passwords. A fresh checkout should start from `backend/.env.example`
and receive secret values from the local secret store.

The backend loads `backend/.env` when started from either `backend/` or the
repository root. Explicit process environment values take precedence. The
required local settings are:

- `AUTH_LISTEN_ADDR=:8080`
- `FRONTEND_URL=http://localhost:5173/`
- `AUTH_ALLOWED_ORIGIN=http://localhost:5173`
- `CASDOOR_ISSUER=https://casdoor.nalanirvana.com`
- `CASDOOR_CLIENT_ID`
- `CASDOOR_CLIENT_SECRET`
- `CASDOOR_USERINFO_ENDPOINT=https://casdoor.nalanirvana.com/api/get-account`
- `CASDOOR_REDIRECT_URL=http://localhost:8080/api/auth/callback`
- `SESSION_SECRET`

The shared development application uses Casdoor's account endpoint above
because it returns the configured `tag` and `isAdmin` fields used for tier
mapping. The ignored local `backend/.env` contains one disposable test user
for each tier: `nala-free-test`, `nala-developer-test`, and
`nala-admin-test`. Their passwords remain local-only.

## Tier mapping

Casdoor `Roles`, `Groups`, and the admin flag are normalized by the backend to
the three product tiers:

| Tier | Casdoor role | Entitlement |
| --- | --- | --- |
| Free | `free` | One deployment and database; expires |
| Developer | `developer` | One deployment and database; no expiration |
| Admin | `admin` or admin flag | Unlimited deployments and databases |

Unknown or missing non-admin claims default to `free`. Passwords for test
accounts belong in Casdoor or a secret manager, never in this repository,
fixtures, tracker comments, or PR descriptions.

## Local startup

Use two terminals. The backend is a multi-file Go package, so run the package
with `go run .`; `go run main.go` excludes `config.go` and `auth.go`.

PowerShell, default ports:

```powershell
cd C:\Users\<you>\Documents\Projects\nala-labs\backend
go run .
```

```powershell
cd C:\Users\<you>\Documents\Projects\nala-labs\frontend
Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue
npm run dev -- --host localhost --port 5173
```

If the default ports are occupied, override only the process ports and the
frontend proxy:

```powershell
cd C:\Users\<you>\Documents\Projects\nala-labs\backend
$env:AUTH_LISTEN_ADDR = ':18080'
$env:FRONTEND_URL = 'http://localhost:18081/'
$env:AUTH_ALLOWED_ORIGIN = 'http://localhost:18081'
$env:CASDOOR_REDIRECT_URL = 'http://localhost:18080/api/auth/callback'
go run .
```

```powershell
cd C:\Users\<you>\Documents\Projects\nala-labs\frontend
$env:VITE_API_PROXY_TARGET = 'http://localhost:18080'
Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue
npm run dev -- --host localhost --port 18081
```

## Verification contract

1. `GET /healthz` returns 200 JSON.
2. The frontend root shows the first-party username/password form when there is
   no valid session.
3. `POST /api/auth/login` sends credentials to the Go API; the API exchanges
   them with Casdoor and sets an HttpOnly application session.
4. `/api/auth/session` is proxied to the Go API and returns 401 JSON when no
   session exists, not Vite HTML.
5. A valid Casdoor sign-in returns to the dashboard; **Sign out** clears the
   application session and returns to the login screen.

The API endpoints are `GET /healthz`, `POST /api/auth/login`,
`GET /api/auth/callback`, `GET /api/auth/session`, and
`POST /api/auth/logout`.
