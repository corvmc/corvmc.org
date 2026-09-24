import { describe, it, expect, vi, beforeEach } from 'vitest';

let everywhere = false;
let forEvent: string | null = null;
const can = vi.fn(async (_cap: string, scope?: { eventId?: string }) =>
	scope?.eventId ? scope.eventId === forEvent : everywhere
);
vi.mock('$lib/server/authorization', () => ({ can }));

const { recapUploadAccess } = await import('./recap-access');

beforeEach(() => {
	vi.clearAllMocks();
	everywhere = false;
	forEvent = null;
});

describe('recapUploadAccess', () => {
	it('is null when signed out, without checking anything', async () => {
		expect(await recapUploadAccess(undefined, 'e1')).toBeNull();
		expect(can).not.toHaveBeenCalled();
	});

	it('is capability for a holder of event.uploadRecap everywhere', async () => {
		everywhere = true;
		expect(await recapUploadAccess('u1', 'e1')).toBe('capability');
	});

	it("is photographer for this event's crew, asking with this event", async () => {
		forEvent = 'e1';
		expect(await recapUploadAccess('u1', 'e1')).toBe('photographer');
		expect(can).toHaveBeenLastCalledWith('event.uploadRecap', { eventId: 'e1' });
	});

	it("is null for another event's crew", async () => {
		forEvent = 'e2';
		expect(await recapUploadAccess('u1', 'e1')).toBeNull();
	});

	it('is null once the grant window has closed', async () => {
		// The resolver answers false after the grace period; capability-grants.spec pins it.
		expect(await recapUploadAccess('u1', 'e1')).toBeNull();
	});
});
