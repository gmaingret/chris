/**
 * src/__tests__/health.test.ts — Phase 25 Plan 03 Task 5 (RIT-12 part b)
 *
 * Per CONTEXT.md D-05: /health endpoint reports `ritual_cron_registered: true`
 * after registerCrons runs. This is the operator-visible runtime check that
 * complements the spy-based unit test in src/rituals/__tests__/cron-
 * registration.test.ts.
 *
 * Approach:
 *   - Mock node-cron + bot.js + db connection so importing src/index.ts is
 *     side-effect-free (the ESM guard around main() also keeps it inert).
 *   - Use createApp({ cronStatus }) dependency injection (added in Task 5)
 *     to inject a deterministic cronStatus into the /health route.
 *   - Invoke the /health route handler directly via a stubbed Express
 *     request/response pair (no supertest dependency).
 *
 * Coverage (2 tests):
 *   1. ritual_cron_registered === true when cronStatus.ritual === 'registered'
 *      (the success path that proves registerCrons → /health wiring)
 *   2. ritual_cron_registered === false when cronStatus is undefined or
 *      cronStatus.ritual !== 'registered' (the failure path)
 */
import { describe, it, expect, vi } from 'vitest';

const { scheduleSpy, validateSpy } = vi.hoisted(() => ({
  scheduleSpy: vi.fn(),
  validateSpy: vi.fn(() => true),
}));

vi.mock('node-cron', () => ({
  default: { schedule: scheduleSpy, validate: validateSpy },
  schedule: scheduleSpy,
  validate: validateSpy,
}));

vi.mock('../utils/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

// Mock the postgres-js sql tagged template so importing db/connection.js does
// NOT open a real socket. The /health route uses `await sql\`SELECT 1\`` —
// return a resolved Promise so the database check is ok.
vi.mock('../db/connection.js', () => {
  const sql = vi.fn(() => Promise.resolve([{ '?column?': 1 }]));
  // The tagged template form `sql\`SELECT 1\`` calls sql with (strings, ...values)
  return {
    sql,
    db: {},
  };
});

vi.mock('../db/migrate.js', () => ({
  runMigrations: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../bot/bot.js', () => {
  class MockBot {
    api = { sendMessage: vi.fn(), setWebhook: vi.fn() };
    token = 'fake-token';
    use = vi.fn();
    on = vi.fn();
    catch = vi.fn();
    start = vi.fn();
    stop = vi.fn();
  }
  return { bot: new MockBot() };
});

vi.mock('../sync/scheduler.js', () => ({
  startScheduler: vi.fn(),
  stopScheduler: vi.fn(),
}));

vi.mock('../proactive/sweep.js', () => ({
  runSweep: vi.fn(),
}));

vi.mock('../episodic/cron.js', () => ({
  runConsolidateYesterday: vi.fn(),
}));

vi.mock('../rituals/scheduler.js', () => ({
  runRitualSweep: vi.fn(),
}));

describe('/health (RIT-12 part b)', () => {
  it('reports ritual_cron_registered: true when cronStatus.ritual === "registered"', async () => {
    const { createApp } = await import('../index.js');

    const app = createApp({
      cronStatus: {
        proactive: 'registered',
        ritual: 'registered',
        episodic: 'registered',
        sync: 'disabled',
      },
    });

    // Invoke /health by issuing an in-process HTTP request to the Express app.
    // Express apps support `app.handle(req, res)` for synthetic request injection.
    const body = await invokeHealth(app);

    expect(body).toBeDefined();
    expect(body.ritual_cron_registered).toBe(true);
  });

  it('reports ritual_cron_registered: false when cronStatus.ritual is not "registered"', async () => {
    const { createApp } = await import('../index.js');

    const app = createApp({
      cronStatus: {
        proactive: 'registered',
        ritual: 'failed',
        episodic: 'registered',
        sync: 'disabled',
      },
    });

    const body = await invokeHealth(app);

    expect(body.ritual_cron_registered).toBe(false);
  });
});

/**
 * Invoke the /health route on the given Express app via a synthetic
 * request/response pair. Returns the JSON body the route wrote.
 *
 * Uses Express's internal `app.handle(req, res, next)` API to dispatch
 * without binding a real port. The req/res objects are minimal stubs that
 * satisfy what the /health handler actually reads.
 */
async function invokeHealth(app: import('express').Express): Promise<{
  status: string;
  checks: Record<string, string>;
  ritual_cron_registered: boolean;
  timestamp: string;
}> {
  return new Promise((resolve, reject) => {
    let captured: unknown;
    const req = {
      method: 'GET',
      url: '/health',
      headers: {},
    } as unknown as import('http').IncomingMessage;
    const res = {
      statusCode: 200,
      status(code: number): typeof res {
        this.statusCode = code;
        return this;
      },
      json(body: unknown): typeof res {
        captured = body;
        resolve(captured as Awaited<ReturnType<typeof invokeHealth>>);
        return this;
      },
      setHeader: vi.fn(),
      getHeader: vi.fn(),
      removeHeader: vi.fn(),
      end: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      emit: vi.fn(),
      writeHead: vi.fn(),
      headersSent: false,
    } as unknown as import('http').ServerResponse & {
      status(c: number): typeof res;
      json(b: unknown): typeof res;
    };

    try {
      // app.handle(req, res, next) is Express's internal dispatch entrypoint.
      // It walks the middleware stack synchronously then defers async handlers.
      (app as unknown as { handle: (req: unknown, res: unknown, done: () => void) => void }).handle(
        req,
        res,
        () => {},
      );
    } catch (err) {
      reject(err);
    }
  });
}
