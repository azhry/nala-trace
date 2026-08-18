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

## Verification

### Manual request/response sequence

[Fixture: real configured fixture or exact command that creates it.]

#### Step 0 — Check the required command-line tools

```bash
command -v curl
command -v jq
```

#### Step 1 — Load the real test account

```bash
source .agents/.env
export NALA_LABS_AUTH_URL="${NALA_LABS_AUTH_URL:-http://127.0.0.1:8080}"
export NALA_LABS_USERNAME="$CASDOOR_ADMIN_TEST_USERNAME"
export NALA_LABS_PASSWORD="$CASDOOR_ADMIN_TEST_PASSWORD"
```

#### Step 2 — Get the Nala Labs session JWT

Expect HTTP 200. Keep the JWT only in the current shell:

```bash
export NALA_LABS_JWT="$(curl --silent --show-error --fail-with-body \
  --header 'Content-Type: application/json' \
  --data "$(jq -n --arg u "$NALA_LABS_USERNAME" --arg p "$NALA_LABS_PASSWORD" \
    '{username: $u, password: $p}')" \
  "$NALA_LABS_AUTH_URL/api/auth/login" | jq -er '.token')"
```

#### Step 3 — Create the Codex Trace API token

Expect HTTP 201. This is the required step that creates the real Nala Labs
API key used by Nala Trace. Store the one-time raw value only in
`CODEX_TRACE_API_TOKEN`; never paste it into the PR:

```bash
export CODEX_TRACE_API_TOKEN="$(curl --silent --show-error --fail-with-body \
  --header 'Content-Type: application/json' \
  --header "Authorization: Bearer $NALA_LABS_JWT" \
  --data '{"name":"nala-trace-pr","permissions":["trace:read","trace:write"]}' \
  "$NALA_LABS_AUTH_URL/api/auth/api-key" | jq -er '.apiKey')"
```

#### Step 4 — Remove temporary login values and set the API fixture

```bash
unset NALA_LABS_USERNAME NALA_LABS_PASSWORD NALA_LABS_JWT \
  CASDOOR_ADMIN_TEST_USERNAME CASDOOR_ADMIN_TEST_PASSWORD
export API_BASE_URL="${NALA_TRACE_URL:-http://127.0.0.1:3003}"
export SESSION_ID="curl-live-$(date +%s%N)"
export EVENT_JSON="{\"session_id\":\"$SESSION_ID\",\"hook_event_name\":\"Stop\"}"
```

#### Step 5 — [behavior under test]

Request:

```bash
curl \
  --header "X-Nala-Labs-API-Key: $CODEX_TRACE_API_TOKEN" \
  "$API_BASE_URL/<path>"
```

Response:

```json
[copy-paste response]
```

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
