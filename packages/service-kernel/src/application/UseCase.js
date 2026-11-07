export class UseCase {
  async execute() {
    throw new Error('UseCase.execute() must be implemented by a concrete use case.');
  }
}

export function createUseCase(handler) {
  if (typeof handler !== 'function') throw new TypeError('Use-case handler must be a function.');
  return Object.freeze({ execute: input => handler(input) });
}
