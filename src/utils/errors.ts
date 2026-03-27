export class ChrisError extends Error {
  constructor(message: string, public code: string, public cause?: unknown) {
    super(message);
    this.name = 'ChrisError';
  }
}

export class RetrievalError extends ChrisError {
  constructor(message: string, cause?: unknown) {
    super(message, 'RETRIEVAL_ERROR', cause);
  }
}

export class StorageError extends ChrisError {
  constructor(message: string, cause?: unknown) {
    super(message, 'STORAGE_ERROR', cause);
  }
}

export class LLMError extends ChrisError {
  constructor(message: string, cause?: unknown) {
    super(message, 'LLM_ERROR', cause);
  }
}
