# Nala Trace runtime configuration contract

This is the application-specific configuration contract for the Go API and React UI in Nala Labs. It deliberately documents names, ownership, and safe defaults without recording credential values. Secret values arrive from the local secret store or the Kubernetes/Vault integration at runtime.

## Runtime profiles

| Profile | API address | Frontend origin | MongoDB endpoint | Provider callback |
| --- | --- | --- | --- | --- |
| Local default | `:8080` | `http://localhost:5173/` | `mongodb://127.0.0.1:27017` | `http://localhost:8080/api/auth/callback` |
| Local alternate | process override | `http://localhost:18081/` | process override | `http://localhost:18080/api/auth/callback` |
| Nala Labs Kubernetes | `:8080` unless deployment overrides it | deployment-supplied public origin | `mongodb://mongodb.nala-labs.svc.cluster.local:27017` | deployment-supplied public callback |

The frontend's `VITE_API_PROXY_TARGET` is a development-only proxy target. It is not a browser credential and must never contain a secret. Production browser code uses same-origin API paths.

## Configuration table

`ordinary` values may be present in a ConfigMap or checked-in example. `secret` values must be injected at runtime and must not appear in source, fixtures, issue text, PR text, or logs.

| Name | Class | Local default/override | Nala Labs default | Vault ownership / consumer | Required behavior |
| --- | --- | --- | --- | --- | --- |
| `AUTH_LISTEN_ADDR` | ordinary | `:8080`; alternate `:18080` | `:8080` | API deployment configuration | Required; fail before serving if empty or invalid. |
| `FRONTEND_URL` | ordinary | `http://localhost:5173/`; alternate `http://localhost:18081/` | deployment-supplied public origin | API CORS/session redirect configuration | Required; must be an explicit origin and must not contain credentials. |
| `AUTH_ALLOWED_ORIGIN` | ordinary | `http://localhost:5173`; alternate `http://localhost:18081` | same value as approved frontend origin | API CORS middleware | Required for browser-facing API responses. |
| `MONGO_ENABLED` | ordinary | `false` for no-dependency local startup | `true` for the API workload | API configuration | When `true`, the Mongo settings below are required and startup/ping is bounded. |
| `MONGO_URI` | ordinary endpoint | `mongodb://127.0.0.1:27017` | `mongodb://mongodb.nala-labs.svc.cluster.local:27017` | API configuration; credentials are separate | Required when `MONGO_ENABLED=true`; do not embed credentials. |
| `MONGO_DATABASE` | ordinary | `nala_trace` | `nala_trace` unless deployment overrides it | API configuration | Required when Mongo is enabled. |
| `MONGO_USERNAME` | secret | local secret-store value | Vault-injected value | `kv/data/nala-trace/mongodb` key `username`; API Mongo client | Required when the Mongo deployment enforces authentication. |
| `MONGO_PASSWORD` | secret | local secret-store value | Vault-injected value | `kv/data/nala-trace/mongodb` key `password`; API Mongo client | Required when the Mongo deployment enforces authentication. |
| `MONGO_CONNECT_TIMEOUT` | ordinary duration | `5s` | `5s` | API configuration | Bounded; reject invalid or non-positive values. |
| `MONGO_PING_TIMEOUT` | ordinary duration | `2s` | `2s` | API configuration | Bounded; reject invalid or non-positive values. |
| `MONGO_DISCONNECT_TIMEOUT` | ordinary duration | `5s` | `5s` | API configuration | Bounded; reject invalid or non-positive values. |
| `CODEX_TRACE_API_TOKEN` | secret | local secret-store value | Vault-injected value | `kv/data/nala-trace/ingestion` key `api_token`; hook ingestion handler | Required before authenticated ingestion is enabled; compare without logging either value. |
| `CASDOOR_ISSUER` | ordinary URL | `https://casdoor.nalanirvana.com` | `https://casdoor.nalanirvana.com` or approved in-cluster equivalent | API authentication configuration | Required when Casdoor authentication is enabled. |
| `CASDOOR_CLIENT_ID` | ordinary identifier | local secret-store metadata or environment override | deployment-supplied application identifier | API authentication configuration | Required for provider exchange; identifier is not a credential. |
| `CASDOOR_CLIENT_SECRET` | secret | local secret-store value | Vault-injected value | `kv/data/nala-trace/casdoor` key `client_secret`; API auth client | Required for provider exchange; never echo or include in fixtures. |
| `CASDOOR_USERINFO_ENDPOINT` | ordinary URL | `https://casdoor.nalanirvana.com/api/get-account` | approved provider endpoint | API auth client | Required for tier mapping; no token is logged. |
| `CASDOOR_SCOPES` | ordinary list | `openid profile email` | `openid profile email` | API authentication configuration | Required provider request contract. |
| `CASDOOR_REDIRECT_URL` | ordinary URL | `http://localhost:8080/api/auth/callback`; alternate port `18080` | deployment-supplied callback | API auth client and Casdoor registration | Must match the active provider registration exactly. |
| `SESSION_COOKIE_NAME` | ordinary | `nala_trace_session` | `nala_trace_session` | API session configuration | Stable, non-secret cookie name. |
| `SESSION_TTL` | ordinary duration | `24h` unless product policy overrides it | deployment policy | API session configuration | Required duration; reject invalid or non-positive values. |
| `SESSION_SECRET` | secret | local secret-store value | Vault-injected value | `kv/data/nala-trace/session` key `secret`; API cookie signing/encryption | Required before sessions are enabled; never log or persist in fixtures. |
| `VAULT_ENABLED` | ordinary | `false` when values are loaded by local process environment | `true` for Vault-backed workload configuration | API/deployment configuration | When `true`, workload identity and Vault path settings are required. |
| `VAULT_ADDR` | ordinary URL | `http://127.0.0.1:8200` through a local port-forward | `http://vault.nala-labs.svc.cluster.local:8200` | API/deployment configuration | Required when Vault is enabled. |
| `VAULT_KV_MOUNT` | ordinary | `kv` | `kv` | API/deployment configuration | Required when Vault is enabled. |
| `VAULT_CONFIG_PATH` | ordinary path | `nala-trace/config` | `nala-trace/config` | API/deployment configuration | Required when Vault is enabled; must not be used as a secret value. |
| `VAULT_TOKEN` | secret or workload identity | local secret-store value only | prefer Kubernetes auth role `nala-trace-api` | `auth/kubernetes/role/nala-trace-api`; local secret-store injection if needed | Never check in a static token. Prefer workload identity in Kubernetes. |

