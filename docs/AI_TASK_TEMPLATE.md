# AI_TASK_TEMPLATE.md

Use this prompt for future Pharma modifications.

```
Read `docs/AI_CONTEXT.md` before changing code.

Repository: ashvins1912/Pharma
Task: <describe the feature/fix>

Process:
1. Inspect current code and all callers.
2. Find duplicate/legacy implementations.
3. Identify the authoritative service/path.
4. Implement the smallest production-safe change.
5. Preserve service ownership, DB authority, tenant/branch isolation, RBAC, idempotency and optimistic locking.
6. Use adapters/interfaces for replaceable integrations; never hardwire provider SDKs into domain logic.
7. Do not introduce critical in-memory persistence or synchronous workflow blocking.
8. Update DB schema/indexes/config/tests/docs only where required.
9. Validate local startup impact and Render deployment impact.

Return:
- changed files
- behavior/flow change
- tests run + results
- deployment/config changes
- remaining risks
```

## Quick examples

### Bug fix
```
Read docs/AI_CONTEXT.md.
Fix: <bug>.
Trace the current flow, fix the root cause, add regression tests, and verify no tenant/security/idempotency regression.
```

### New feature
```
Read docs/AI_CONTEXT.md.
Add: <feature>.
Follow existing service ownership and UI patterns; do not create duplicate services or alternate business logic.
```

### Future integration
```
Read docs/AI_CONTEXT.md.
Add adapter support for: <provider>.
Keep DATABASE as the default; provider configuration must be replaceable and must not change domain-state rules.
```
