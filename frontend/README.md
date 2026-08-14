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
