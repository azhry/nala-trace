# Nala Trace shared Nala Labs IAM contract

Nala Trace reuses the existing Nala Labs IAM service. It is a relying party of
the Nala Labs application session, not a second Casdoor login client. This
contract contains no provider credentials, user passwords, bearer tokens, or
signing keys.

## Authority and token contract

| Setting | Contract |
| --- | --- |
| Identity authority | Existing Nala Labs authentication service backed by the shared Casdoor deployment |
| Nala Labs Casdoor application | `admin/nala-labs`, owned and configured by Nala Labs |
| Validation endpoint | `GET {NALA_LABS_AUTH_URL}/api/auth/session` |
| Request header | `Authorization: Bearer <nala-labs-application-session-jwt>` |
| Successful response | `authenticated: true` plus the Nala Labs `user` identity and entitlements |
| Invalid or expired token | Nala Labs returns 401; Nala Trace fails closed with a stable unauthenticated error |
| Provider tokens | Raw Casdoor access/refresh tokens are not accepted by Nala Trace and never enter the browser contract |

The user signs in through Nala Labs. Nala Labs issues its application-session
JWT, and the same bearer token may be sent to Nala Trace. Nala Trace validates
the token through Nala Labs rather than copying Nala Labs' HS256 signing secret
or reimplementing the Casdoor password-grant exchange.

## Local authority routing

Run the local Nala Labs backend on its alternate port when Nala Trace owns the
default API port:

| Service | Local address | Nala Trace setting |
| --- | --- | --- |
| Nala Trace API | `http://localhost:3003` | — |
| Nala Labs auth API | `http://localhost:8080` | `NALA_LABS_AUTH_URL=http://127.0.0.1:8080` |

The deployment value is a non-secret, network-routable Nala Labs auth-service
URL. Nala Trace owns no Casdoor callback and does not perform a provider
redirect flow.

## Environment ownership

- `NALA_LABS_AUTH_URL` is an ordinary endpoint setting documented in
  `.agents/knowledge/nala-trace/configuration.md`.
- Nala Trace does not own `CASDOOR_CLIENT_ID`, `CASDOOR_CLIENT_SECRET`,
  Casdoor callback settings, or a copy of the Nala Labs signing secret.
- Nala Trace does not own a login form, callback, logout route, or signed
  application session. It verifies Nala Labs-issued JWTs through the shared
  validation endpoint and accepts the configured Nala Labs API key for machine
  access.
- The React app may hold a short-lived Nala Labs bearer token only for the
  approved upstream flow. It must not receive provider credentials or signing
  keys.

## Pre-authentication validation checklist

- [ ] The configured Nala Labs auth URL resolves from the Nala Trace backend network.
- [ ] `GET /api/auth/session` accepts the forwarded bearer token and returns the expected safe user/entitlement response.
- [ ] A valid Nala Labs session authenticates a protected Nala Trace request.
- [ ] Missing, malformed, expired, or upstream-rejected tokens fail with stable 401 behavior.
- [ ] Nala Labs timeout, network failure, malformed response, or 5xx fails closed with a stable provider-unavailable error.
- [ ] Nala Trace never logs, persists, or returns the bearer token or upstream response details.
- [ ] No Casdoor client secret, user password, raw provider token, or signing key is present in repository files, fixtures, issue text, logs, or PR text.
- [ ] Browser token handoff and cross-origin deployment behavior are tested through an approved flow before production rollout.

## Failure and safety rules

Nala Labs authority configuration and upstream failures map to stable, redacted
error codes. Nala Trace forwards the bearer token only for validation; it never
logs or persists the token, returns provider response bodies, or fails open when
Nala Labs is unavailable. Raw Casdoor access/refresh tokens and
username/password payloads are outside the Nala Trace API contract.
