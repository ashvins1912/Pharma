# @pharma/algorithm-kernel

Small, runtime-neutral primitives and extension points shared by frontend and Node services.

## Design

- **Strategy / Registry:** register named implementations and switch by configuration.
- **Chain of Responsibility:** ordered handlers can claim a request or pass it onward.
- **Builder:** assemble deterministic pipelines without coupling callers to concrete algorithms.
- **Adapter contract:** plugins expose `execute(input, context)`; wrap third-party APIs behind that contract.
- **Pure text primitives:** shared normalization and Jaro-Winkler similarity.

Keep medicine-specific identity rules, clinical conflict gates, confidence thresholds, persistence, and authorization in their owning domain services. A plugin may rank candidates, but must never bypass domain validation or silently approve a medicine merge.

## Example

```js
import { AlgorithmRegistry, AlgorithmPipelineBuilder } from '@pharma/algorithm-kernel';

const registry = new AlgorithmRegistry()
  .register('baseline', { execute: async input => ({ candidates: input }) });

const pipeline = new AlgorithmPipelineBuilder()
  .use('baseline', { execute: input => registry.execute('baseline', input) })
  .use('remote-fallback', remoteAdapter, { when: input => input.allowRemote })
  .build();

const result = await pipeline.execute(candidates, { requestId });
```

Plugins should be deterministic where possible, declare versions, enforce timeouts at their adapter boundary, and return a common result shape. Do not log patient-identifiable data in plugin telemetry.
