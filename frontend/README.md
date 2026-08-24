# Nala Trace frontend

The frontend is a React/Vite shell for the Sessions, Evals, and Golden Set workspaces.

## Development

From this directory:

```sh
npm install
npm run dev
```

Vite serves the app at `http://localhost:5005` as a separate process from the
Go API at `http://localhost:3003`. Requests under `/api` and `/healthz` are
proxied by the development server to `VITE_API_PROXY_TARGET`, which defaults to
`http://localhost:3003`. The target is ordinary local configuration; browser
code does not receive an API token or other credential.

The current UI uses hash navigation. Open a detail view with
`http://localhost:5005/#/sessions/<id>`. A path such as `/sessions/<id>` is not
an implemented client-side route.

Authentication is owned by Nala Labs: Trace does not provide a login form or
own a cookie session. The frontend exposes a runtime-only in-memory auth seam in
`frontend/src/api.js`: configure exactly one of `jwt` or `apiToken` at runtime if
a trusted host application needs explicit credential forwarding. At startup,
the browser entry point makes a best-effort read of only
`sessionStorage.getItem('nala_labs_access_token')` and configures that value in
the existing in-memory JWT mode. If no JWT or API key is configured, Trace
fails closed with a local 401 and does not call the nonexistent relative
`/api/auth/session` route. JWT mode sends `Authorization: Bearer ...` to
`/sessions` and `/sessions/<id>`; the protected session request performs the
actual validation. API-token mode sends `X-Nala-Labs-API-Key` to `/sessions`
and `/sessions/<id>` and remains unchanged by the browser handoff.

The unauthorized boundary opens the real Nala Labs `/login` UI in a popup using
the non-secret `VITE_NALA_LABS_URL` origin, which defaults to
`http://localhost:5173`. The URL contains only `trace_origin`, so Nala Labs can
return to the exact Trace origin without receiving a token or password. After
the user signs in, Nala Labs must send this message to that opener:

```js
window.opener.postMessage(
  { type: 'nala-labs-authenticated', token: '<short-lived-jwt>' },
  traceOrigin,
)
```

Trace accepts the message only from the configured Nala Labs origin and the
exact popup it opened. It rejects missing or non-string tokens, stores a
non-empty token only in Trace's `sessionStorage` under
`nala_labs_access_token`, bootstraps JWT mode, and retries the protected
`/sessions?limit=100` request with `Authorization: Bearer ...`. Popup blocking
and storage failures remain visible as retryable states. The API remains the
authority that validates the JWT; Trace does not attempt to verify signing
secrets in browser code. Never place credentials in Vite env files, build-time
config, URLs, or other bundle artifacts.

The shell is source-owned and intentionally uses a compact observability workspace language: persistent navigation, low-contrast surfaces, rounded panels, status/tool chips, filterable rows, and keyboard-visible focus. Sessions, Evals, and Golden Set each have an observable destination; the local demo interactions are stateful until real API data is connected.

## Checks

```sh
npm test
npm run lint
npm run build
```

## Production container

Build the static production image from the repository root:

```sh
docker build --file frontend/Dockerfile --tag nala-trace-frontend:local frontend
docker run --rm --publish 8080:8080 nala-trace-frontend:local
```

The image runs Vite's preview server from a pinned Node runtime on port `8080`;
it is a separate frontend process, not the Go API. The browser bundle keeps
`/healthz` and `/api/...` requests relative, so production must route those
paths to the Go API through an ingress or equivalent same-origin gateway. No
Nginx image or backend process is included. No API credential, `.env` file, or
`.vault-config` is needed at build time or included in the image. The Node base
image is pinned in `Dockerfile`, the runtime keeps only the built output and
pruned production dependencies, and `frontend/.dockerignore` excludes local
configuration, secret-store files, tests, caches, and generated output from
the build context.
