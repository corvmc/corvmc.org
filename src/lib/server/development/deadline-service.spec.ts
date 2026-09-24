import { describe, it, expect, vi, beforeEach } from 'vitest';

const listGrantDeadlinesBetween = vi.fn(async (_from: string, _to: string) => [] as unknown[]);
const listSponsorshipDeadlinesBetween = vi.fn(
	async (_from: string, _to: string) => [] as unknown[]
);
vi.mock('$lib/server/grant/grant-service', () => ({ listGrantDeadlinesBetween }));
vi.mock('$lib/server/sponsor/sponsor-service', () => ({ listSponsorshipDeadlinesBetween }));

const { listDevelopmentDeadlinesBetween } = await import('./deadline-service');

const report = {
	kind: 'report',
	on: '2026-10-09',
	subjectId: 'report:r1',
	title: 'Interim report',
	parentId: 'g1',
	parentTitle: 'Operating support',
	counterparty: 'Oregon Arts Commission'
};
const term = {
	kind: 'end',
	on: '2026-10-01',
	subjectId: 'sponsorship:p1',
	title: 'Sponsorship ends',
	parentId: 's1',
	parentTitle: 'Season sponsor',
	counterparty: 'Troubadour Music'
};

beforeEach(() => {
	vi.clearAllMocks();
	listGrantDeadlinesBetween.mockResolvedValue([report]);
	listSponsorshipDeadlinesBetween.mockResolvedValue([term]);
});

describe('listDevelopmentDeadlinesBetween', () => {
	it('tags each deadline with its module, soonest first', async () => {
		const items = await listDevelopmentDeadlinesBetween('2026-09-24', '2026-10-24', {
			grants: true,
			sponsors: true
		});
		expect(items.map((d) => [d.module, d.parentId, d.on])).toEqual([
			['sponsor', 's1', '2026-10-01'],
			['grant', 'g1', '2026-10-09']
		]);
	});

	it('does not read a module the caller may not see', async () => {
		const items = await listDevelopmentDeadlinesBetween('2026-09-24', '2026-10-24', {
			grants: false,
			sponsors: true
		});
		expect(listGrantDeadlinesBetween).not.toHaveBeenCalled();
		expect(items.map((d) => d.module)).toEqual(['sponsor']);
	});
});
