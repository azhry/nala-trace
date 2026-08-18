# Nala Trace knowledge index

This directory is the project knowledge map for agents working on Nala SVC.
Read this index first, then open the knowledge file that matches the task.

## Knowledge map

| Path | Purpose |
| --- | --- |
| [api-contracts.md](api-contracts.md) | HTTP and Server-Sent Events contracts currently implemented by the Nala SVC deployment API, including authentication, request examples, response shapes, errors, pagination, and streaming behavior. |
| [nala-labs/architecture.md](nala-labs/architecture.md) | Nala Labs platform topology, services, public/internal endpoints, routing, persistence, and installer module responsibilities. |
| [nala-labs/authentication.md](nala-labs/authentication.md) | Casdoor, backend session, local startup, tier mapping, and authentication verification contract used by the Nala Labs environment. |
| [nala-labs/defaults.md](nala-labs/defaults.md) | Development service defaults, local access notes, database/cache topology, and configuration discovery guidance. It contains lab-only credentials; do not copy them into source, tests, tickets, or PRs. |
| [nala-labs/architecture-final.svg](nala-labs/architecture-final.svg) | Visual companion to the Nala Labs platform architecture document. |
| [nala-trace/configuration.md](nala-trace/configuration.md) | Nala Trace application environment names, local/Kubernetes defaults, Vault ownership, workload mapping, startup validation, and redaction rules. |
| [nala-trace/casdoor.md](nala-trace/casdoor.md) | Nala Trace Casdoor application, scopes, grant, callback overrides, secret ownership, and pre-authentication validation checklist. |
| [nala-trace/hooks.md](nala-trace/hooks.md) | Nala Trace Codex hook delivery, runtime configuration, manifest validation, trust guidance, and known coverage gaps. |

## Reading order

1. Start with this file to locate the relevant domain knowledge.
2. For API, handler, client, or integration work, read [api-contracts.md](api-contracts.md) and then inspect the implementation under `backend/`.
3. For database, authentication, runtime, or local-platform work, read the applicable file under [nala-labs/](nala-labs/).
4. Treat source code, migrations, and executable tests as the final authority when this documentation and implementation differ; update the documentation when the contract intentionally changes.

## Coverage boundary

The root knowledge directory contains the Nala SVC API contract and this index.
Nala Labs platform context is grouped under `nala-labs/` so it remains
separate from the service-specific API contract.
