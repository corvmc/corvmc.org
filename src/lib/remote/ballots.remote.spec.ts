import { describe, it, expect, vi, beforeEach } from 'vitest';

// Each export is only as guarded as its own first lines. These pin who may do
// what, and that a refused caller never reaches the service.

const ME = { id: 'usr-me', name: 'Me', email: 'me@example.com' };
let held = new Set<string>();
vi.mock('$lib/server/authorization', () => ({
	requireUser: () => ME,
	can: async (cap: string) => held.has(cap),
	requireCapability: async (cap: string) => {
		if (!held.has(cap)) throw Object.assign(new Error(`403: ${cap}`), { status: 403 });
		return ME;
	}
}));

let adminOf = new Set<string>();
const requireGroupRole = vi.fn(async (ref: { id: string }, _min: string) => {
	if (!adminOf.has(ref.id)) throw Object.assign(new Error('403 group'), { status: 403 });
	return { user: ME, group: { id: ref.id }, role: 'admin' };
});
vi.mock('$lib/server/group/group-context', () => ({
	requireGroupRole: (ref: { id: string }, min: string) => requireGroupRole(ref, min)
}));

let ballot: Record<string, unknown> = {};
let electorIds = new Set<string>();
const svc = {
	getBallotDetail: vi.fn(async () => ballot),
	ballotStatusOf: vi.fn(() => ballot.__status),
	isElector: vi.fn(async (_b: string, u: string) => electorIds.has(u)),
	getMyVote: vi.fn(async () => ({ voted: false, optionId: null })),
	getTurnout: vi.fn(async () => ({ voted: 0, electorateSize: 0 })),
	getTally: vi.fn(async () => ({ options: [], turnout: 0, electorateSize: 0, rollCall: null })),
	previewElectorateSize: vi.fn(async () => 0),
	listOverrides: vi.fn(async () => []),
	listCommitteeRosters: vi.fn(async () => []),
	listBallotsForMember: vi.fn(async () => []),
	listAllBallots: vi.fn(async () => []),
	createBallot: vi.fn(async () => 'bal-new'),
	updateDraft: vi.fn(async () => undefined),
	setCertifier: vi.fn(async () => undefined),
	openBallot: vi.fn(async () => undefined),
	cancelBallot: vi.fn(async () => undefined),
	castVote: vi.fn(async () => undefined),
	certifyBallot: vi.fn(async () => undefined),
	setElectorOverride: vi.fn(async () => undefined)
};
vi.mock('$lib/server/ballot/ballot-service', () => svc);

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: ME } }),
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => Promise<unknown>;
		const wrapped = (...a: unknown[]) => {
			const p = handler(...a) as Promise<unknown> & { refresh?: () => Promise<void> };
			p.refresh = async () => undefined;
			return p;
		};
		(wrapped as unknown as Record<string, unknown>).__ = { type: 'query' };
		return wrapped;
	},
	form: (_schema: unknown, handler: (data: unknown) => unknown) => {
		const wrapped = (data: unknown) => handler(data);
		(wrapped as unknown as Record<string, unknown>).for = () => wrapped;
		(wrapped as unknown as Record<string, unknown>).__ = { type: 'form' };
		return wrapped;
	},
	command: (h: unknown) => h
}));

const remote = (await import('./ballots.remote')) as unknown as Record<
	string,
	(arg?: unknown) => Promise<unknown>
>;

const COMMITTEE = 'grp-committee';
const NEW_BALLOT = {
	title: 'Adopt the bylaws',
	description: '',
	options: 'Yes\nNo',
	closesOn: '2099-01-01',
	certifierId: 'usr-cert'
};

function aBallot(kind: 'member' | 'group', status: string, extra: Record<string, unknown> = {}) {
	ballot = {
		id: 'bal-1',
		kind,
		groupId: kind === 'group' ? COMMITTEE : null,
		certifierId: 'usr-cert',
		title: 'Q',
		options: [],
		group: null,
		certifier: null,
		__status: status,
		...extra
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	held = new Set();
	adminOf = new Set();
	electorIds = new Set();
});

