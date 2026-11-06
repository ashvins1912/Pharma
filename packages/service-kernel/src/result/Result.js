export class Result {
  constructor(isSuccess, value = null, error = null) {
    if (isSuccess && error) throw new TypeError('A successful Result cannot contain an error.');
    if (!isSuccess && !error) throw new TypeError('A failed Result must contain an error.');
    this.isSuccess = Boolean(isSuccess);
    this.isFailure = !this.isSuccess;
    this.value = value;
    this.error = error;
    Object.freeze(this);
  }

  getValue() {
    if (this.isFailure) throw new Error('Cannot read value from a failed Result.', { cause: this.error });
    return this.value;
  }

  getError() {
    if (this.isSuccess) throw new Error('Cannot read error from a successful Result.');
    return this.error;
  }

  static ok(value = null) {
    return new Result(true, value, null);
  }

  static fail(error) {
    return new Result(false, null, error instanceof Error ? error : new Error(String(error)));
  }
}
