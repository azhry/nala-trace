# Nala Trace frontend

The frontend is a React/Vite shell for the Sessions, Evals, and Golden Set workspaces.

## Development

From this directory:

```sh
npm install
npm run dev
```

Vite serves the app at `http://localhost:5005`. Requests under `/api` are proxied by the development server to `VITE_API_PROXY_TARGET`, which defaults to `http://localhost:3003`. The target is ordinary local configuration; browser code does not receive an API token or other credential.

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

The image runs Vite's preview server from a pinned Node runtime on port `8080`; Vite preserves history-mode SPA fallback for deep links. The browser bundle keeps `/healthz` and `/api/...` requests relative; route those paths to the Go API through the deployment ingress or service topology. No API base URL, credential, `.env` file, or `.vault-config` is needed at build time or included in the image. The Node base image is pinned in `Dockerfile`, the runtime keeps only the built output and pruned production dependencies, and `frontend/.dockerignore` excludes local configuration, secret-store files, tests, caches, and generated output from the build context.
