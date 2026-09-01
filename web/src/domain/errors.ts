export class FairShareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FairShareError";
  }
}

export class ValidationError extends FairShareError {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class UnknownPersonError extends FairShareError {
  constructor(message: string) {
    super(message);
    this.name = "UnknownPersonError";
  }
}

export class ExpenseNotFoundError extends FairShareError {
  constructor(message: string) {
    super(message);
    this.name = "ExpenseNotFoundError";
  }
}
