import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Renewal reminders (#1478): two stages before a permit, licence or policy
 * expires. Pinned: the day ranges, and that the subject carries the expiry
 * date, so renewing (moving the date forward) is reminded again next time.
 */

const listRenewalsExpiringBetween = vi.fn(async (_from: string, _to: string) => [] as unknown[]);

vi.mock('$lib/server/renewal/renewal-service', () => ({ listRenewalsExpiringBetween }));
vi.mock('$lib/server/inventory/loan-service', () => ({
	listLoansDueBetween: vi.fn(async () => [])
}));
vi.mock('$lib/server/volunteer/volunteer-signup-service', () => ({
	listSignupsStartingBetween: vi.fn(async () => []),
	listCompletionsAwaitingFeedback: vi.fn(async () => [])
}));
vi.mock('$lib/server/db', () => ({ db: {} }));

const { reminders } = await import('./registry');

// Noon UTC is 05:00 in Corvallis, still 15 June there.
const NOW = new Date('2026-06-15T12:00:00Z');
const byKey = (key: string) => reminders.find((r) => r.key === key)!;

const policy = {
	id: 'r1',
	name: 'General liability',
	kind: 'insurance',
	issuer: 'Acme Mutual',
	reference: 'GL-123',
	expiresOn: '2026-06-20',
	responsibleUserId: 'u1',
	responsibleName: 'Ada',
	responsibleEmail: 'ada@example.com'
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe('renewal reminders', () => {
	it('registers a sixty-day and a fourteen-day stage', () => {
		const keys = reminders.filter((r) => r.subjectType === 'renewal').map((r) => r.key);
		expect(keys).toEqual(['renewal_expiry_60d', 'renewal_expiry_14d']);
	});

	it('asks for renewals fifteen to sixty days out at the first stage', async () => {
		await byKey('renewal_expiry_60d').due(NOW);
		expect(listRenewalsExpiringBetween).toHaveBeenCalledWith('2026-06-30', '2026-08-14');
	});

	it('asks for renewals today to fourteen days out at the last stage', async () => {
		await byKey('renewal_expiry_14d').due(NOW);
		expect(listRenewalsExpiringBetween).toHaveBeenCalledWith('2026-06-15', '2026-06-29');
	});

	it('says nobody is responsible when no staffer is named', async () => {
		listRenewalsExpiringBetween.mockResolvedValueOnce([
			{ ...policy, responsibleUserId: null, responsibleName: null, responsibleEmail: null }
		]);
		const [item] = await byKey('renewal_expiry_60d').due(NOW);
		expect(item.payload).toMatchObject({ stage: '60d', responsible: null });
	});

	it('keys the subject by renewal and expiry date, and carries who is responsible', async () => {
		listRenewalsExpiringBetween.mockResolvedValueOnce([policy]);

		const due = await byKey('renewal_expiry_14d').due(NOW);

		expect(due).toEqual([
			{
				subjectId: 'r1:2026-06-20',
				payload: {
					stage: '14d',
					renewalId: 'r1',
					name: 'General liability',
					kind: 'insurance',
					issuer: 'Acme Mutual',
					reference: 'GL-123',
					expiresOn: '2026-06-20',
					responsible: { id: 'u1', name: 'Ada', email: 'ada@example.com' }
				}
			}
		]);
	});
});
