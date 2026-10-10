# Nala Trace logging

## Log location

- Default: `logs/nala-trace.log` relative to the API process working directory. The documented local run starts from `backend/`, so the default file is `backend/logs/nala-trace.log`.
- `NALA_LOG_FILE` overrides the default path.
- Existing Go `slog` records remain on stderr and are also written to the log file. This includes startup errors, API listening, and the current HTTP request fields: method, path, status, and duration.

## Rotation

The active file rotates at 10 MiB. Lumberjack retains up to five compressed backups and removes backups older than 30 days. Backup names use the configured filename with a timestamp before the extension, for example `nala-trace-<timestamp>.log.gz`.

## Diagnosing failures

Inspect the active log and its compressed backups before drawing conclusions from a failure. Check the process working directory and `NALA_LOG_FILE` when the default path is missing. Keep tokens, authorization headers, command arguments, request bodies, and Vault values out of log messages and diagnostic reports.
