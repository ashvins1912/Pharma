# Pharma service architecture standard

## Chosen hybrid

Use **Clean Architecture + Hexagonal Architecture (Ports and Adapters) + pragmatic DDD**. The architecture is service-first: each independently deployed service owns its domain, persistence, configuration, API contract and lifecycle. The API Gateway handles edge concerns; it must not become a business-logic or cross-service database layer.

The dependency direction is:

```
HTTP / Messaging / Scheduler (inbound adapters)
                 |
                 v
       Application use cases
                 |
                 v
        Domain model + policies
                 ^
                 |
       Ports (interfaces/contracts)
                 ^
                 |
     Infrastructure adapters
 (Mongo, HTTP clients, files, queues)
```

Domain and application code must not import Express, Mongoose, Axios, filesystem APIs, environment variables, or another service's models.

## Standard service layout

Use this as the target for new work and incremental migrations. Do not move a large legacy file only to make the tree look clean; extract one coherent use case and its dependencies at a time.

```
services/<service-name>/src/
  domain/
    entities/
    value-objects/
    policies/
    events/
    errors/
  application/
    ports/
      inbound/
      outbound/
    use-cases/
    dto/
    services/
  infrastructure/
    persistence/
      mongo/
      memory/
    messaging/
    clients/
    storage/
    observability/
  interfaces/
    http/
      controllers/
      routes/
      validators/
      presenters/
  composition/
    container.js
    registerDependencies.js
  config/
  server.js
  index.js
```

For the legacy backend, keep bounded contexts under `backend/modules/<context>` and migrate toward the same internal layout. Do not make the legacy backend a shared persistence library for independently deployed services.

## SOLID rules

- **Single Responsibility:** a use case orchestrates one business action; repositories persist/query; controllers translate HTTP; policies own business decisions; adapters translate external protocols.
- **Open/Closed:** add a new pricing, assignment, storage or notification strategy through a port/strategy registration instead of branching across unrelated services.
- **Liskov Substitution:** every adapter must satisfy the same port semantics, including tenant scope, ordering, pagination, errors and transaction behavior.
- **Interface Segregation:** prefer small ports such as `OrderReader`, `OrderWriter`, `InventoryReservationPort`, `PrescriptionVerificationPort`; avoid one giant repository interface.
- **Dependency Inversion:** application use cases receive ports through constructors. Infrastructure implements ports. Composition roots choose adapters.

## Pattern selection guide

| Pattern | Use in Pharma | Guardrail |
|---|---|---|
| Repository | Aggregate persistence and query boundaries | Never return Mongoose documents from application ports |
| Adapter | Mongo, memory, HTTP, storage and queue integrations | Translate provider-specific types/errors at the edge |
| Factory | Select adapter by deployment configuration or tenant capability | Validate configuration once; do not silently downgrade critical writes |
| Singleton | Process-scoped connection pools, immutable config, container | Never store request/user/tenant state in a singleton |
| Builder | Assemble and validate the dependency graph at startup | Build once; reject duplicate tokens and circular dependencies |
| Strategy | Pricing, rider assignment, fulfilment and notification policies | Strategies must be interchangeable and deterministic where possible |
| Unit of Work | Multi-repository atomic writes inside one service/database | Never pretend to provide a distributed transaction across services |
| Outbox / Inbox | Reliable cross-service events and idempotent consumption | Persist event with state change; retry with dedupe keys |
| Decorator | Metrics, tracing, retries and caching around ports | Preserve port semantics; retries only for safe/idempotent operations |
| Specification / Query Object | Complex catalogue and operational filters | Validate filters and enforce tenant scope before execution |

Do not add a pattern just to satisfy a checklist. A simple function is preferable when it has one stable implementation.

## Dependency injection and lifecycle

`@pharma/service-kernel` supplies small framework-neutral primitives:
- `ServiceContainerBuilder` assembles immutable dependency registrations.
- `singleton` is for process-lifetime dependencies; `transient` creates a fresh instance per resolution; `value` injects immutable or externally owned values.
- factories receive named dependencies and are resolved lazily.
- duplicate registrations, unknown tokens and circular dependencies fail fast.
- `AppError` carries a stable code/status and hides internal 5xx details by default.
- `Result` is available for expected outcomes where exceptions are not the better fit.
- `UseCase` is a lightweight application contract.

Each service should have exactly one composition root. Only the composition root may know concrete adapter classes. A service container is process-scoped; request context is passed explicitly as an argument or resolved from request middleware, never stored in singleton instances.

## Data ownership and service boundaries

- Inventory owns product catalogue, branch stock, batch/expiry, reservation and stock adjustment writes.
- Order owns order lifecycle, order events, fulfilment gate and order idempotency.
- Prescription owns prescription documents, extraction and review lifecycle.
- API Gateway authenticates/authorizes edge requests, validates capabilities, injects trusted context and routes requests. It does not read service databases.
- Cross-service communication uses versioned HTTP contracts or durable events. Never import another service's Mongoose model or collection.
- Tenant and branch scope are mandatory query inputs for tenant-owned data. Repositories enforce scope even when upstream middleware already checked it.
- Cross-service workflows use sagas/outbox/inbox patterns; no cross-database transaction assumptions.

## Error, validation and observability conventions

- Validate untrusted input at the HTTP/message boundary; validate invariants again in domain/application logic.
- Use stable machine-readable error codes. Do not return stack traces, database errors, secrets or raw provider messages to clients.
- Include requestId and correlationId in logs and downstream calls.
- Log operation name, duration, outcome and safe scope identifiers; do not log prescription contents, access tokens, passwords or full personal health data.
- Map domain/application errors to HTTP in the HTTP adapter only.
- Health checks are liveness; readiness checks required dependencies and should fail closed when writes cannot be safely served.

## Migration sequence

1. **Foundation (this change):** add the shared kernel, DI builder, error/result/use-case primitives and migrate the delivery composition root to explicit factory registrations.
2. **Inventory:** extract read/write ports from the current inventory module; move Mongo queries to Mongo adapters; move validation and stock policies to domain/application modules; keep HTTP DTOs unchanged.
3. **Orders:** split order lifecycle use cases from Mongo persistence and prescription/inventory HTTP clients; isolate event/outbox persistence and idempotency behavior.
4. **Prescription and notifications:** extract provider clients/storage adapters, preserve encryption and access/removal policy boundaries.
5. **Legacy backend:** migrate bounded contexts one at a time; keep compatibility facades until all callers move, then remove direct model imports from application services.
6. **Operational hardening:** add adapter contract tests, Mongo integration tests, explain-plan baselines, failure/retry tests, service contract tests and deployment canaries.

## Definition of done for each migrated use case

- Existing endpoint, DTO, status codes and business behavior remain compatible unless an explicit API change is approved.
- Application use case can be tested with fake ports and without Mongo/Express.
- Mongo and in-memory adapters pass the same contract tests.
- Tenant/branch isolation is tested at repository level.
- Atomicity, optimistic concurrency, idempotency and retry behavior are explicit.
- No cross-service database/model import exists.
- Metrics/logs and health/readiness behavior are verified.
- CI and integration tests pass before the service is deployed.
