# Nala Ctrl headless API reference

## Start the API

The headless server is part of Nala Ctrl's Go command and starts without Wails or the desktop window. If health already returns 200, reuse that server. If the connection is refused, start the API in a long-lived terminal and keep it running through service operations and status confirmation; shutting it down stops services managed by that API process:

~~~bash
nala-ctrl api serve --listen 127.0.0.1:47653
~~~

If the CLI is not on PATH, check for a sibling Nala Ctrl source checkout at ../nala-ctrl relative to this project root. In a task worktree or different layout, use the known Nala Ctrl root from workspace context; do not guess an install path or search arbitrary directories. Confirm go.mod and agent_api.go exist, then start from the Nala Ctrl root with:

~~~bash
cd ../nala-ctrl
go run . api serve --listen 127.0.0.1:47653
~~~

A fresh checkout may lack the embedded frontend/dist assets. If that directory is absent, build it from the Nala Ctrl root before running go run:

~~~bash
npm --prefix frontend ci
npm --prefix frontend run build
~~~

If neither the installed CLI nor the known source checkout can start the server, report the exact command failure. When the server prints a different loopback address, use that observed address instead of the default below.

Verify health from another terminal:

~~~bash
api="http://127.0.0.1:47653"
curl --silent --show-error --fail "$api/v1/health"
~~~

The API is unauthenticated and accepts requests only from loopback clients. Browser-origin requests are rejected.

## Configuration and registration

Nala Ctrl reads a repository-root nala.yml. Each item under projects is a service with required cwd and run fields; port and log are optional. Do not expose run values or environment values in reports.

Configuration on disk and registration in the API process are separate. GET /v1/workspace lists only folders loaded by this API manager and services parsed from their nala.yml files. Match project IDs by normalized absolute folder path. Service IDs are stable opaque IDs; use the exact ID from the workspace response for service routes.

POST /v1/projects/load accepts one JSON object with a folder field containing the absolute project folder. It validates and registers that folder and may persist it in the user's saved project list. Use it only for an explicit Run request when the project is not registered. A read-only status, logs, or branch request must not silently mutate the saved list.

## Endpoints

These examples assume the default address and that api is set as above. Requests do not require authentication.

| Request | Response and meaning |
| --- | --- |
| GET /v1/health | 200 with {"ok":true} when the server is ready. |
| GET /v1/workspace | Workspace folder, needsConfig, hasWarnings, project IDs/folders/names, and service IDs/names/cwd/port/logPath. No run command or log lines are returned. hasWarnings flags persistence or restore problems without returning private diagnostic text. |
| POST /v1/projects/load | Send Content-Type: application/json and {"folder":"absolute-project-folder"}. Returns the safe workspace after loading. |
| GET /v1/services/{serviceID} | Returns project/service identity, cwd, port, logPath, configured, running, optional pid, and optional portInUse. |
| GET /v1/services/{serviceID}/logs?limit=N | Returns lines, sizeBytes, and limit. Default limit is 100; values above 250 are clamped to 250. The read is also capped at 512 KiB. |
| POST /v1/services/{serviceID}/run | 200 with started and pid when the API starts the service; 409 when it is already running or its configured port is occupied. A conflict response does not identify or stop the port owner. |
| POST /v1/services/{serviceID}/stop | Stops only a process started by this API manager. Returns stopped:true on success or alreadyStopped:true when this manager does not have it running. |
| GET /v1/projects/git-branch?projectId=<url-encoded-absolute-project-folder> | Returns available, repositoryRoot, currentBranch, and local branch names for the registered project's Git root. |

Example health request:

~~~bash
curl --silent --show-error --fail "$api/v1/health"
~~~


Example explicit project registration request when the user asked to run a valid but unregistered project. Run it from the repository root; the Python one-liner JSON-encodes the native absolute path:

~~~bash
folder_json="$(python -c 'import json, os; print(json.dumps({"folder": os.getcwd()}))')"
curl --silent --show-error --header 'Content-Type: application/json' --data-binary "$folder_json" "$api/v1/projects/load"
~~~

Example service status request, after selecting the service ID from the workspace response:
~~~bash
curl --silent --show-error --fail "$api/v1/services/$service_id"
~~~

Example run request:

~~~bash
curl --silent --show-error --write-out '\nHTTP %{http_code}\n' --request POST "$api/v1/services/$service_id/run"
~~~

Example stop request:

~~~bash
curl --silent --show-error --write-out '\nHTTP %{http_code}\n' --request POST "$api/v1/services/$service_id/stop"
~~~

Example bounded log request for a failure diagnosis:

~~~bash
curl --silent --show-error --fail "$api/v1/services/$service_id/logs?limit=100"
~~~

Example project-root branch request. project_id is the absolute folder ID selected from the workspace response:

~~~bash
curl --silent --show-error --fail --get --data-urlencode "projectId=$project_id" "$api/v1/projects/git-branch"
~~~

## State and safety limits

- The API has a Manager instance separate from the desktop app. running and pid describe only services started by this API process. They do not prove whether another manager or an independently started process is running the service.
- portInUse is only a boolean for the configured port. A false running value with portInUse true means the API does not manage the process holding that port; do not call the service stopped and do not terminate the owner.
- The service branch cannot be inferred from the project-root branch response. The API reports the current Git branch of the registered project folder's repository root, not the branch checked out when a process started. It does not inspect a separate Git worktree configured as cwd.
- Logs can contain tokens or other sensitive output. Read them only for diagnosis and redact secrets before quoting or saving them.
- No API endpoint switches branches, discovers arbitrary processes, or terminates a port owner. Stopping the API with Ctrl-C stops processes that this API instance started.
