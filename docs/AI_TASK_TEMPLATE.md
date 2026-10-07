# AI_TASK_TEMPLATE.md

Use with `docs/AI_CONTEXT.md` for low-token future work.

## Default

```
Read docs/AI_CONTEXT.md first.

Task: <feature/fix>

Inspect current implementation and all callers.
Identify the authoritative service/path and any legacy duplicate.
Preserve service ownership, tenant/branch isolation, RBAC, DB authority,
idempotency, optimistic locking, audit, and Adapter abstraction.
Do not add critical in-memory persistence or synchronous workflow blocking.
Implement the smallest production-safe change.
Add tests and validate local + Render impact.

Return:
- changed files
- flow/behavior change
- tests/results
- deployment/config impact
- remaining risks
```

## Bug

```
Read docs/AI_CONTEXT.md.
Fix: <bug>.
Trace root cause, update the authoritative implementation, add regression tests,
and verify security/idempotency/tenant isolation.
```

## Feature

```
Read docs/AI_CONTEXT.md.
Add: <feature>.
Use existing service ownership and UI patterns. Do not create duplicate business logic.
```

## Integration

```
Read docs/AI_CONTEXT.md.
Add adapter support for: <provider>.
Keep DATABASE as the current default. Provider selection/configuration must not change
domain state rules.
```

## Deployment

```
Read docs/AI_CONTEXT.md.
Fix/deploy: <service or deployment issue>.
Verify local startup, health/readiness, environment variables, PORT handling,
internal service URLs, worker startup, and Render configuration.
```
