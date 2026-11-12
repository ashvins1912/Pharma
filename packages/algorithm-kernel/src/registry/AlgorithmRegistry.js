/**
 * Runtime strategy registry. Implementations are injected; the kernel owns no
 * domain policy and can therefore host local, remote, or hybrid algorithms.
 */
export class AlgorithmRegistry {
  #strategies = new Map();

  register(name, implementation, { version = '1.0.0', replace = false } = {}) {
    const key = String(name || '').trim();
    if (!key) throw new TypeError('Algorithm name is required.');
    if (!implementation || typeof implementation.execute !== 'function') {
      throw new TypeError(`Algorithm "${key}" must expose execute(input, context).`);
    }
    if (this.#strategies.has(key) && !replace) {
      throw new Error(`Algorithm "${key}" is already registered.`);
    }
    this.#strategies.set(key, Object.freeze({ name: key, version, implementation }));
    return this;
  }

  has(name) {
    return this.#strategies.has(String(name || '').trim());
  }

  resolve(name) {
    const entry = this.#strategies.get(String(name || '').trim());
    if (!entry) throw new Error(`Algorithm "${name}" is not registered.`);
    return entry;
  }

  async execute(name, input, context = {}) {
    const entry = this.resolve(name);
    return entry.implementation.execute(input, context);
  }

  list() {
    return [...this.#strategies.values()].map(({ name, version }) => ({ name, version }));
  }
}
