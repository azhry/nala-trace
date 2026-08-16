# Nala Trace runtime configuration contract

This is the application-specific configuration contract for the Go API and React UI in Nala Labs. It deliberately documents names, ownership, and safe defaults without recording credential values. Secret values arrive from the local secret store or the Kubernetes/Vault integration at runtime.

## Runtime profiles

| Profile | API address | Frontend origin | MongoDB endpoint | Nala Labs auth authority |
| --- | --- | --- | --- | --- |
| Local default | `:3003` | `http://localhost:5005/` | `mongodb://127.0.0.1:27017` | `http://127.0.0.1:8080` |
| Local alternate | process override | `http://localhost:18081/` | process override | process-supplied Nala Labs auth URL |
| Nala Labs Kubernetes | `:3003` unless deployment overrides it | deployment-supplied public origin | `mongodb://mongodb.nala-labs.svc.cluster.local:27017` | deployment-supplied Nala Labs auth URL |

The frontend's `VITE_API_PROXY_TARGET` is a development-only proxy target. It is not a browser credential and must never contain a secret. Production browser code uses same-origin API paths.

## Configuration table

`ordinary` values may be present in a ConfigMap or checked-in example. `secret` values must be injected at runtime and must not appear in source, fixtures, issue text, PR text, or logs.

| Name | Class | Local default/override | Nala Labs default | Vault ownership / consumer | Required behavior |
| --- | --- | --- | --- | --- | --- |
| `AUTH_LISTEN_ADDR` | ordinary | `:3003`; alternate `:18080` | `:3003` | API deployment configuration | Required; fail before serving if empty or invalid. |
| `FRONTEND_URL` | ordinary | `http://localhost:5005/`; alternate `http://localhost:18081/` | deployment-supplied public origin | API CORS configuration | Required; must be an explicit origin and must not contain credentials. |
| `AUTH_ALLOWED_ORIGIN` | ordinary | `http://localhost:5005`; alternate `http://localhost:18081` | same value as approved frontend origin | API CORS middleware | Required for browser-facing API responses. |
| `DATABASE_URL` | secret connection string | local secret-store value | Nala Labs Vault `DATABASE_URL` | Nala Trace API-key validator | Required when machine API-key authentication is enabled; connects to the shared Nala Labs PostgreSQL `api_key` table. Never log or expose it. |
| `MONGO_URI` | secret connection string | `mongodb://127.0.0.1:27017` when local Mongo is intentionally configured; Vault-supplied value when auth is enabled | Vault key `MONGO_URI` at `secret/data/nala-labs/nala-trace`, containing the complete connection string | API Mongo client | The presence of a resolved URI enables Mongo; pass the full URI directly to the Mongo driver and redact it from errors/logs. |
| `MONGO_DATABASE` | ordinary | `nala_trace` | `nala_trace` unless deployment overrides it | API configuration | Used when a resolved Mongo URI enables Mongo. |
| `MONGO_CONNECT_TIMEOUT` | ordinary duration | `5s` | `5s` | API configuration | Bounded; reject invalid or non-positive values. |
| `MONGO_PING_TIMEOUT` | ordinary duration | `2s` | `2s` | API configuration | Bounded; reject invalid or non-positive values. |
| `MONGO_DISCONNECT_TIMEOUT` | ordinary duration | `5s` | `5s` | API configuration | Bounded; reject invalid or non-positive values. |
| `NALA_LABS_AUTH_URL` | ordinary URL | `http://127.0.0.1:8080` | deployment-supplied Nala Labs auth service URL | API authentication configuration | Required for shared JWT validation; API-key validation is local through `DATABASE_URL`. |
| `AUTH_REQUEST_TIMEOUT` | ordinary duration | `5s` | `5s` unless deployment overrides it | API authentication client | Bounded timeout for Nala Labs JWT validation calls. |
| `POSTGRESQL_ADDRESS` | ordinary address | `127.0.0.1:5432` | `postgresql.nala-labs.svc.cluster.local:5432` | `/healthz` PostgreSQL probe | TCP health address for the shared PostgreSQL dependency. |
| `REDIS_ADDRESS` | ordinary address | `127.0.0.1:6379` | `redis-master.nala-labs.svc.cluster.local:6379` | `/healthz` Redis probe | TCP health address for the shared Redis dependency. |
| `KAFKA_ADDRESS` | ordinary address | `127.0.0.1:9092` | `kafka.nala-labs.svc.cluster.local:9092` | `/healthz` Kafka probe | TCP health address for the shared Kafka dependency. |
| `HEALTHCHECK_TIMEOUT` | ordinary duration | `2s` | `2s` unless deployment overrides it | API `/healthz` | Per-dependency bounded probe timeout. |
| `VAULT_ADDR` | ordinary URL | `http://127.0.0.1:8200` through the configured local Vault transport | `http://vault.nala-labs.svc.cluster.local:8200` | API/deployment configuration | Presence activates Vault loading and health probing; use the shared `.vault-config` transport contract. |
| `VAULT_KV_MOUNT` | ordinary | `secret` | `secret` | API/deployment configuration | KV v2 mount; defaults to `secret` when omitted. |
| `VAULT_KV_PATH` | ordinary path | `nala-labs/nala-trace` | `nala-labs/nala-trace` | API/deployment configuration | KV v2 path; defaults to `nala-labs/nala-trace` when omitted and must not be used as a secret value. |
| `VAULT_SHARED_KV_PATH` | ordinary path | `nala-labs/platform` | `nala-labs/platform` | API/deployment configuration | Shared Nala Labs KV path used to resolve `DATABASE_URL`; no raw API key is copied from this path. |
| `VAULT_TOKEN` | secret or workload identity | local secret-store value only | prefer Kubernetes auth role `nala-trace-api` | `auth/kubernetes/role/nala-trace-api`; local secret-store injection if needed | Never check in a static token. Prefer workload identity in Kubernetes. |
| `VAULT_ROLE_ID` | secret | local secret-store value only | AppRole value if AppRole is selected | Vault AppRole authentication | Use only with `VAULT_SECRET_ID`; never check in. |
| `VAULT_SECRET_ID` | secret | local secret-store value only | AppRole value if AppRole is selected | Vault AppRole authentication | Use only with `VAULT_ROLE_ID`; never check in. |

