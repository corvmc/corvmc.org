import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let selectResultQueue: unknown[][] = [];
let insertedValues: unknown[] = [];

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(selectResultQueue.shift() ?? []);
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('./volunteer-certification-service', () => ({
	getRequirementsForRoles: vi.fn()
}));

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chainable()),
		insert: vi.fn(() => ({
			values: vi.fn((v: unknown) => {
				insertedValues.push(v);
				return { returning: vi.fn(() => Promise.resolve([v])) };
			})
		})),
		update: vi.fn(() => chainable()),
		delete: vi.fn(() => chainable())
	}
}));

import { getRequirementsForRoles } from './volunteer-certification-service';
import {
	auditClearances,
	wasHeldOn,
	certificationState,
	grantCertification,
	missingRequirements,
	missingFrom,
	listHeldForGateMany
} from './member-certification-service';
import { CERT_EXPIRY_WARNING_DAYS, DEFAULT_TIMEZONE } from '$lib/config';
import { buildDateInTz } from '$lib/server/reservation/timezone';

const noon = (d: string) => buildDateInTz(d, '12:00', DEFAULT_TIMEZONE);

beforeEach(() => {
	vi.clearAllMocks();
	selectResultQueue = [];
	insertedValues = [];
});

describe('wasHeldOn', () => {
	const worked = noon('2026-06-15');

	it('is false before the grant date', () => {
		expect(
			wasHeldOn({ grantedAt: noon('2026-06-16'), expiresAt: null, revokedAt: null }, worked)
		).toBe(false);
	});

	it('is true on the grant date itself', () => {
		expect(
			wasHeldOn({ grantedAt: noon('2026-06-15'), expiresAt: null, revokedAt: null }, worked)
		).toBe(true);
	});

	// The two rules below are asymmetric on purpose and easy to get backwards.

	it('a card is valid THROUGH its expiry date', () => {
		expect(
			wasHeldOn(
				{ grantedAt: noon('2026-01-01'), expiresAt: noon('2026-06-15'), revokedAt: null },
				worked
			)
		).toBe(true);
	});

	it('a card is not valid the day after it expires', () => {
		expect(
			wasHeldOn(
				{ grantedAt: noon('2026-01-01'), expiresAt: noon('2026-06-14'), revokedAt: null },
				worked
			)
		).toBe(false);
	});

	it('a clearance pulled ON the day was NOT in force that day', () => {
		expect(
			wasHeldOn(
				{ grantedAt: noon('2026-01-01'), expiresAt: null, revokedAt: noon('2026-06-15') },
				worked
			)
		).toBe(false);
	});

	it('a clearance pulled the day after was in force', () => {
		expect(
			wasHeldOn(
				{ grantedAt: noon('2026-01-01'), expiresAt: null, revokedAt: noon('2026-06-16') },
				worked
			)
		).toBe(true);
	});

	it('never expires when expiresAt is null', () => {
		expect(
			wasHeldOn({ grantedAt: noon('2020-01-01'), expiresAt: null, revokedAt: null }, worked)
		).toBe(true);
	});
});

describe('certificationState', () => {
	const today = noon('2026-06-15');

	it('reads revoked before anything else', () => {
		expect(
			certificationState(
				{ grantedAt: noon('2026-01-01'), expiresAt: noon('2020-01-01'), revokedAt: today },
				today
			)
		).toBe('revoked');
	});

	it('reads expired when past expiry', () => {
		expect(
			certificationState(
				{ grantedAt: noon('2026-01-01'), expiresAt: noon('2026-06-14'), revokedAt: null },
				today
			)
		).toBe('expired');
	});

	it('reads expiring inside the warning window', () => {
		const soon = new Date(today.getTime() + (CERT_EXPIRY_WARNING_DAYS - 1) * 86_400_000);
		expect(
			certificationState({ grantedAt: noon('2026-01-01'), expiresAt: soon, revokedAt: null }, today)
		).toBe('expiring');
	});

	it('reads current outside the warning window', () => {
		const later = new Date(today.getTime() + (CERT_EXPIRY_WARNING_DAYS + 1) * 86_400_000);
		expect(
			certificationState(
				{ grantedAt: noon('2026-01-01'), expiresAt: later, revokedAt: null },
				today
			)
		).toBe('current');
	});

	it('reads current when it never expires', () => {
		expect(
			certificationState({ grantedAt: noon('2020-01-01'), expiresAt: null, revokedAt: null }, today)
		).toBe('current');
	});
});

