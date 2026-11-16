import { describe, it, expect, vi, beforeEach } from 'vitest';

// Who sees which dashboard rows (#3128). Invites, enquiries, drafts, setup and
// the press kit are an owner's or admin's; a staff viewer is not asked to pay.

const hoisted = vi.hoisted(() => ({
	role: 'owner' as string,
	reservations: [] as unknown[],
	events: [] as unknown[]
}));

const later = new Date(Date.now() + 3 * 86_400_000);
const unpaid = {
	id: 'r1',
	status: 'confirmed',
	startsAt: later,
	endsAt: new Date(later.getTime() + 7_200_000),
	bookerType: 'group',
	paidAt: null,
	refundedAt: null,
	cashDueCents: 3000
};

vi.mock('$app/server', () => ({
	query: (_schema: unknown, handler: (...args: unknown[]) => unknown) =>
		Object.assign(handler, { __: { type: 'query' } }),
	getRequestEvent: () => ({ locals: {} })
}));

vi.mock('#lib/server/group/group-context.js', () => ({
	requireGroupRole: vi.fn(async () => ({
		user: { id: 'u1' },
		group: { id: 'band-1', slug: 'saltmarsh' },
		role: hoisted.role
	}))
}));

// Each `db.select()` chain resolves to the next queued result: reservations, then "any".
let selects: unknown[][] = [];
vi.mock('#lib/server/db/index.js', () => {
	const chain = (): unknown =>
		new Proxy(() => {}, {
			get: (_t, prop) =>
				prop === 'then'
					? (resolve: (v: unknown) => void) => resolve(selects.shift() ?? [])
					: () => chain()
		});
	return { db: { select: () => chain() } };
});

const getMembers = vi.fn(async () => [
	{ status: 'active', member: { title: 'Ada' } },
	{ status: 'pending', member: { title: 'Sam' } }
]);
vi.mock('#lib/server/band/band-service.js', async () => {
	const real = await vi.importActual<typeof import('#lib/server/band/band-service.js')>(
		'#lib/server/band/band-service.js'
	);
	return { getMembers, partitionByStatus: real.partitionByStatus };
});
const listEmailInvites = vi.fn(async () => [{ email: 'kit@example.com', status: 'pending' }]);
vi.mock('#lib/server/group/group-invite-service.js', () => ({ listForGroup: listEmailInvites }));
vi.mock('#lib/server/event/event-service.js', () => ({
	listBandEvents: vi.fn(async () => hoisted.events)
}));
const countGroupInboxUnread = vi.fn(async () => ({ chat: 0, enquiries: 2 }));
vi.mock('#lib/server/inbox/unified-service.js', () => ({ countGroupInboxUnread }));
const getPressKitProgress = vi.fn(async () => ({
	sections: [
		{ key: 'identity', done: true },
		{ key: 'bio', done: true }
	],
	done: 2,
	total: 11,
	next: { key: 'tagline' }
}));
vi.mock('./press-kit.remote', () => ({ getPressKitProgress }));

const { getBandDashboard } = (await import('./band-dashboard.remote')) as unknown as {
	getBandDashboard: (bandId: string) => Promise<{
		canManage: boolean;
		todos: { kind: string }[];
		setup: unknown[] | null;
		pressKit: unknown;
	}>;
};

const kinds = (r: { todos: { kind: string }[] }) => r.todos.map((t) => t.kind).toSorted();

beforeEach(() => {
	vi.clearAllMocks();
	hoisted.events = [];
	selects = [[unpaid], [{ id: 'r1' }]];
});

describe('getBandDashboard', () => {
	it('gives an owner every kind of to-do', async () => {
		hoisted.role = 'owner';
		const result = await getBandDashboard('band-1');
		expect(kinds(result)).toEqual(['enquiries-unread', 'invites-pending', 'reservation-unpaid']);
	});

	it('gives a plain member only what any member can pay, and no owner reads', async () => {
		hoisted.role = 'member';
		const result = await getBandDashboard('band-1');

		expect(kinds(result)).toEqual(['reservation-unpaid']);
		expect(result.setup).toBeNull();
		expect(result.pressKit).toBeNull();
		for (const read of [getMembers, listEmailInvites, countGroupInboxUnread, getPressKitProgress]) {
			expect(read).not.toHaveBeenCalled();
		}
	});

	it('does not ask staff to pay', async () => {
		hoisted.role = 'staff';
		expect(kinds(await getBandDashboard('band-1'))).toEqual([]);
	});

	it('shows setup while a step is open, and the press kit once all are done', async () => {
		hoisted.role = 'owner';
		const open = await getBandDashboard('band-1');
		expect(open.setup).not.toBeNull();
		expect(open.pressKit).toBeNull();

		hoisted.events = [
			{ id: 'e1', title: 'Show', startsAt: later, endsAt: null, status: 'published', isOwner: true }
		];
		selects = [[unpaid], [{ id: 'r1' }]];
		const finished = await getBandDashboard('band-1');
		expect(finished.setup).toBeNull();
		expect(finished.pressKit).not.toBeNull();
	});
});
