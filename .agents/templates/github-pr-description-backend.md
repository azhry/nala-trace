# Backend PR description template

Use this template for Go service, GraphQL/API, authentication, persistence, or migration work. Replace every bracketed placeholder. Remove a conditional section only when it genuinely does not apply.

The PR description is the review and handoff record. Do not claim a check passed unless the exact command exited 0. Put blockers and pre-existing failures in their own section rather than presenting partial execution as success.

## Linked work

- Linear issue: [AZH-000 and URL]
- Parent/source issue: [issue ID and URL, or "None"]
- Depends on: [issue/PR and delivered artifact, or "None"]
- Unblocks: [issue IDs, or "None"]

## Summary

- [Observable backend outcome.]
- [API, security, persistence, or migration outcome.]
- [Important compatibility outcome.]

## Scope

### Included

- [Implemented behavior and affected package/path.]
- [Additional in-scope behavior.]

### Excluded

- [Nearby work intentionally not changed.]

## Review and merge order

- Delivery shape: [Single focused PR | Stacked PR | Parallel PR group]
- This PR's review position: [Standalone | PR 1 of N | PR N of N | Parallel member A/B]
- Base branch: [main or predecessor branch]
- Depends on: [PR/commit and the exact delivered behavior, or "None"]
- Review order: [Exact order, or "Any order within <parallel group>"]
- Merge order and conditions: [Exact merge sequence and prerequisite checks, or "Any order; all required checks green"]
- Parallel group: [Group name and independent members, or "None"]
- Human-verification focus: [The one behavior and manual check a reviewer should prioritize]

## Verification

### Manual request/response sequence

Write this as small, copy-pasteable Bash steps in the PR description. Do not
attach a script file or combine the verification into one bulk script. Run the
steps against the verified staging services with real accounts and persisted
data; do not use placeholder values, fake endpoints, mocks, or copied secrets.

#### Step 0 — Load tools and the verified staging environment

```bash
command -v curl
command -v jq
set -a
. .agents/.env
set +a
: "${STAGING_NALA_LABS_AUTH_URL:?Set the verified staging auth URL}"
: "${STAGING_NALA_TRACE_URL:?Set the verified staging Nala Trace URL}"
export NALA_LABS_AUTH_URL="$STAGING_NALA_LABS_AUTH_URL"
export API_BASE_URL="$STAGING_NALA_TRACE_URL"
printf 'staging auth: %s\nstaging trace: %s\n' "$NALA_LABS_AUTH_URL" "$API_BASE_URL"
```

Expected response:

```text
<path-to-curl>
<path-to-jq>
staging auth: https://<verified-staging-auth-host>
staging trace: https://<verified-staging-trace-host>
```

The commands must exit 0. Replace the example paths and hosts with the actual
observed values before handoff.

#### Step 1 — Load the real staging test account for Nala Labs auth

```bash
: "${CASDOOR_ADMIN_TEST_USERNAME:?Load the staging fixture from .agents/.env}"
: "${CASDOOR_ADMIN_TEST_PASSWORD:?Load the staging fixture from .agents/.env}"
export NALA_LABS_USERNAME="$CASDOOR_ADMIN_TEST_USERNAME"
export NALA_LABS_PASSWORD="$CASDOOR_ADMIN_TEST_PASSWORD"
printf 'staging account fixture loaded\n'
```

Expected response:

```text
staging account fixture loaded
```

The command must exit 0 without printing the username or password.

#### Step 2 — Get the Nala Labs session JWT from Nala Labs auth

The login request below goes to `NALA_LABS_AUTH_URL`; Nala Trace does not
perform a separate Casdoor login.

```bash
login_response="$(curl --silent --show-error --fail-with-body \
  --header 'Content-Type: application/json' \
  --data "$(jq -n --arg u "$NALA_LABS_USERNAME" --arg p "$NALA_LABS_PASSWORD" \
    '{username: $u, password: $p}')" \
  "$NALA_LABS_AUTH_URL/api/auth/login")"
printf '%s\n' "$login_response" | jq 'del(.token)'
export NALA_LABS_JWT="$(printf '%s' "$login_response" | jq -er '.token')"
```

