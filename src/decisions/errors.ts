export type DecisionStatusLiteral =
  | 'open-draft' | 'open' | 'due' | 'resolved'
  | 'reviewed' | 'withdrawn' | 'stale' | 'abandoned';

export class InvalidTransitionError extends Error {
  public readonly fromStatus: DecisionStatusLiteral;
  public readonly toStatus: DecisionStatusLiteral;
  constructor(fromStatus: DecisionStatusLiteral, toStatus: DecisionStatusLiteral) {
    super(`Illegal decision transition: ${fromStatus} -> ${toStatus}`);
    this.name = 'InvalidTransitionError';
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
    Object.setPrototypeOf(this, InvalidTransitionError.prototype);
  }
}

export class OptimisticConcurrencyError extends Error {
  public readonly decisionId: string;
  public readonly expectedStatus: DecisionStatusLiteral;
  constructor(decisionId: string, expectedStatus: DecisionStatusLiteral) {
    super(`Optimistic concurrency failed for decision ${decisionId}: expected status='${expectedStatus}' but row was modified concurrently`);
    this.name = 'OptimisticConcurrencyError';
    this.decisionId = decisionId;
    this.expectedStatus = expectedStatus;
    Object.setPrototypeOf(this, OptimisticConcurrencyError.prototype);
  }
}

export class DecisionNotFoundError extends Error {
  public readonly decisionId: string;
  constructor(decisionId: string) {
    super(`Decision not found: ${decisionId}`);
    this.name = 'DecisionNotFoundError';
    this.decisionId = decisionId;
    Object.setPrototypeOf(this, DecisionNotFoundError.prototype);
  }
}
