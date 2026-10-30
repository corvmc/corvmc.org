import { describe, it, expect, vi, beforeEach } from 'vitest';

// Each Members view guards its own remotes (#2074): a hidden tab guards nothing.
let held = new Set<string>();
const requireCapability = vi.fn(async (cap: string) => {
	if (!held.has(cap)) throw new Error('403: Not permitted');
	return { id: 'staff-1' };
});
vi.mock('$lib/server/authorization', () => ({
	requireCapability: (cap: string) => requireCapability(cap),
	requireCapabilityOrOwner: vi.fn(),
	requireUser: vi.fn(),
	can: async (cap: string) => held.has(cap),
	getUserRoles: vi.fn()
}));
vi.mock('$lib/server/db', () => ({ db: {} }));

const listStaffUsers = vi.fn(async () => ({ rows: [], pagination: {} }));
const listAllStaffUsers = vi.fn(async () => []);
vi.mock('$lib/server/user/user-roster', () => ({
	listStaffUsers,
	listAllStaffUsers,
	userRosterFilters: {}
}));
const listInstructorRoster = vi.fn(async () => ({ rows: [], pagination: {}, pending: 0 }));
vi.mock('$lib/server/instructor/instructor-service', () => ({ listInstructorRoster }));
const listAllInstructors = vi.fn(async () => []);
vi.mock('$lib/server/instructor/instructor-roster', () => ({
	listAllInstructors,
	toServiceFilters: (f: unknown) => f,
	instructorRosterFilters: { extend: () => ({}) }
}));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: { id: 'staff-1' } } }),
	query: (...args: unknown[]) => tag(args, 'query'),
	form: (...args: unknown[]) => tag(args, 'form')
}));

// Remote modules may export only remote functions; the build checks the tag.
function tag(args: unknown[], type: string) {
	const handler = args.find((a) => typeof a === 'function') as unknown as Record<string, unknown>;
	handler.__ = { type };
	handler.for = () => handler;
	return handler;
}

type Remote = Record<string, (arg?: unknown) => Promise<unknown>>;
const users = (await import('./users.remote')) as unknown as Remote;
const instructors = (await import('./instructors.remote')) as unknown as Remote;

const ALL = [
	['getStaffUsers', () => users.getStaffUsers({})],
	['getStaffUserEmails', () => users.getStaffUserEmails({})]
] as const;
const INSTRUCTORS = [
	['getStaffInstructors', () => instructors.getStaffInstructors({ status: 'requested' })],
	['getStaffInstructorEmails', () => instructors.getStaffInstructorEmails({ status: 'active' })]
] as const;

beforeEach(() => {
	vi.clearAllMocks();
	held = new Set(['volunteer.read']);
});

describe('a volunteer.read-only caller', () => {
	it.each([...ALL, ...INSTRUCTORS])('is refused by %s before any read', async (_name, call) => {
		await expect(call()).rejects.toThrow('403');
		for (const read of [
			listStaffUsers,
			listAllStaffUsers,
			listInstructorRoster,
			listAllInstructors
		])
			expect(read).not.toHaveBeenCalled();
	});
});

describe('each view admits its own capability', () => {
	it.each(ALL)('%s needs user.list', async (_name, call) => {
		held = new Set(['user.list']);
		await expect(call()).resolves.toBeDefined();
	});

	it.each(INSTRUCTORS)('%s needs instructor.read', async (_name, call) => {
		held = new Set(['instructor.read']);
		await expect(call()).resolves.toBeDefined();
	});
});
