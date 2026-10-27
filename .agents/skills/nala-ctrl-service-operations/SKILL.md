---
name: nala-ctrl-service-operations
description: Uses Nala Ctrl's API to inspect service configuration and managed running state, run or stop a selected service, read logs, and report project branch state with its limits. Use when an agent needs to check, start, stop, inspect logs for, or identify branch state for a service managed by Nala Ctrl.
---

# Nala Ctrl service operations

## What Nala Ctrl is

Nala Ctrl is a local desktop app that runs and monitors configured services. On the current Windows workspace, its source repository is `C:/Users/Lyrid/Documents/Projects/nala-ctrl` ([GitHub](https://github.com/azhry/nala-ctrl)). It reads explicitly registered folders' `nala.yml` files; each entry under `projects` is one service. It starts configured commands, tracks processes it starts, checks configured ports, and captures service logs. It does not discover arbitrary system processes.

The Go `ProjectManager` methods in `app.go` are Wails-bound; generated JavaScript bindings are in `frontend/wailsjs/go/main/ProjectManager.js`. The source has no standalone HTTP endpoint or CLI. Use only an agent-accessible Nala Ctrl API bridge. Discover available integrations/tools by the method names in [REFERENCE.md](REFERENCE.md); do not guess a tool name, URL, or CLI. If no bridge exposes the API, report that blocker. Do not open the desktop UI, call its JavaScript bindings directly, or start/stop processes through another route.

## Workflow

1. Inspect the target repository's root `nala.yml`. Confirm the requested service key is under `projects` and has `cwd` and `run`; `port` and `log` are optional. Report a missing or invalid entry without creating or editing the file.
2. Discover an agent-facing Nala Ctrl API bridge. Call `GetWorkspace()` to map registered project folders to their project IDs and service IDs. Configuration on disk and registration in Nala Ctrl are separate states.
3. For a read-only config/status request, do not call `LoadFolder` just to register the project. Report when a valid service is configured but not registered. For an explicit Run request on this repository, `LoadFolder(absoluteFolderPath)` may register and persist its valid configuration; report that side effect. Do not use it for an unregistered Stop request.
4. Use the exact service ID from `GetWorkspace()` with `GetProjectDetails(serviceID)`. Its `running` and `pid` describe a process managed by Nala Ctrl. `portOwner` is separate port-conflict information, not proof that this service is running. The details also include `cwd`, `run`, port, log path, and recent log lines.
5. For an explicit start or stop request, call `RunProject(serviceID)` or `StopProject(serviceID)`, then call `GetProjectDetails(serviceID)` again and report the observed result. A port conflict does not authorize stopping its owner. Call `TerminatePortOwnerAndRun` only after the user explicitly approves terminating that exact process and its PID and creation time have been freshly rechecked.
6. For branch questions, call `GetProjectGitBranchState(projectID)` and report it as the current branch of the registered project folder. The API does not record the branch when the service started and cannot report a separate Git worktree used by the service's `cwd`. State that limitation instead of inferring the service's launch branch.

## Examples

- Status: `GetWorkspace()` → match folder/service IDs → `GetProjectDetails(serviceID)`.
- Start: `RunProject(serviceID)` → `GetProjectDetails(serviceID)` to confirm.
- Stop: `StopProject(serviceID)` → `GetProjectDetails(serviceID)` to confirm.
- Branch: `GetProjectGitBranchState(projectID)` → report the registered project-root branch and its scope.

See [REFERENCE.md](REFERENCE.md) for method details, configuration rules, log behavior, and safety limits.
