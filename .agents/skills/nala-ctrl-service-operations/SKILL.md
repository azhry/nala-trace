---
name: nala-ctrl-service-operations
description: Nala Ctrl's desktop-shared loopback API lets agents inspect local nala.yml services, check status or project-root branch, run or stop services, and read bounded logs. Use when the user asks about service status, starting/stopping, logs, or branch.
---

# Nala Ctrl service operations

## Worktree configuration

Never create, copy, or otherwise add `nala.yml` in a Git worktree. Use the primary checkout project listed in `/v1/workspace`; never register the worktree as a separate project.

## What this skill controls

Nala Ctrl is the local Wails desktop app for managing projects explicitly loaded from folders containing nala.yml. The app serves an HTTP API at http://127.0.0.1:47654 through the same Manager used by its UI. API requests need no token or Authorization header.

The API starts with the desktop app. Do not start standalone nala-ctrl api serve or use another checkout as an API fallback. When desktop mode is unavailable, use the Local run fallback below for an explicit Run request or when task acceptance requires a run.

## Confirm the right API

From this repository root, run:

~~~bash
api="http://127.0.0.1:47654"
curl --silent --show-error --fail "$api/v1/health"
~~~

Use this API for service operations only when the response is `{"ok":true,"mode":"desktop"}`. If the connection fails or mode is not `desktop`, do not send service actions to this API or start another Nala Ctrl API. For an explicit Run request or when task acceptance requires a run, use the Local run fallback below; for other requests, use documented project-native sources or report that Nala Ctrl is unavailable.

## Local run fallback

Use this only when desktop mode cannot be confirmed or the target project is not loaded, and the user request or task acceptance requires a service to run. Start only the requested component. Run it in the listed working directory using its documented local command:

| Project | Service | Working directory | Command |
| --- | --- | --- | --- |
| `nala-trace` | `backend` | `backend/` | `go run .` |
| `nala-trace` | `frontend` | `frontend/` | `npm run dev` |

Before starting, follow the repository README and relevant `.agents/knowledge` for required local dependencies and runtime configuration. Use documented environment names and defaults; do not guess values, print secrets, create/copy `nala.yml` in a worktree, start a headless Nala Ctrl API, or terminate a port owner. Keep the process in a terminal session started by this agent; use that session's output as its logs and stop only that session with Ctrl+C. Confirm startup from successful process output or the project's documented health check. State that Nala Ctrl does not own or stream this fallback process.

This fallback does not start a service just to answer a status question. For status, logs, or branch when Nala Ctrl is unavailable, use an authoritative project-native source if documented; otherwise report that it cannot be verified. Do not infer status from port occupancy or process-table searches.

## Workflow

1. For desktop API operations, match the primary checkout folder in GET /v1/workspace and select its exact service ID. Do not require or create nala.yml in a Git worktree; when the API is unavailable, use the Local run fallback for an explicit Run request or required acceptance run.
2. Confirm desktop mode using GET /v1/health before service operations. Send direct loopback HTTP requests with curl; do not add authentication headers.
3. Use only projects already loaded in the desktop app for API actions. If the target is not loaded, use the Local run fallback for an explicit Run request or required acceptance run; otherwise report that the API cannot serve this project. Never call POST /v1/projects/load or register a worktree.
4. For status, call GET /v1/services/{serviceID}. In desktop mode, running reflects the same Manager as the UI. portInUse only reports whether the configured port is occupied. If running is false while portInUse is true, the API does not own that process; do not call the service stopped or terminate the port owner.
5. Run or stop only when requested. In desktop mode, use POST /v1/services/{serviceID}/run or /stop, then query details again. If API service actions are unavailable, use the Local run fallback for Run requests or required acceptance runs; for Stop, send Ctrl+C only to a process started in this agent's own terminal session. Never kill an unknown process or port owner.
6. Read logs only when requested or needed. Use the bounded API logs route when available; for a fallback-launched process, use its own terminal output or a documented log file and redact sensitive output.
7. For a branch question, use the API route when desktop mode is available. Otherwise, run git branch --show-current from the requested project checkout and report it as that checkout's current branch; the process-start branch is unknown.

See [REFERENCE.md](REFERENCE.md) for the API routes, response fields, and examples. Never use ps, taskkill, kill, lsof, or process-table searches to infer service state or control processes outside this agent's own terminal session.
