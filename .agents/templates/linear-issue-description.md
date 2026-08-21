## TL;DR

[In 1–3 sentences, explain what this issue changes, who is affected, and the observable outcome.]

## Process Flow

Show the actors and services involved, then mark the implementation change with the highlighted region and the IMPLEMENTATION CHANGE annotation. Keep the diagram focused on the normal path.

~~~mermaid
sequenceDiagram
    actor Human as Human
    participant Client as Client/UI
    participant API as Backend API
    participant Store as Database/External Service

    Human->>Client: Start the normal flow
    Client->>API: Send the request
    rect rgb(255, 244, 204)
        Note over API,Store: IMPLEMENTATION CHANGE HERE
        API->>Store: Apply the changed operation
        Store-->>API: Return the result
    end
    API-->>Client: Return the response
    Client-->>Human: Show the observable outcome
~~~

<details>
<summary>Diagram source</summary>

~~~mermaid
sequenceDiagram
    actor Human as Human
    participant Client as Client/UI
    participant API as Backend API
    participant Store as Database/External Service

    Human->>Client: Start the normal flow
    Client->>API: Send the request
    rect rgb(255, 244, 204)
        Note over API,Store: IMPLEMENTATION CHANGE HERE
        API->>Store: Apply the changed operation
        Store-->>API: Return the result
    end
    API-->>Client: Return the response
    Client-->>Human: Show the observable outcome
~~~

</details>

Legend: the pale-yellow region and annotation identify where the implementation changes. Replace the example actors, services, messages, and change annotation with the real flow before publishing the issue.

## Before-After

### Before

~~~mermaid
sequenceDiagram
    actor Human as Human
    participant Client as Client/UI
    participant API as Backend API
    participant Store as Database/External Service

    Human->>Client: Start the normal flow
    Client->>API: Existing request
    API->>Store: Existing operation
    Store-->>API: Existing result
    API-->>Client: Existing response
    Client-->>Human: Existing outcome
~~~

<details>
<summary>Before diagram source</summary>

~~~mermaid
sequenceDiagram
    actor Human as Human
    participant Client as Client/UI
    participant API as Backend API
    participant Store as Database/External Service

    Human->>Client: Start the normal flow
    Client->>API: Existing request
    API->>Store: Existing operation
    Store-->>API: Existing result
    API-->>Client: Existing response
    Client-->>Human: Existing outcome
~~~

</details>

### After

~~~mermaid
sequenceDiagram
    actor Human as Human
    participant Client as Client/UI
    participant API as Backend API
    participant NewService as Changed Service
    participant Store as Database/External Service

    Human->>Client: Start the normal flow
    Client->>API: Same entry request
    rect rgb(255, 244, 204)
        Note over API,NewService: IMPLEMENTATION CHANGE HERE
        API->>NewService: New or changed operation
        NewService->>Store: Updated persistence/integration call
        Store-->>NewService: Updated result
        NewService-->>API: Changed service response
    end
    API-->>Client: Updated response
    Client-->>Human: Updated observable outcome
~~~

<details>
<summary>After diagram source</summary>

~~~mermaid
sequenceDiagram
    actor Human as Human
    participant Client as Client/UI
    participant API as Backend API
    participant NewService as Changed Service
    participant Store as Database/External Service

    Human->>Client: Start the normal flow
    Client->>API: Same entry request
    rect rgb(255, 244, 204)
        Note over API,NewService: IMPLEMENTATION CHANGE HERE
        API->>NewService: New or changed operation
        NewService->>Store: Updated persistence/integration call
        Store-->>NewService: Updated result
        NewService-->>API: Changed service response
    end
    API-->>Client: Updated response
    Client-->>Human: Updated observable outcome
~~~

</details>

Replace both diagrams with the real before and after paths. Keep the same actors and services where they are unchanged, and make the changed sequence visibly distinct.

## Implementation Manual Test and Verification

Write the verification directly in this description and in the PR description as separate Bash steps. Do not create a script file or paste one large bulk script. Replace every bracketed value with the real staging target, fixture, path, payload, and observed response before handoff. Never use fake records, mocks, or copied secrets.

### Step 0 — Load the verified staging environment

~~~bash
set -a
. .agents/.env
set +a
: "${STAGING_API_BASE_URL:?Set this to the verified staging API URL}"
export API_BASE_URL="$STAGING_API_BASE_URL"
printf 'staging target: %s\n' "$API_BASE_URL"
~~~

Expected response:

~~~text
staging target: https://[verified-staging-host]
~~~

The command exits 0 and prints only the verified target, never credentials.

### Step 1 — Authenticate when the flow requires it

Use the real fixture account supplied by .agents/.env, keep the token in the current shell, and print only a redacted response.

~~~bash
login_response="$(curl --fail-with-body --silent --show-error \
  --request POST \
  --header 'Content-Type: application/json' \
  --data "{\"username\":\"$CASDOOR_TEST_USERNAME\",\"password\":\"$CASDOOR_TEST_PASSWORD\"}" \
  "$API_BASE_URL/api/auth/login")"
printf '%s\n' "$login_response" | jq 'del(.token)'
export TOKEN="$(printf '%s' "$login_response" | jq -er '.token')"
~~~

Expected response:

~~~json
{"authenticated":true,"user":{"id":"[verified-fixture-user-id]","tier":"[verified-fixture-tier]"}}
~~~

The login command exits 0 and exports TOKEN; do not place the token in the issue, PR, shell history, or a committed file.

### Step 2 — Exercise the changed behavior

~~~bash
curl --fail-with-body --silent --show-error \
  --header "Authorization: Bearer $TOKEN" \
  --header 'Content-Type: application/json' \
  --request [GET|POST|PATCH|DELETE] \
  --data '[real staging payload]' \
  "$API_BASE_URL/[documented-staging-path]"
~~~

Expected response:

~~~json
[redacted response captured from the real staging request]
~~~

The command exits 0 and demonstrates the issue’s observable success contract.

### Step 3 — Exercise the required regression, error, or ownership case

~~~bash
[one Bash command for the real staging regression/error/ownership scenario]
~~~

Expected response:

~~~text
[exact status, response field, or assertion observed in staging]
~~~

The command exits with the status defined by the contract, and the response proves the boundary case rather than only proving that the endpoint is reachable.

### Step 4 — Record evidence

For every step, record the exact command, exit status, sanitized response, and environment/fixture identity. Keep credentials, JWTs, API keys, and unrelated diagnostics out of the issue and PR.
