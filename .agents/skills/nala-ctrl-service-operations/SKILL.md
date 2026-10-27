---
name: nala-ctrl-service-operations
description: Use Nala Ctrl's loopback HTTP API to inspect a repository's nala.yml services, check API-managed running state, run or stop a requested service, read bounded logs, or report the registered project root's Git branch. Load for local Nala Ctrl service operations.
---

# Nala Ctrl service operations

## What this skill controls

Nala Ctrl manages local services configured in a repository-root nala.yml file. Each item under projects defines one service. Its headless API is a local HTTP service started from the Nala Ctrl command line; it does not require opening the desktop app.

Use the API described in [REFERENCE.md](REFERENCE.md). The command is nala-ctrl api serve --listen 127.0.0.1:47653. Every request requires a bearer token. The command nala-ctrl api token-file prints only a path to a private curl config containing the bearer header; pass that path to curl with --config. Do not read, print, copy, or commit that file's contents.

If the API is not responding, start the serve command in a separate long-running terminal and retry the health request. If the CLI is unavailable or the server cannot start, report that exact blocker. Do not open the desktop UI or fall back to direct process commands.

## Workflow

1. Check the target repository's root nala.yml and confirm that the requested service key exists under projects. Do not print configured run commands or environment values. Nala Ctrl uses the exact filename nala.yml; a file named .nala.yml is a different contract.
2. Get the private curl config path and call GET /v1/health. All endpoints, including health, require authentication.
3. Call GET /v1/workspace and match the repository by its normalized absolute folder path, then select the exact service ID. Do not match by project basename alone.
4. Keep configuration, registration, and process state separate:
   - No matching service in the local nala.yml means it is not configured.
   - A valid local service absent from the API workspace is configured but not registered.
   - For read-only status, logs, or branch questions, do not register a project just to query it. Report when the API cannot answer because the folder is unregistered.
   - For an explicit Run request only, you may register the repository by POSTing its folder to /v1/projects/load. This persists the folder in Nala Ctrl's saved project list; tell the user this happened. Re-read the workspace to obtain the service ID.
5. For status, call GET /v1/services/{serviceID}. Its running flag and PID refer only to services started by this API process. portInUse reports occupancy of the configured port and is not proof that this service is running.
6. Run or stop only when the user requested that action. After POST /run or POST /stop, query service details again and report the response. A port conflict does not authorize stopping the process that owns the port. This API has no port-owner termination route.
7. Read logs only when requested or needed to diagnose a reported service failure. Use the bounded logs endpoint and redact secrets before reporting log content.
8. For a branch question, call GET /v1/projects/git-branch with the project ID as a URL-encoded query parameter. Report the current branch of the registered project root. The API does not record a service's process-start branch or inspect another worktree used by its cwd; say that the running branch is unknown when asked for that fact.

Never use ps, taskkill, kill, lsof, or other process controls to infer or manage service state. See [REFERENCE.md](REFERENCE.md) for request examples, response fields, and status-code handling.