The React package may read only non-secret `VITE_*` settings. The backend owns all secret values, provider exchanges, and session material. A `VITE_API_TOKEN`, provider secret, session secret, Mongo password, or Vault token is forbidden.

## Vault ownership and Kubernetes mapping

The application workload is the owner of the following logical secret paths:

- `kv/data/nala-trace/ingestion`: hook ingestion API token.
- `kv/data/nala-trace/mongodb`: Mongo username and password.
- `kv/data/nala-trace/casdoor`: Casdoor client secret.
- `kv/data/nala-trace/session`: session secret.
- `auth/kubernetes/role/nala-trace-api`: preferred workload identity binding for reading the paths above. A static `VAULT_TOKEN` is a local-only fallback and has no checked-in value.

Kubernetes deployment manifests must map ordinary names through a ConfigMap and secret names through the Vault injector or an equivalent Secret projection. The Go process must receive the same environment names listed above; manifest-specific key names must not silently diverge.

## Startup, errors, and redaction

1. Load process environment and an optional local `backend/.env` only when the file exists; explicit process values win.
2. Validate base API settings before opening the listener.
3. If a subsystem is enabled, validate its required settings before constructing the subsystem.
4. Return a non-zero startup error naming the missing or invalid variable and a remediation hint. Never include the supplied value.
5. Redact values after the first `=` in environment-shaped messages, URI user-info/password components, bearer tokens, cookie/session material, and any field whose name contains `TOKEN`, `SECRET`, `PASSWORD`, or `CLIENT_SECRET`.
6. Request errors contain a stable public error code and safe message only. Logs may include the operation and variable name, never secret values or complete connection strings.

## Contract validation checklist

- [ ] Every Go configuration field has exactly one table row and uses the listed environment name.
- [ ] Every Kubernetes ConfigMap/Secret/Vault projection uses the listed environment name at the process boundary.
- [ ] `MONGO_URI` has no embedded credentials in examples or manifests; Mongo credentials are separate secret fields.
- [ ] No secret-valued example is present in source, tests, fixtures, issue text, PR text, or logs.
- [ ] Local callback overrides for ports 8080 and 18080 are explicit and match the Casdoor contract.
- [ ] Missing base settings fail before serving, and enabled-subsystem settings fail before that subsystem is used.
- [ ] Unit tests assert that redacted errors do not contain supplied secret values.
- [ ] A deployment review verifies the Vault paths and workload consumer before enabling the corresponding subsystem.