The React package may read only non-secret `VITE_*` settings. Nala Trace authenticates protected requests with a Nala Labs bearer JWT or by hashing the presented Nala Labs API key and looking it up in the shared PostgreSQL `api_key` table. It stores the resolved owner ID with each trace event and never stores the raw API key. A `VITE_API_TOKEN`, provider secret, local session secret, Mongo password, Vault token, or signing key is forbidden.

## Vault ownership and Kubernetes mapping

The application workload is the owner of the following logical secret paths:

- `secret/data/nala-labs/nala-trace`: Nala Trace runtime values, including the complete `MONGO_URI`.
- The shared Nala Labs Vault record supplies `DATABASE_URL`; Nala Trace uses it read-only to validate API-key digests and resolve owner metadata from PostgreSQL. Nala Trace never copies the raw API key into Vault.
- `auth/kubernetes/role/nala-trace-api`: preferred workload identity binding for reading the paths above. A static `VAULT_TOKEN` is a local-only fallback and has no checked-in value.

For local development, copy the tracked root `.vault-config.example` to the ignored root `.vault-config` and fill the Vault transport credentials from a protected secret source. The presence of `VAULT_ADDR` activates the configured KV v2 read and health probe; no manual `VAULT_ENABLED` switch is required. Explicit process environment values take precedence.

Kubernetes deployment manifests must map ordinary names through a ConfigMap and secret names through the Vault injector or an equivalent Secret projection. The Go process must receive the same environment names listed above; manifest-specific key names must not silently diverge.

## Startup, errors, and redaction

1. Load process environment and an optional local `backend/.env` only when the file exists; explicit process values win.
2. Validate base API settings before opening the listener.
3. If a subsystem is enabled, validate its required settings before constructing the subsystem.
4. Return a non-zero startup error naming the missing or invalid variable and a remediation hint. Never include the supplied value.
5. Redact values after the first `=` in environment-shaped messages, URI user-info/password components, bearer tokens, API-key material, and any field whose name contains `TOKEN`, `SECRET`, `PASSWORD`, or `CLIENT_SECRET`.
6. Request errors contain a stable public error code and safe message only. Logs may include the operation and variable name, never secret values or complete connection strings.

## Contract validation checklist

- [ ] Every Go configuration field has exactly one table row and uses the listed environment name.
- [ ] Every Kubernetes ConfigMap/Secret/Vault projection uses the listed environment name at the process boundary.
- [ ] `MONGO_URI` is the only Mongo connection secret; when credentials are required they are embedded in the Vault-supplied URI and never logged.
- [ ] No secret-valued example is present in source, tests, fixtures, issue text, PR text, or logs.
- [ ] `NALA_LABS_AUTH_URL` resolves to the approved Nala Labs auth service from the backend network.
- [ ] The forwarded bearer token is validated by Nala Labs and never logged or persisted by Nala Trace.
- [ ] Missing base settings fail before serving, and enabled-subsystem settings fail before that subsystem is used.
- [ ] Unit tests assert that redacted errors do not contain supplied secret values.
- [ ] A deployment review verifies the Vault paths and workload consumer before enabling the corresponding subsystem.
