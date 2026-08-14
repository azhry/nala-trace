# Nala Trace Casdoor application contract

This document defines the non-secret Casdoor settings required before Nala Trace authentication implementation begins. It is derived from the Nala Labs authentication reference and contains no client secret or test-user password.

## Provider application

| Setting | Contract |
| --- | --- |
| Application | `admin/nala-labs` |
| Public issuer | `https://casdoor.nalanirvana.com` |
| In-cluster issuer alternative | `http://casdoor.nala-labs.svc.cluster.local:8000` when the workload is configured for internal service routing |
| User-info endpoint | `/api/get-account` on the selected issuer; the public default is `https://casdoor.nalanirvana.com/api/get-account` |
| Requested scopes | `openid profile email` |
| Grant | Password Credentials Grant must be enabled for the first-party login form |
| Callback behavior | Authorization-code callback remains registered for compatibility; the Go backend owns the password-grant exchange and application session |
| Browser token behavior | Provider access/refresh tokens remain server-side and never enter the browser session |

The backend maps the provider response's role/group/admin claims to the product tiers described by the Nala Labs authentication contract. Unknown or missing non-admin claims default to the least-privileged tier.

## Explicit local callback overrides

The active backend listen port and callback must be changed together:

| Local backend | Frontend origin | `CASDOOR_REDIRECT_URL` |
| ---: | --- | --- |
| `:8080` | `http://localhost:5173/` | `http://localhost:8080/api/auth/callback` |
| `:18080` | `http://localhost:18081/` | `http://localhost:18080/api/auth/callback` |

These URLs must be registered in the `admin/nala-labs` application before local callback testing. The public Nala Trace callback is deployment-supplied and must use the same origin/port that the reverse proxy exposes.

## Environment ownership

- Ordinary provider settings: `CASDOOR_ISSUER`, `CASDOOR_CLIENT_ID`, `CASDOOR_USERINFO_ENDPOINT`, `CASDOOR_SCOPES`, and `CASDOOR_REDIRECT_URL` follow `.agents/knowledge/nala-trace/configuration.md`.
- Secret provider setting: `CASDOOR_CLIENT_SECRET` is owned at `kv/data/nala-trace/casdoor` key `client_secret` and is injected only into the backend workload.
- Test-user credentials are owned by Casdoor/local secret storage and are never copied into source, fixtures, issue text, logs, or PR descriptions.
- The React app does not receive `CASDOOR_CLIENT_SECRET`, provider tokens, session secrets, or any API token.

## Pre-authentication validation checklist

- [ ] The selected Casdoor issuer resolves from the backend runtime network and uses the expected scheme/host.
- [ ] The `admin/nala-labs` application exists in the selected Casdoor database.
- [ ] Password Credentials Grant is enabled for the application.
- [ ] `openid profile email` are allowed/requested scopes.
- [ ] The user-info endpoint returns the provider account fields needed for tier mapping without exposing test credentials.
- [ ] The authorization-code callback remains registered for compatibility.
- [ ] The callback for the active local port is registered exactly, including `/api/auth/callback`.
- [ ] `CASDOOR_CLIENT_ID` is present for the backend and `CASDOOR_CLIENT_SECRET` is injected from the documented secret path.
- [ ] Provider client secret and test-user passwords are absent from repository files, fixtures, Linear issue text, logs, and PR text.
- [ ] A backend login test can use a fake provider boundary; live provider tests are opt-in and do not require committed credentials.

## Failure and safety rules

Missing issuer/client/callback settings fail authentication startup or request handling with a stable, redacted error code. Provider response bodies, passwords, client secrets, and bearer tokens are not copied into logs or client responses. A provider outage must not cause the backend to issue a browser-visible provider token or session secret.