describe('grantCertification', () => {
	it('stamps expiresAt from the catalog rather than leaving it to be computed later', async () => {
		selectResultQueue = [[{ validityMonths: 36 }]];

		await grantCertification({
			userId: 'u1',
			certificationId: 'c1',
			grantedOn: '2026-06-15',
			grantedByUserId: 'staff'
		});

		const row = insertedValues[0] as { expiresAt: Date | null };
		expect(row.expiresAt).toEqual(noon('2029-06-15'));
	});

	// Date.UTC overflows a short month: (2026, 1, 31) is February 31, which rolls
	// into March 3 and hands out three days of clearance the catalog never
	// promised — always in the permissive direction, so a shift gets worked on a
	// card that should have lapsed.
	it('clamps to the end of a short target month rather than overflowing', async () => {
		selectResultQueue = [[{ validityMonths: 6 }]];

		await grantCertification({
			userId: 'u1',
			certificationId: 'c1',
			grantedOn: '2024-08-31',
			grantedByUserId: 'staff'
		});

		expect((insertedValues[0] as { expiresAt: Date }).expiresAt).toEqual(noon('2025-02-28'));
	});

	it('keeps the same day when the target month is long enough', async () => {
		selectResultQueue = [[{ validityMonths: 12 }]];

		await grantCertification({
			userId: 'u1',
			certificationId: 'c1',
			grantedOn: '2024-08-31',
			grantedByUserId: 'staff'
		});

		expect((insertedValues[0] as { expiresAt: Date }).expiresAt).toEqual(noon('2025-08-31'));
	});

	it('leaves expiresAt null for a certification that never lapses', async () => {
		selectResultQueue = [[{ validityMonths: null }]];

		await grantCertification({
			userId: 'u1',
			certificationId: 'c1',
			grantedOn: '2026-06-15',
			grantedByUserId: 'staff'
		});

		expect((insertedValues[0] as { expiresAt: Date | null }).expiresAt).toBeNull();
	});

	// A renewal is a second grant, not an edit — the old row keeps its dates so
	// "were they cleared last March" still has an answer.
	it('inserts rather than updating, so renewals append', async () => {
		selectResultQueue = [[{ validityMonths: 12 }]];

		await grantCertification({
			userId: 'u1',
			certificationId: 'c1',
			grantedOn: '2026-06-15',
			grantedByUserId: 'staff'
		});

		const { db } = await import('$lib/server/db');
		expect(vi.mocked(db.insert)).toHaveBeenCalled();
		expect(vi.mocked(db.update)).not.toHaveBeenCalled();
	});
});

describe('missingRequirements', () => {
	it('is empty when the role requires nothing', async () => {
		selectResultQueue = [[]];
		expect(await missingRequirements('u1', 'role-1')).toEqual([]);
	});

	it('lists only the requirements the member does not currently hold', async () => {
		selectResultQueue = [
			[
				{ id: 'cert-a', name: 'Sound Desk Cleared' },
				{ id: 'cert-b', name: 'First Aid' }
			],
			[{ id: 'cert-a' }]
		];

		expect(await missingRequirements('u1', 'role-1')).toEqual([
			{ id: 'cert-b', name: 'First Aid' }
		]);
	});
});

// The batched half of the gate, used by the member shift board so a page of
// shifts costs two queries instead of two per shift.
describe('missingFrom', () => {
	const required = [
		{ id: 'cert-a', name: 'Sound Desk Cleared' },
		{ id: 'cert-b', name: 'First Aid' }
	];

	it('returns what the member did not hold on the given date', () => {
		const held = [
			{ certificationId: 'cert-a', grantedAt: noon('2026-01-01'), expiresAt: null, revokedAt: null }
		];

		expect(missingFrom(required, held, noon('2026-06-15'))).toEqual([
			{ id: 'cert-b', name: 'First Aid' }
		]);
	});

	// The reason the rows are passed in rather than a resolved set: the same
	// holdings answer differently for two shifts on different dates.
	it('answers differently for two dates against the same holdings', () => {
		const held = [
			{
				certificationId: 'cert-a',
				grantedAt: noon('2026-01-01'),
				expiresAt: noon('2026-06-30'),
				revokedAt: null
			},
			{ certificationId: 'cert-b', grantedAt: noon('2026-01-01'), expiresAt: null, revokedAt: null }
		];

		expect(missingFrom(required, held, noon('2026-06-15'))).toEqual([]);
		expect(missingFrom(required, held, noon('2026-07-15'))).toEqual([
			{ id: 'cert-a', name: 'Sound Desk Cleared' }
		]);
	});

	it('is empty when the role requires nothing', () => {
		expect(missingFrom([], [], noon('2026-06-15'))).toEqual([]);
	});
});

