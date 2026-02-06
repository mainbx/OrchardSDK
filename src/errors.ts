export class OrchardError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "OrchardError";
    this.code = code;
  }
}

export class ValidationError extends OrchardError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends OrchardError {
  constructor(message: string) {
    super("NOT_FOUND", message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends OrchardError {
  constructor(message: string) {
    super("CONFLICT", message);
    this.name = "ConflictError";
  }
}

export class IdempotencyConflictError extends OrchardError {
  constructor(message: string) {
    super("IDEMPOTENCY_CONFLICT", message);
    this.name = "IdempotencyConflictError";
  }
}

export class PolicyViolationError extends OrchardError {
  constructor(message: string) {
    super("POLICY_VIOLATION", message);
    this.name = "PolicyViolationError";
  }
}
