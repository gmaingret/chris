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

export class FileExtractionError extends ChrisError {
  constructor(message: string, cause?: unknown) {
    super(message, 'FILE_EXTRACTION_ERROR', cause);
  }
}

export class OAuthError extends ChrisError {
  constructor(message: string, cause?: unknown) {
    super(message, 'OAUTH_ERROR', cause);
  }
}

export class GmailSyncError extends ChrisError {
  constructor(message: string, cause?: unknown) {
    super(message, 'GMAIL_SYNC_ERROR', cause);
  }
}

export class ImmichSyncError extends ChrisError {
  constructor(message: string, cause?: unknown) {
    super(message, 'IMMICH_SYNC_ERROR', cause);
  }
}

export class DriveSyncError extends ChrisError {
  constructor(message: string, cause?: unknown) {
    super(message, 'DRIVE_SYNC_ERROR', cause);
  }
}