describe('creating', () => {
	it('refuses a member-wide ballot without ballot.manage', async () => {
		await expect(remote.createBallot({ kind: 'member', ...NEW_BALLOT })).rejects.toThrow();
		expect(svc.createBallot).not.toHaveBeenCalled();
	});

	it('creates a member-wide ballot with ballot.manage', async () => {
		held.add('ballot.manage');
		await remote.createBallot({ kind: 'member', ...NEW_BALLOT });
		expect(svc.createBallot).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'member', options: ['Yes', 'No'] }),
			{ actorId: ME.id }
		);
	});

	it('lets a committee admin create a ballot for their committee', async () => {
		adminOf.add(COMMITTEE);
		await remote.createBallot({ kind: 'group', groupId: COMMITTEE, ...NEW_BALLOT });
		expect(requireGroupRole).toHaveBeenCalledWith({ id: COMMITTEE }, 'admin');
		expect(svc.createBallot).toHaveBeenCalled();
	});

	it('refuses a committee ballot to someone who does not run it', async () => {
		await expect(
			remote.createBallot({ kind: 'group', groupId: COMMITTEE, ...NEW_BALLOT })
		).rejects.toThrow();
		expect(svc.createBallot).not.toHaveBeenCalled();
	});
});

describe('managing', () => {
	it('opens a member-wide ballot only with ballot.manage', async () => {
		aBallot('member', 'draft');
		adminOf.add(COMMITTEE);
		await expect(remote.openBallotForm({ ballotId: 'bal-1' })).rejects.toThrow();
		expect(svc.openBallot).not.toHaveBeenCalled();
	});

	it('lets the committee admin open their committee ballot', async () => {
		aBallot('group', 'draft');
		adminOf.add(COMMITTEE);
		await remote.openBallotForm({ ballotId: 'bal-1' });
		expect(svc.openBallot).toHaveBeenCalledWith('bal-1');
	});

	it('keeps electorate overrides to ballot.manage, even for a committee admin', async () => {
		aBallot('member', 'draft');
		adminOf.add(COMMITTEE);
		await expect(
			remote.setElectorOverrideForm({
				ballotId: 'bal-1',
				userId: 'usr-x',
				include: 'include',
				reason: 'r'
			})
		).rejects.toThrow();
		expect(svc.setElectorOverride).not.toHaveBeenCalled();
	});
});

describe('reading a ballot', () => {
	it('hides a draft from anyone who cannot manage it', async () => {
		aBallot('member', 'draft');
		await expect(remote.getBallotPage('bal-1')).rejects.toMatchObject({ status: 404 });
	});

	it('hides an open member-wide ballot from someone not on the roll', async () => {
		aBallot('member', 'open');
		await expect(remote.getBallotPage('bal-1')).rejects.toMatchObject({ status: 404 });
	});

	it('shows an elector the open ballot without a tally', async () => {
		aBallot('member', 'open');
		electorIds.add(ME.id);
		const page = (await remote.getBallotPage('bal-1')) as { tally: unknown };
		expect(page.tally).toBeNull();
		expect(svc.getTally).not.toHaveBeenCalled();
	});

	it('shows every member a certified result', async () => {
		aBallot('member', 'certified');
		const page = (await remote.getBallotPage('bal-1')) as { tally: unknown };
		expect(page.tally).not.toBeNull();
	});
});

describe('voting and certifying act as the signed-in member only', () => {
	it('casts the vote for the session user', async () => {
		await remote.castBallotVote({ ballotId: 'bal-1', optionId: 'opt-1' });
		expect(svc.castVote).toHaveBeenCalledWith('bal-1', ME.id, 'opt-1');
	});

	it('certifies as the session user', async () => {
		await remote.certifyBallotForm({ ballotId: 'bal-1' });
		expect(svc.certifyBallot).toHaveBeenCalledWith('bal-1', ME.id);
	});
});
