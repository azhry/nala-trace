---
name: nala-ctrl-service-operations
description: Nala Ctrl's desktop-shared loopback API lets agents inspect local nala.yml services, check status or project-root branch, run or stop services, and read bounded logs. Use when the user asks about service status, starting/stopping, logs, or branch.
---

# Nala Ctrl service operations

## What this skill controls

Nala Ctrl is the local Wails desktop app for managing projects explicitly loaded from folders containing nala.yml. The app serves an HTTP API at http://127.0.0.1:47654 through the same Manager used by its UI. API requests need no token or Authorization header.

The API starts with the desktop app. It is not a command the agent needs to launch. The explicit nala-ctrl api serve command starts a separate headless Manager and can show different projects and processes. Never use that command or a second source checkout as a fallback for desktop service operations.

## Confirm the right API

From this repository root, run:

~~~bash
api="http://127.0.0.1:47654"
curl --silent --show-error --fail "$api/v1/health"
~~~

Proceed only when the response is `{"ok":true,"mode":"desktop"}`. If the connection fails, ask the user to start or restart their Nala Ctrl desktop app. If the response says mode=headless, omits mode, or has any other shape, stop using the API and ask the user to resolve the old or separate instance and restart the desktop app. Do not start another API process, inspect arbitrary processes, or terminate a port owner.

## Workflow

1. Check this repository's root nala.yml and confirm that the requested service key exists under projects. Do not print configured run commands or environment values. Nala Ctrl uses the exact filename nala.yml; .nala.yml is a different contract.
2. Confirm desktop mode using GET /v1/health before service operations. Send direct loopback HTTP requests with curl; do not add authentication headers.
3. Call GET /v1/workspace. Match the repository by its normalized absolute folder path, then select the exact service ID. Use only projects already loaded in the desktop app. If the project is missing, ask the user to add it through the app; do not call POST /v1/projects/load.
4. For status, call GET /v1/services/{serviceID}. In desktop mode, running reflects the same Manager as the UI. portInUse only reports whether the configured port is occupied. If running is false while portInUse is true, the API does not own that process; do not call the service stopped or terminate the port owner.
5. Run or stop only when the user requested it or task acceptance requires it. Use POST /v1/services/{serviceID}/run or /stop, then query service details again and report the result. A port conflict does not authorize stopping its owner.
6. Read logs only when requested or needed to diagnose a reported failure. Use the bounded logs route and redact sensitive output.
7. For a branch question, use GET /v1/projects/git-branch with the project's absolute folder path as the URL-encoded projectId. This reports the current branch of the project Git root, not the branch a process started on or another worktree used by its cwd. Say that the process branch is unknown when asked for that fact.

See [REFERENCE.md](REFERENCE.md) for the API routes, response fields, and examples. Never use ps, taskkill, kill, lsof, or other process controls to infer or manage service state.
