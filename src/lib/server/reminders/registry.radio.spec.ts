import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Radio attestation reminders (#1516): two stages before a release's yearly
 * attestation lapses. Pinned: the windows, and that the subject carries the
 * attestation's time, so a renewed attestation is reminded again next year.
 */

const listRadioAttestationsExpiringBetween = vi.fn(
	async (_from: Date, _to: Date) => [] as unknown[]
);

vi.mock('$lib/server/audio/radio-attestation', () => ({ listRadioAttestationsExpiringBetween }));
vi.mock('$lib/server/inventory/loan-service', () => ({
	listLoansDueBetween: vi.fn(async () => [])
}));
vi.mock('$lib/server/volunteer/volunteer-signup-service', () => ({
	listSignupsStartingBetween: vi.fn(async () => []),
	listCompletionsAwaitingFeedback: vi.fn(async () => [])
}));
vi.mock('$lib/server/db', () => ({ db: {} }));

const { reminders } = await import('./registry');

const NOW = new Date('2026-06-15T12:00:00Z');
const DAY = 86_400_000;
const byKey = (key: string) => reminders.find((r) => r.key === key)!;

const release = {
	releaseId: 'rel-1',
	releaseTitle: 'Night Swim',
	bandName: 'The Tidepools',
	bandSlug: 'tidepools',
	attestedAt: new Date('2025-06-20T18:00:00Z'),
	expiresAt: new Date('2026-06-20T18:00:00Z'),
	bandAdmins: [{ userId: 'u1', userName: 'Ada', userEmail: 'ada@example.com' }]
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe('radio attestation reminders', () => {
	it('registers a thirty-day and a seven-day stage', () => {
		const keys = reminders.filter((r) => r.subjectType === 'radio_attestation').map((r) => r.key);
		expect(keys).toEqual(['radio_attestation_30d', 'radio_attestation_7d']);
	});

	it('asks for attestations lapsing eight to thirty days out at the first stage', async () => {
		await byKey('radio_attestation_30d').due(NOW);
		expect(listRadioAttestationsExpiringBetween).toHaveBeenCalledWith(
			new Date(NOW.getTime() + 8 * DAY),
			new Date(NOW.getTime() + 30 * DAY)
		);
	});

	it('asks for attestations lapsing within seven days at the last stage', async () => {
		await byKey('radio_attestation_7d').due(NOW);
		expect(listRadioAttestationsExpiringBetween).toHaveBeenCalledWith(
			NOW,
			new Date(NOW.getTime() + 7 * DAY)
		);
	});

	it('keys the subject by release and attestation, and carries the band admins', async () => {
		listRadioAttestationsExpiringBetween.mockResolvedValueOnce([release]);

		const due = await byKey('radio_attestation_7d').due(NOW);

		expect(due).toEqual([
			{
				subjectId: `rel-1:${release.attestedAt.toISOString()}`,
				payload: {
					stage: '7d',
					releaseId: 'rel-1',
					releaseTitle: 'Night Swim',
					bandName: 'The Tidepools',
					bandSlug: 'tidepools',
					expiresOn: '2026-06-20',
					bandAdmins: release.bandAdmins
				}
			}
		]);
	});
});
