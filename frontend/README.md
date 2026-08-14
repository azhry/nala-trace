# Nala Trace frontend

The frontend is a React/Vite shell for the Sessions, Evals, and Golden Set workspaces.

## Development

From this directory:

```sh
npm install
npm run dev
```

Vite serves the app at `http://localhost:5173`. Requests under `/api` are proxied by the development server to `VITE_API_PROXY_TARGET`, which defaults to `http://localhost:8080`. The target is ordinary local configuration; browser code does not receive an API token or other credential.

## Checks

```sh
npm test
npm run lint
npm run build
```
