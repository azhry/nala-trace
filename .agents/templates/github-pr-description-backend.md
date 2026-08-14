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

## API and behavior contract

Repeat a row for every changed operation. Do not combine distinct operations when their inputs, authorization, or responses differ.

Use five independent contract cells plus the Operation column. Do not merge cells, move content between cells, or repeat the same contract in multiple cells. For GraphQL operations, put the request body operation document in a `gql` code block. For REST/JSON operations, put the request body schema in a `json` code block. Use JSON schemas, not prose, for non-body inputs, responses, errors, and authorization, and pretty-print every JSON object with one property per line.

1. **Request body** — for GraphQL, the operation document only in a `gql` code block; for REST/JSON, the JSON body schema only in a `json` code block. For GET or DELETE with no body, enter exactly `null` and nothing else. Never put path parameters, query parameters, headers, auth, or server-derived values here.
2. **Path/query/header schemas** — non-body request inputs only. Put `path`, `query`, and `headers` objects here. For a GET, this is where `appID`, `podName`, `Authorization`, and `Accept` belong.
3. **Response/output schema** — the success status, content type, event/frame shape, and returned fields.
4. **Errors and status schemas** — status-to-error JSON mappings only.
5. **Authorization/ownership schema** — authentication mechanism, identity claim, resource owner, and access rule only.

Markdown table safety is mandatory: keep every table row on one physical source line. Never put literal newlines or fenced code blocks inside a table cell. For readable multiline GraphQL inside a cell, use `<pre><code class="language-gql">` with `&#10;` between operation lines. For readable multiline JSON inside a cell, use `<pre><code class="language-json">` with `&#10;` between JSON lines; do not use one-line JSON, `<br>`, or literal newlines in the cell.

For a bodyless GET, the first two cells must look like this:

```text
Request body cell:          <pre><code class="language-json">null</code></pre>
Non-body input cell:        <pre><code class="language-json">{&#10;&nbsp;&nbsp;"path": {...},&#10;&nbsp;&nbsp;"query": {...},&#10;&nbsp;&nbsp;"headers": {...}&#10;}</code></pre>
```

For a POST or PATCH, the body cell contains only the GraphQL operation document or JSON body fields; path/query/header fields still go in the separate non-body-input cell. Do not add a separate schema section below the table.

| Operation | Request body (GraphQL `gql` document or JSON schema) | Path/query/header schemas (non-body inputs only) | Response/output schema | Errors and status schemas | Authorization/ownership schema |
| --- | --- | --- | --- | --- | --- |
| `[GraphQL operation or HTTP method/path]` | `[GraphQL: <pre><code class="language-gql">[operation document]</code></pre>; REST/JSON: <pre><code class="language-json">[request body schema]</code></pre>; bodyless: <pre><code class="language-json">null</code></pre>]` | <pre><code class="language-json">[path/query/header schemas]</code></pre> | <pre><code class="language-json">[response schema]</code></pre> | <pre><code class="language-json">[error schemas]</code></pre> | <pre><code class="language-json">[authentication and ownership schema]</code></pre> |

## Verification

### Manual request/response sequence

[Fixture: real configured fixture or exact command that creates it.]

#### Step 0 — Authenticate and export the session token

```sh
set -euo pipefail
export AUTH_BASE_URL="${AUTH_BASE_URL:-http://127.0.0.1:8080}"
export API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:8081}"
: "${NALA_TEST_USERNAME:?set from the configured test fixture}"
: "${NALA_TEST_PASSWORD:?set from the configured test fixture}"
export TOKEN="$(
  curl --silent --show-error \
    --header 'Content-Type: application/json' \
    --data "$(jq -n --arg username "$NALA_TEST_USERNAME" --arg password "$NALA_TEST_PASSWORD" '{username: $username, password: $password}')" \
    "$AUTH_BASE_URL/api/auth/login" | jq --exit-status --raw-output '.token'
)"
export DEPLOYMENT_ID="${DEPLOYMENT_ID:?set to the real persisted deployment fixture}"
```

Login response:

```json
{"authenticated":true,"token":"<redacted>","user":{"id":"<fixture-user-id>","tier":"<fixture-tier>"}}
```

#### Step 1 — [behavior under test]

Request:

```sh
curl \
  --header "Authorization: Bearer $TOKEN" \
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
