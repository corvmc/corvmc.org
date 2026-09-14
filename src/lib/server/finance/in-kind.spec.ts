import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The two in-kind writers: a contributed service and a gift in kind.
 *
 * Both are `in_kind`, which is never summed with `earned` — so what matters
 * here is which events produce an entry at all, and that a re-valuation adds
 * the difference rather than restating history.
 */

const recordEntry = vi.fn(async () => undefined);
vi.mock('./financial-entry-service', () => ({
	recordEntry: (...a: unknown[]) => recordEntry(...(a as [])),
	recordEntries: vi.fn()
}));

let hourLog: Record<string, unknown> | null = null;
vi.mock('$lib/server/volunteer/hour-log-service', () => ({
	getHourLog: async () => hourLog
}));

let role: Record<string, unknown> | null = null;
vi.mock('$lib/server/volunteer/volunteer-role-service', () => ({
	getActiveVolunteerRoleById: async () => role
}));

const { handleApprovedHours } = await import('./in-kind-listener');
const { syncAcquisitionInKind } = await import('./in-kind-acquisition');

beforeEach(() => {
	vi.clearAllMocks();
	hourLog = {
		id: 'log-1',
		userId: 'user-1',
		volunteerRoleId: 'role-1',
		roleName: 'Audio engineer',
		minutes: 150,
		workedOn: new Date('2026-09-01')
	};
	role = { id: 'role-1', isSpecializedSkill: true, marketRateCents: 4000 };
});

describe('contributed services', () => {
	it('values a specialized hour at the role market rate', async () => {
		await handleApprovedHours('log-1');

		expect(recordEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: 'in_kind',
				category: 'donation',
				subjectType: 'volunteer_hour',
				subjectId: 'log-1',
				// 2.5 h at $40
				amountCents: 10_000,
				// When the work happened, not when it was reviewed.
				occurredAt: new Date('2026-09-01')
			})
		);
	});

	/**
	 * The line this whole split exists to draw. A door shift has an impact value
	 * at the Independent Sector rate and is not a recognizable contributed
	 * service; writing one here would inflate the collective's reported revenue.
	 */
	it('writes nothing for an unspecialized role', async () => {
		role = { id: 'role-1', isSpecializedSkill: false, marketRateCents: 4000 };

		await handleApprovedHours('log-1');

		expect(recordEntry).not.toHaveBeenCalled();
	});

	// Priced-but-unpriced contributes zero and must never fall back to the
	// impact rate — the schema is explicit about it.
	it('writes nothing for a specialized role with no rate', async () => {
		role = { id: 'role-1', isSpecializedSkill: true, marketRateCents: null };

		await handleApprovedHours('log-1');

		expect(recordEntry).not.toHaveBeenCalled();
	});
});

describe('gifts in kind', () => {
	const base = {
		acquisitionId: 'acq-1',
		description: 'Gift in kind',
		occurredAt: new Date('2026-09-13')
	};

	it('records the value of a gift valued at entry', async () => {
		await syncAcquisitionInKind({
			...base,
			before: null,
			after: { kind: 'donation', fairValueCents: 8240 }
		});

		expect(recordEntry).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'in_kind', amountCents: 8240, subjectType: 'acquisition' })
		);
	});

	it('writes nothing for a receipt recorded before anyone prices it', async () => {
		await syncAcquisitionInKind({
			...base,
			before: null,
			after: { kind: 'donation', fairValueCents: null }
		});

		expect(recordEntry).not.toHaveBeenCalled();
	});

	/**
	 * The append-only rule. A gift valued in September and corrected in January
	 * must not restate September, so the correction is the difference.
	 */
	it('adds the difference when a gift is re-valued', async () => {
		await syncAcquisitionInKind({
			...base,
			before: { kind: 'donation', fairValueCents: 8240 },
			after: { kind: 'donation', fairValueCents: 9000 }
		});

		expect(recordEntry).toHaveBeenCalledWith(expect.objectContaining({ amountCents: 760 }));
	});

	it('reverses the whole value when it turns out to have been bought', async () => {
		await syncAcquisitionInKind({
			...base,
			before: { kind: 'donation', fairValueCents: 8240 },
			after: { kind: 'purchase', fairValueCents: 8240 }
		});

		expect(recordEntry).toHaveBeenCalledWith(expect.objectContaining({ amountCents: -8240 }));
	});

	it('writes nothing when neither the kind nor the value moved', async () => {
		await syncAcquisitionInKind({
			...base,
			before: { kind: 'donation', fairValueCents: 8240 },
			after: { kind: 'donation', fairValueCents: 8240 }
		});

		expect(recordEntry).not.toHaveBeenCalled();
	});

	it('never writes for a purchase', async () => {
		await syncAcquisitionInKind({
			...base,
			before: null,
			after: { kind: 'purchase', fairValueCents: 5000 }
		});

		expect(recordEntry).not.toHaveBeenCalled();
	});
});
