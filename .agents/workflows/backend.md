# Backend workflow

Apply this workflow to changes under `backend/`, including Go services, GraphQL operations, authentication, persistence, and database migrations.

## Contract and analysis

- Complete the issue-description readiness gate before implementation. Treat the verified description as the contract for inputs, outputs, authorization, persistence, error behavior, and compatibility.
- Inspect the relevant handler, service, middleware, migration, tests, and sibling-service integration contract before choosing an implementation seam. Confirm current behavior from code or a reproduction; clearly separate confirmed facts from hypotheses. For authentication and runtime configuration, document which system owns issuance and validation and which configuration values activate each subsystem before adding local sessions, duplicate secrets, or parallel enable flags.
- Trace every affected operation end to end: request parsing, authentication, authorization or resource ownership, validation, business logic, persistence, response serialization, and errors.
- Define changed GraphQL or HTTP fields and operations explicitly. Include required versus optional inputs, nullability, defaults, response shape, error cases, and backward-compatibility expectations.
- Keep work within the stated scope. Do not silently add adjacent schema changes, data migrations, refactors, or behavior changes that are not required by the issue contract.

## Implementation

- Preserve established package boundaries and existing response conventions. Keep transport parsing, domain behavior, authentication, and persistence responsibilities at their current seams unless the task explicitly requires an architectural change.
- Validate untrusted input at the service boundary. Return stable client-safe errors and avoid exposing credentials, tokens, SQL details, stack traces, or internal implementation data.
- Enforce authentication and resource ownership on every protected read and mutation, including indirect access through parent resources. A resource that belongs to another user should not become discoverable through differing success or error behavior.
- Keep authentication and password-reset behavior secure: use existing password hashing, JWT, token-expiry, and middleware helpers; never log secrets or store plaintext passwords or tokens.
- Persist data when the issue contract requires durable behavior. Do not substitute process-local or demo state for database-backed behavior without an explicit scope decision in the issue.
- Make multi-step writes atomic when partial completion would violate an invariant. Pass cancellation-aware request contexts through database calls and do not discard returned errors.
- For schema changes, add ordered `up` and `down` migrations under `backend/internal/db/migrations`. Prefer additive, backward-compatible changes; document and test destructive or irreversible changes explicitly.
- Keep API behavior compatible with existing callers unless the issue explicitly authorizes a breaking change. Update all in-repository consumers and fixtures when a contract intentionally changes.

## Tests and verification

- Add regression tests at the narrowest reliable seam, then add operation-level coverage when behavior crosses authentication, authorization, serialization, or persistence boundaries.
- Cover the successful path and relevant failures: missing or malformed input, unauthenticated access, cross-user access, absent resources, persistence errors, and boundary values.
- For migrations, verify discovery and application behavior. When database access is available, exercise the migration and affected queries against PostgreSQL; otherwise state that integration coverage was not run and why.
- Before declaring a backend task verified, inspect the documented configuration and run the exact real integration or live command when the configured service is available. A fake, mock, synthetic TCP listener, httptest server, or in-memory repository is not live integration evidence and must not be reported as such. If the service is unavailable, record the failed availability check and leave the task incomplete.
- Run focused tests while implementing. Before handoff, run these commands unfiltered from `backend/` and require zero exit status:

  ```bash
  go build ./...
  go test ./... -count=1 -short -v
  go test ./... -count=1 -coverprofile=coverage.out -v
  go tool cover -func=coverage.out
  ```

- Run `make test-integration` when the change depends on real database behavior and the required database is available. Do not claim integration verification when only unit tests ran.
- Write temporary verification scripts for these checks in Bash and run them with `bash`. Do not generate a PowerShell verification script unless Bash is unavailable or the user explicitly requests PowerShell.
- Automated unit, fake, mock, and SQL-mock tests are regression evidence at a seam. They do not substitute for API acceptance or prove real PostgreSQL, Vault, Casdoor, or other external-service behavior.
- For every HTTP/API, authentication, persistence, or migration change, run a documented manual API flow against the actual built or started service at the exact URL and port recorded for handoff. If that flow cannot run, record it as not run or blocked; do not promote an isolated-port, stale-process, mock, or partial harness result to live acceptance.
- Put copy-paste request steps in the issue or PR: working directory and launch command, readiness check, every documented fixture source checked before declaring authentication blocked, real request payloads, expected status/body, observed status/body, persistence boundary, fixture cleanup, and the command's exit status. Keep credentials, tokens, cookies, and connection strings out of the record.
- Treat race-sensitive shared-state changes as requiring `go test -race` for the affected packages when the current platform supports it.
- Report exact commands and exit results. Distinguish environment blockers and pre-existing failures from regressions introduced by the task.
- Before staging and handoff, inspect `git status --short`; do not commit `coverage.out`, local environment files, database dumps, logs, credentials, or unrelated user files.

## Handoff

Stage only intended backend, test, migration, and documentation files. Commit, push, and open or update the PR according to the delivery workflow. Summarize API or schema changes, migration impact, compatibility notes, and verification results in the PR and linked work item.
