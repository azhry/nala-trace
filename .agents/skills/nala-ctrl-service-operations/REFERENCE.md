# Nala Ctrl desktop agent API

## What it is

The Nala Ctrl desktop app starts this API automatically at http://127.0.0.1:47654. The API and Wails UI use the same Manager, so workspace, service state, run, stop, and logs refer to the desktop app's configured projects and managed processes. Requests require no token or Authorization header and are accepted only from loopback clients. Browser-origin requests are rejected.

Health must return `{"ok":true,"mode":"desktop"}`. The separate command `nala-ctrl api serve --listen 127.0.0.1:47653` reports `mode=headless` and owns a different Manager. Do not launch it for these service operations. If health is unavailable, returns the wrong mode, or omits mode, ask the user to start or restart the desktop app. If the desktop endpoint returns mode=headless, ask the user to close that incorrect instance; do not identify or terminate its process.

~~~bash
api="http://127.0.0.1:47654"
curl --silent --show-error --fail "$api/v1/health"
~~~

## Workspace and services

Nala Ctrl reads the repository-root nala.yml. Each entry under projects is a service with cwd and run; port and log are optional. Do not expose run commands or environment values.

GET /v1/workspace lists projects loaded in the Manager serving the API and their configured services. Match the project by its normalized absolute folder path, then use the exact service ID returned for service routes. The response omits configured run commands, environment values, and log lines.

For desktop operations in this skill, do not use POST /v1/projects/load. If this repository is absent from the desktop workspace, ask the user to add it through the Nala Ctrl UI.

## API routes

| Request | Capability and response |
| --- | --- |
| GET /v1/health | Confirms the listener is ready and identifies its mode. Desktop mode returns `{"ok":true,"mode":"desktop"}`. |
| GET /v1/workspace | Lists loaded project folders, project IDs/names, and service IDs/names/cwd/port/logPath. It exposes only a hasWarnings flag for registry problems. |
| POST /v1/projects/load | Registers a folder containing nala.yml and may persist it. This route exists, but the service-operations skill must use the desktop UI to add projects. |
| GET /v1/services/{serviceID} | Reads project/service identity, cwd, port, logPath, configured, running, optional pid, and optional portInUse. |
| GET /v1/services/{serviceID}/logs?limit=N | Reads a bounded log tail. Default is 100 lines, maximum is 250, with a 512 KiB file read cap. Logs may contain secrets. |
| POST /v1/services/{serviceID}/run | Starts that configured service through the shared Manager. Returns started and pid on success; HTTP 409 when already running or its configured port is occupied. A conflict does not identify or stop the port owner. |
| POST /v1/services/{serviceID}/stop | Stops that service through the shared Manager. Returns stopped=true or alreadyStopped=true when this Manager does not have it running. |
| GET /v1/projects/git-branch?projectId=<url-encoded-absolute-folder> | Reports branch state for the registered project's Git root. The projectId query value is the absolute folder path from the workspace, not the opaque project ID. |

Use the exact service ID from the workspace response for service routes. Examples:

~~~bash
curl --silent --show-error --fail "$api/v1/workspace"
curl --silent --show-error --fail "$api/v1/services/$service_id"
curl --silent --show-error --write-out 'HTTP %{http_code}' --request POST "$api/v1/services/$service_id/run"
curl --silent --show-error --write-out 'HTTP %{http_code}' --request POST "$api/v1/services/$service_id/stop"
curl --silent --show-error --fail "$api/v1/services/$service_id/logs?limit=100"
curl --silent --show-error --fail --get --data-urlencode "projectId=$project_folder" "$api/v1/projects/git-branch"
~~~

Set service_id to the exact ID returned by workspace and project_folder to that project's absolute folder path before using the examples. The branch route reports the current project-root branch; it cannot switch branches, inspect another worktree, or report a process-start branch.

## State and safety limits

- In desktop mode, running and pid refer to child processes managed by the same Manager as the UI. In headless mode they refer only to that separate process; do not use headless mode for desktop work.
- portInUse is only a boolean. If running is false and portInUse is true, Nala Ctrl does not own the process using the configured port. Do not report that service as stopped or terminate the owner.
- The API has no route for arbitrary process discovery, branch switching, or port-owner termination.
- Workspace and service responses omit configured run commands and environment values. Read logs only for diagnosis and redact sensitive output before reporting.
