# Nala Ctrl service API reference

## API discovery and availability

Nala Ctrl is a local desktop app that runs and monitors configured services. The current source checkout is `C:/Users/Lyrid/Documents/Projects/nala-ctrl`; the repository is [azhry/nala-ctrl](https://github.com/azhry/nala-ctrl). The app's Go methods are bound to Wails `ProjectManager` in `app.go`, implemented by `manager.go` and `git.go`, and wrapped for the frontend in `frontend/wailsjs/go/main/ProjectManager.js`.

These are Wails-bound methods, not an HTTP API or command-line tool. In an agent session, inspect available connectors/tools for an explicitly exposed Nala Ctrl bridge that supports these methods. Confirm the bridge's documented inputs and results. Do not invent endpoint URLs, invoke frontend JavaScript outside its host, open/automate the desktop app, or fall back to shell process control. If no bridge is available, report that live checks and actions cannot be performed in this session.

## Configuration and registration

- A project's `nala.yml` is at the project folder root. Its `projects` map defines named services. Each service requires `cwd` and `run`; `port` and `log` are optional. Relative `cwd` resolves from the project folder; relative `log` resolves from the service `cwd`.
- Check the file and requested service entry directly for configuration questions. Do not create or edit `nala.yml` just to make a service manageable. Configuration status, registration status, and process status are distinct.
- `GetWorkspace()` returns Nala Ctrl's registered project folders and service records with their project and service IDs. A configured folder absent from this result is not currently registered.
- `LoadFolder(folder)` validates and loads a folder and, when the folder has a valid `nala.yml`, registers it and persists it for later launches when the registry is writable. This is a state change, not a read-only check. Use it for an explicit Run request for the current repository after verifying its config; do not use it for a status-only query or an unregistered Stop request.
- Use stable service IDs for details and lifecycle calls, especially when names repeat. Use project IDs for Git branch state.

## API method map

| Method | Identifier | Purpose and result |
| --- | --- | --- |
| `GetWorkspace()` | None | Lists registered folders, projects, services, and their IDs. Loading/restoring a folder does not start its services. |
| `LoadFolder(folder)` | Absolute folder path | Loads valid `nala.yml`; registers and may persist the folder. |
| `GetProjectDetails(serviceID)` | Service ID | Returns project/service IDs and names, `cwd`, run command, port, log path and recent log lines, plus the Nala Ctrl-managed `running` state and PID. |
| `RunProject(serviceID)` | Service ID | Starts that configured service. A port conflict is returned separately as `portOwner`; this call does not terminate the owner. |
| `StopProject(serviceID)` | Service ID | Stops the process Nala Ctrl manages for that service. It does not discover or stop arbitrary processes. |
| `GetProjectGitBranchState(projectID)` | Project ID | Reads the current branch and repository root for the registered project folder. |

Do not call `SwitchProjectGitBranch` to inspect status; it changes repository state.

## Branch and process limits

- `GetProjectDetails().running` is the managed process state. A non-null `portOwner` reports a process using the configured port and is not interchangeable with `running`.
- Nala Ctrl captures stdout and stderr to the configured log file. `GetProjectDetails` returns its resolved log path and a bounded recent tail. Default logs are under `logs/<service-name>.log` within the service `cwd`; a configured `log` path overrides this. Do not copy secrets or unrelated environment values into diagnostics.
- `GetProjectGitBranchState(projectID)` reads the registered project folder's current Git state, not a service-start snapshot. If `cwd` points to another worktree, the API cannot report that worktree's branch. Even when the folder and `cwd` share a repository, do not claim this API records the branch at process start.
- `TerminatePortOwnerAndRun(serviceID, pid, createTime)` can terminate a separate process. Use it only after explicit user approval and a fresh exact PID plus creation-time recheck; if identity changes or cannot be verified, stop.
- If the API bridge is absent or returns no authoritative result, report the limitation. Do not open the desktop UI, infer a process from a listening port, or manage it through other commands.
