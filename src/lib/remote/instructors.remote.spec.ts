/**
 * The staff half of the instructor module is the security boundary: remote
 * functions bypass route and layout loads and take their params from a client
 * header, so a guard anywhere else guards nothing.
 *
 * What this pins is therefore narrow and deliberate — that every mutation calls
 * `requireStaff` **before** it reaches the service, and that the acting staffer's
 * id is the one recorded on the grant. Schema validation is not testable through
 * this harness (the mocked `form` hands back the handler without applying the
 * schema), which is why the note-is-required rules are pinned in
 * `instructor-service.spec.ts` against real SQLite instead.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireStaff = vi.fn(async () => ({ id: 'staff-1' }));
const requireCapabilityOrOwner = vi.fn(async () => 'staff' as const);
vi.mock('$lib/server/authorization', () => ({ requireStaff, requireCapabilityOrOwner }));

const svc = {
	listForStaff: vi.fn(async () => ({ awaitingReview: [], active: [], resolved: [] })),
	getByUserId: vi.fn(async () => null),
	approve: vi.fn(async () => undefined),
	sendBack: vi.fn(async () => undefined),
	grant: vi.fn(async () => undefined),
	pause: vi.fn(async () => undefined),
	retire: vi.fn(async () => undefined)
};
vi.mock('$lib/server/instructor/instructor-service', () => svc);

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: { id: 'staff-1' } } }),
	query: (...args: unknown[]) => tag(args, 'query'),
	form: (...args: unknown[]) => tag(args, 'form')
}));

function tag(args: unknown[], type: string) {
	const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as Record<string, unknown>;
	handler.__ = { type };
	handler.for = () => handler;
	return handler;
}

const remote = (await import('./instructors.remote')) as unknown as Record<
	string,
	(data: unknown) => Promise<unknown>
>;

beforeEach(() => {
	vi.clearAllMocks();
	requireStaff.mockResolvedValue({ id: 'staff-1' });
});

describe('every mutation is staff-only', () => {
	const calls: [string, unknown][] = [
		['approveInstructor', { id: 'i-1' }],
		['sendBackInstructor', { id: 'i-1', note: 'add levels' }],
		['grantInstructor', { userId: 'u-1' }],
		['pauseInstructor', { id: 'i-1', note: 'summer' }],
		['retireInstructor', { id: 'i-1', note: 'moved' }]
	];

	it.each(calls)('%s guards before touching the service', async (name, data) => {
		await remote[name](data);
		expect(requireStaff).toHaveBeenCalled();
	});

	it.each(calls)('%s refuses when the guard throws', async (name, data) => {
		requireStaff.mockRejectedValueOnce(new Error('403'));
		await expect(remote[name](data)).rejects.toThrow('403');
		// The guard runs first, so nothing reached the service.
		for (const fn of Object.values(svc)) expect(fn).not.toHaveBeenCalled();
	});
});

describe('the acting staffer is recorded, not the subject', () => {
	it('grants as the staffer who clicked', async () => {
		await remote.grantInstructor({ userId: 'u-1' });
		expect(svc.grant).toHaveBeenCalledWith('u-1', 'staff-1');
	});

	it('approves as the staffer who clicked', async () => {
		await remote.approveInstructor({ id: 'i-1' });
		expect(svc.approve).toHaveBeenCalledWith('i-1', 'staff-1');
	});

	it('carries the note through on send back', async () => {
		await remote.sendBackInstructor({ id: 'i-1', note: 'say which levels' });
		expect(svc.sendBack).toHaveBeenCalledWith('i-1', 'staff-1', 'say which levels');
	});

	it.each([
		['pauseInstructor', 'pause'],
		['retireInstructor', 'retire']
	])('%s passes its note to the service', async (remoteName, svcName) => {
		await remote[remoteName]({ id: 'i-1', note: 'because' });
		expect(svc[svcName as 'pause' | 'retire']).toHaveBeenCalledWith('i-1', 'staff-1', 'because');
	});
});

describe('reads', () => {
	it('lists for staff behind the staff guard', async () => {
		await remote.getStaffInstructors(undefined);
		expect(requireStaff).toHaveBeenCalled();
		expect(svc.listForStaff).toHaveBeenCalled();
	});

	it('lets a member read their own record, not only staff', async () => {
		// `requireCapabilityOrOwner`, not `requireCapability`: the member needs this for the
		// profile card, and the guard already expresses exactly that.
		await remote.getUserInstructor('u-1');
		expect(requireCapabilityOrOwner).toHaveBeenCalledWith('instructor.read', 'u-1');
		expect(requireStaff).not.toHaveBeenCalled();
	});
});
