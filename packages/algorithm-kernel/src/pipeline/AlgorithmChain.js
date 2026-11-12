/**
 * Chain of Responsibility contract:
 * handlers return { handled: true, value } when they own the request;
 * { handled: false } or null passes it to the next handler.
 */
export class AlgorithmChain {
  constructor(handlers = []) {
    this.handlers = [...handlers];
  }

  async execute(input, context = {}) {
    for (const handler of this.handlers) {
      const result = await handler.handle(input, context);
      if (result?.handled === true) return result.value;
    }
    return null;
  }
}
