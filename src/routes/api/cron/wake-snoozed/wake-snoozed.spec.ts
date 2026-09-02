import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockWake = vi.fn();
const mockNudge = vi.fn();
vi.mock('$lib/server/inbox/thread-service', () => ({
	wakeSnoozedThreads: (...args: unknown[]) => mockWake(...args),
	nudgeStaleAwaiting: (...args: unknown[]) => mockNudge(...args)
}));

vi.mock('$env/dynamic/private', () => ({
	env: { CRON_SECRET: 'test-secret' }
}));

function post(auth?: string) {
	return new Request('http://localhost/api/cron/wake-snoozed', {
		method: 'POST',
		headers: auth ? { Authorization: auth } : {}
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mockWake.mockResolvedValue({ woken: 0 });
	mockNudge.mockResolvedValue({ nudged: 0 });
});

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

// The import stays dynamic so it resolves after the `vi.mock` calls above, and
// sits at module scope so the cold Vite transform of the whole module graph is
// paid once, during file evaluation — not inside a test or hook, where it would
// race the 5s test / 10s hook timeout on a cold `node_modules/.vite`.
const { POST } = await import('./+server');

describe('POST /api/cron/wake-snoozed', () => {
	it('rejects requests without the cron secret', async () => {
		await expect(POST({ request: post() } as never)).rejects.toThrow();
		expect(mockWake).not.toHaveBeenCalled();
	});

	it('rejects requests with the wrong secret', async () => {
		await expect(POST({ request: post('Bearer nope') } as never)).rejects.toThrow();
		expect(mockWake).not.toHaveBeenCalled();
	});

	// Two ways out of the queue on a timer, one job. A run that woke snoozes but
	// skipped the nudge would leave "Send + wait for reply" as a way of losing a
	// conversation permanently.
	it('returns the number of threads returned to the queue, from both halves', async () => {
		mockWake.mockResolvedValue({ woken: 3 });
		mockNudge.mockResolvedValue({ nudged: 2 });

		const response = await POST({ request: post('Bearer test-secret') } as never);

		expect(await response.json()).toEqual({ woken: 3, nudged: 2 });
		expect(mockWake).toHaveBeenCalledTimes(1);
		expect(mockNudge).toHaveBeenCalledTimes(1);
	});

	it('rejects an unauthorised request before either half runs', async () => {
		await expect(POST({ request: post('Bearer nope') } as never)).rejects.toThrow();
		expect(mockNudge).not.toHaveBeenCalled();
	});
});
