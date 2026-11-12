const VALID_SCOPES = new Set(['singleton', 'transient']);

export class ServiceContainer {
  #definitions;
  #singletons = new Map();
  #resolving = [];

  constructor(definitions) {
    this.#definitions = new Map(definitions);
    Object.freeze(this);
  }

  has(token) {
    return this.#definitions.has(token);
  }

  resolve(token) {
    if (!this.#definitions.has(token)) {
      throw new Error(`Dependency is not registered: ${String(token)}`);
    }
    if (this.#resolving.includes(token)) {
      const chain = [...this.#resolving, token].map(String).join(' -> ');
      throw new Error(`Circular dependency detected: ${chain}`);
    }

    const definition = this.#definitions.get(token);
    if (definition.scope === 'value') return definition.value;
    if (definition.scope === 'singleton' && this.#singletons.has(token)) {
      return this.#singletons.get(token);
    }

    this.#resolving.push(token);
    try {
      const dependencies = Object.fromEntries(
        [...definition.dependencies].map(dependency => [dependency, this.resolve(dependency)])
      );
      const instance = definition.factory(dependencies, this);
      if (definition.scope === 'singleton') this.#singletons.set(token, instance);
      return instance;
    } finally {
      this.#resolving.pop();
    }
  }

  resolveAll(tokens) {
    return Object.fromEntries(tokens.map(token => [token, this.resolve(token)]));
  }
}

export class ServiceContainerBuilder {
  #definitions = new Map();
  #built = false;

  #register(token, definition) {
    if (this.#built) throw new Error('Container builder is already finalized.');
    if (token === undefined || token === null || token === '') throw new TypeError('Dependency token is required.');
    if (this.#definitions.has(token)) throw new Error(`Dependency is already registered: ${String(token)}`);
    if (definition.scope !== 'value' && !VALID_SCOPES.has(definition.scope)) {
      throw new TypeError(`Unsupported dependency scope: ${definition.scope}`);
    }
    this.#definitions.set(token, Object.freeze({
      ...definition,
      dependencies: Object.freeze([...(definition.dependencies || [])])
    }));
    return this;
  }

  value(token, value) {
    return this.#register(token, { scope: 'value', value });
  }

  singleton(token, factory, dependencies = []) {
    if (typeof factory !== 'function') throw new TypeError('Singleton factory must be a function.');
    return this.#register(token, { scope: 'singleton', factory, dependencies });
  }

  transient(token, factory, dependencies = []) {
    if (typeof factory !== 'function') throw new TypeError('Transient factory must be a function.');
    return this.#register(token, { scope: 'transient', factory, dependencies });
  }

  build() {
    if (this.#built) throw new Error('Container builder can only be built once.');
    this.#built = true;
    return new ServiceContainer(this.#definitions);
  }
}

export function createSingleton(factory) {
  if (typeof factory !== 'function') throw new TypeError('Singleton factory must be a function.');
  let instance;
  let initialized = false;
  return (...args) => {
    if (!initialized) {
      instance = factory(...args);
      initialized = true;
    }
    return instance;
  };
}