Expected response:

```json
{"authenticated":true,"user":{"id":"<verified-fixture-user-id>","tier":"admin"}}
```

The request must return HTTP 200 and keep the JWT only in the current shell.

#### Step 3 — Create the real Codex Trace API token through Nala Labs auth

The API-key request below also goes to Nala Labs auth. Nala Trace is called only
after this Nala Labs credential flow has completed.

```bash
api_key_response="$(curl --silent --show-error --fail-with-body \
  --header 'Content-Type: application/json' \
  --header "Authorization: Bearer $NALA_LABS_JWT" \
  --data '{"name":"nala-trace-pr","permissions":["trace:read","trace:write"]}' \
  "$NALA_LABS_AUTH_URL/api/auth/api-key")"
printf '%s\n' "$api_key_response" | jq 'del(.apiKey)'
export CODEX_TRACE_API_TOKEN="$(printf '%s' "$api_key_response" | jq -er '.apiKey')"
```

Expected response:

```json
{"name":"nala-trace-pr","permissions":["trace:read","trace:write"]}
```

The request must return HTTP 201. Keep the one-time raw API key only in
`CODEX_TRACE_API_TOKEN`; never paste it into the PR.

#### Step 4 — Remove temporary login values and create the real API fixture

```bash
unset NALA_LABS_USERNAME NALA_LABS_PASSWORD NALA_LABS_JWT \
  CASDOOR_ADMIN_TEST_USERNAME CASDOOR_ADMIN_TEST_PASSWORD
export SESSION_ID="curl-live-$(date +%s%N)"
export EVENT_JSON="{\"session_id\":\"$SESSION_ID\",\"hook_event_name\":\"Stop\"}"
printf 'session fixture: %s\n' "$SESSION_ID"
```

Expected response:

```text
session fixture: curl-live-<observed-timestamp-id>
```

The command creates a unique real staging fixture and prints no credentials.

#### Step 5 — [real behavior under test]

Command:

```bash
curl --fail-with-body --silent --show-error \
  --header "X-Nala-Labs-API-Key: $CODEX_TRACE_API_TOKEN" \
  "$API_BASE_URL/<documented-staging-path>"
```

Expected response:

```json
{"<field>":"<verified-staging-value>"}
```

Replace the path and response with the real staging operation and observed
contract before handoff.

#### Step 6 — [required regression, error, or ownership check]

Command:

```bash
[one Bash command for the real staging boundary case]
```

Expected response:

```text
[exact status, response field, or assertion observed in staging]
```

Add one numbered step per meaningful action, each with its own Bash command,
expected response, and exact exit status. Distinguish staging or pre-existing
failures from regressions introduced by the PR.

## Known limitations and pre-existing failures

- [Exact command, exit status, affected path, and why it is unrelated; or "None known".]

## Reviewer focus

- [Highest-risk contract, migration, authorization, or concurrency decision.]
- [Specific file or behavior that merits close review.]

## Completion self-audit

- [ ] Every issue requirement is mapped to an implemented outcome or explicit blocker.
- [ ] Every changed operation lists its inputs, outputs, errors, and authorization behavior.
- [ ] Persistence claims cross a new request/client/process boundary rather than reuse an in-memory object.
- [ ] Migration up/down and existing-data behavior are documented and tested where applicable.
- [ ] Success, validation, unauthenticated, cross-user, absent-resource, and persistence-error paths are covered where applicable.
- [ ] Exact unfiltered commands and exit statuses are recorded.
- [ ] Generated coverage, logs, dumps, credentials, and unrelated files are absent from the diff.
- [ ] The linked Linear issue and dependencies reflect the actual handoff state.
