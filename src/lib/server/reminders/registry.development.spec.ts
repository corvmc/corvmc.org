import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Development's deadline reminders (#1477): two stages, fourteen days and three
 * days ahead, over every grant and sponsorship deadline. Pinned: the day ranges,
 * and that a subject names the deadline and its date, so a moved deadline is
 * reminded again and a grant's next report is not swallowed by its first.
 */

const listGrantDeadlinesBetween = vi.fn(async (_from: string, _to: string) => [] as unknown[]);
const listSponsorshipDeadlinesBetween = vi.fn(
	async (_from: string, _to: string) => [] as unknown[]
);

vi.mock('$lib/server/grant/grant-service', () => ({ listGrantDeadlinesBetween }));
vi.mock('$lib/server/sponsor/sponsor-service', () => ({ listSponsorshipDeadlinesBetween }));
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

const report = {
	kind: 'report',
	on: '2026-06-25',
	subjectId: 'report:r1',
	title: 'Interim report',
	parentId: 'g1',
	parentTitle: '2027 operating support',
	counterparty: 'Oregon Arts Commission'
};
const term = {
	kind: 'end',
	on: '2026-06-17',
	subjectId: 'sponsorship:p1',
	title: 'Sponsorship ends',
	parentId: 's1',
	parentTitle: 'Season sponsor',
	counterparty: 'Troubadour Music'
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe('development deadline reminders', () => {
	it('registers a fourteen-day and a three-day stage', () => {
		const keys = reminders
			.filter((r) => r.subjectType === 'development_deadline')
			.map((r) => r.key);
		expect(keys).toEqual(['development_deadline_14d', 'development_deadline_3d']);
	});

	it('asks for deadlines four to fourteen days out at the first stage', async () => {
		await byKey('development_deadline_14d').due(NOW);
		expect(listGrantDeadlinesBetween).toHaveBeenCalledWith('2026-06-19', '2026-06-29');
		expect(listSponsorshipDeadlinesBetween).toHaveBeenCalledWith('2026-06-19', '2026-06-29');
	});

	it('asks for deadlines today to three days out at the last stage', async () => {
		await byKey('development_deadline_3d').due(NOW);
		expect(listGrantDeadlinesBetween).toHaveBeenCalledWith('2026-06-15', '2026-06-18');
	});

	it('keys each subject by module, deadline and date, and says which module it is', async () => {
		listGrantDeadlinesBetween.mockResolvedValueOnce([report]);
		listSponsorshipDeadlinesBetween.mockResolvedValueOnce([term]);

		const due = await byKey('development_deadline_3d').due(NOW);

		expect(due.map((d) => d.subjectId)).toEqual([
			'sponsor:sponsorship:p1:2026-06-17',
			'grant:report:r1:2026-06-25'
		]);
		expect(due[1].payload).toMatchObject({
			stage: '3d',
			module: 'grant',
			on: '2026-06-25',
			title: 'Interim report',
			parentId: 'g1',
			counterparty: 'Oregon Arts Commission'
		});
		expect(due[0].payload).toMatchObject({ module: 'sponsor', parentId: 's1' });
	});
});
