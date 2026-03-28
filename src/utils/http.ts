/**
 * Shared HTTP utilities for external API calls.
 * Provides timeout-aware fetch and retry logic with exponential backoff.
 */

import { logger } from './logger.js';

/** Default timeout for external HTTP requests (30 seconds). */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Fetch with an AbortController timeout.
 * Throws if the request takes longer than timeoutMs.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/** Custom error class for retryable HTTP status codes. */
export class RetryableHttpError extends Error {
  constructor(
    public readonly status: number,
    url: string,
  ) {
    super(`HTTP ${status} from ${url}`);
    this.name = 'RetryableHttpError';
  }
}

/** Errors that are safe to retry (transient failures). */
function isRetryable(error: unknown): boolean {
  // Our own retryable HTTP status error
  if (error instanceof RetryableHttpError) {
    return true;
  }
  // Network errors
  if (error instanceof TypeError && /fetch|network|ECONNREFUSED|ENOTFOUND/i.test(error.message)) {
    return true;
  }
  // AbortError from timeout
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  return false;
}

/** HTTP status codes that are safe to retry. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: 3. */
  maxAttempts?: number;
  /** Base delay in ms before first retry. Default: 1000. */
  baseDelayMs?: number;
  /** Label for log messages. */
  label?: string;
}

/**
 * Execute an async function with retry and exponential backoff.
 * Only retries on transient errors (network, timeout, 429/5xx).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 1000, label = 'operation' } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts || !isRetryable(error)) {
        throw error;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      logger.warn(
        {
          attempt,
          maxAttempts,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        },
        `${label}.retry`,
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

/**
 * Fetch with timeout + retry for transient failures.
 * Retries on network errors, timeouts, and 429/5xx responses.
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit & { timeoutMs?: number; retryOptions?: RetryOptions } = {},
): Promise<Response> {
  const { retryOptions, ...fetchOptions } = options;
  const label = retryOptions?.label ?? 'fetch';

  return withRetry(
    async () => {
      const response = await fetchWithTimeout(url, fetchOptions);

      if (isRetryableStatus(response.status)) {
        throw new RetryableHttpError(response.status, url);
      }

      return response;
    },
    { ...retryOptions, label },
  );
}
