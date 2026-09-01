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

export class AuthError extends FairShareError {
  readonly statusCode = 401;
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class RateLimitError extends FairShareError {
  readonly statusCode = 429;
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}