describe('listHeldForGateMany', () => {
	const row = (userId: string, certificationId: string) => ({
		userId,
		certificationId,
		grantedAt: noon('2026-01-01'),
		expiresAt: null,
		revokedAt: null
	});

	it('groups rows by member', async () => {
		selectResultQueue = [[row('u1', 'c1'), row('u2', 'c2'), row('u1', 'c3')]];

		const held = await listHeldForGateMany(['u1', 'u2']);

		expect(held.get('u1')?.map((h) => h.certificationId)).toEqual(['c1', 'c3']);
		expect(held.get('u2')?.map((h) => h.certificationId)).toEqual(['c2']);
	});

	// Absent rather than present-and-empty, so callers read it with `?? []` and a
	// member with nothing granted can't be mistaken for one who holds an empty set.
	it('omits a member with no rows', async () => {
		selectResultQueue = [[row('u1', 'c1')]];

		const held = await listHeldForGateMany(['u1', 'u2']);

		expect(held.has('u2')).toBe(false);
		expect(held.get('u2') ?? []).toEqual([]);
	});

	it('does not query at all for an empty list', async () => {
		const { db } = await import('$lib/server/db');

		const held = await listHeldForGateMany([]);

		expect(held.size).toBe(0);
		expect(vi.mocked(db.select)).not.toHaveBeenCalled();
	});

	// D1 caps a statement at 100 bound parameters, so a list longer than the chunk
	// has to arrive as several queries rather than one oversized IN.
	it('chunks a list past the parameter ceiling', async () => {
		const { db } = await import('$lib/server/db');
		const ids = Array.from({ length: 200 }, (_, i) => `u${i}`);
		selectResultQueue = [[], [], []];

		await listHeldForGateMany(ids);

		expect(vi.mocked(db.select).mock.calls.length).toBeGreaterThan(1);
	});

	it('deduplicates ids before querying', async () => {
		selectResultQueue = [[row('u1', 'c1')]];

		const held = await listHeldForGateMany(['u1', 'u1', 'u1']);

		expect(held.get('u1')).toHaveLength(1);
	});
});

describe('auditClearances', () => {
	const CARD = { id: 'cert-1', name: 'Sound Desk Cleared' };

	function heldRow(over: Record<string, unknown> = {}) {
		return {
			certificationId: 'cert-1',
			grantedAt: new Date('2026-01-01'),
			expiresAt: null,
			revokedAt: null,
			...over
		};
	}

	beforeEach(() => {
		vi.mocked(getRequirementsForRoles).mockResolvedValue(new Map([['role-1', [CARD]]]));
	});

	/**
	 * The hole this closes. `claimShift` checks clearance as of the *shift's*
	 * date, so somebody can commit while current, have the card lapse, and work
	 * uncleared — and review re-checked nothing, so the hours were approved and
	 * the record showed a cleared volunteer.
	 */
	it('flags a card that lapsed between claiming and working', async () => {
		selectResultQueue = [[{ userId: 'u1', ...heldRow({ expiresAt: new Date('2026-03-01') }) }]];

		const gaps = await auditClearances([
			{ id: 'log-1', userId: 'u1', volunteerRoleId: 'role-1', workedOn: new Date('2026-04-10') }
		]);

		expect(gaps.get('log-1')).toEqual([CARD]);
	});

	it('says nothing when the card was still in force on the day worked', async () => {
		selectResultQueue = [[{ userId: 'u1', ...heldRow({ expiresAt: new Date('2026-12-01') }) }]];

		const gaps = await auditClearances([
			{ id: 'log-1', userId: 'u1', volunteerRoleId: 'role-1', workedOn: new Date('2026-04-10') }
		]);

		expect(gaps.has('log-1')).toBe(false);
	});

	it('says nothing when the role requires no clearance at all', async () => {
		vi.mocked(getRequirementsForRoles).mockResolvedValue(new Map());
		selectResultQueue = [[]];

		const gaps = await auditClearances([
			{ id: 'log-1', userId: 'u1', volunteerRoleId: 'role-9', workedOn: new Date('2026-04-10') }
		]);

		expect(gaps.size).toBe(0);
	});

	it('does not query at all for an empty list', async () => {
		const gaps = await auditClearances([]);

		expect(gaps.size).toBe(0);
		expect(getRequirementsForRoles).not.toHaveBeenCalled();
	});
});
