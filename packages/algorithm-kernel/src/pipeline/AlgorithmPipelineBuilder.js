import { AlgorithmChain } from './AlgorithmChain.js';

/** Fluent builder for ordered algorithm/fallback handlers. */
export class AlgorithmPipelineBuilder {
  #handlers = [];

  use(name, algorithm, { when = () => true } = {}) {
    if (!algorithm || typeof algorithm.execute !== 'function') {
      throw new TypeError(`Pipeline algorithm "${name}" must expose execute(input, context).`);
    }
    this.#handlers.push({
      name,
      async handle(input, context) {
        if (!(await when(input, context))) return { handled: false };
        const value = await algorithm.execute(input, context);
        return value === null || value === undefined
          ? { handled: false }
          : { handled: true, value };
      }
    });
    return this;
  }

  build() {
    return new AlgorithmChain(this.#handlers);
  }
}
