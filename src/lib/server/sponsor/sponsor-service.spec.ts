import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

// A chainable proxy that records calls and resolves to `selectResult`, so the
// assertions are about the query built rather than what a stub returns.
let selectResult: unknown[] = [];
let chainCalls: { method: string; args: unknown[] }[] = [];

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(selectResult);
			}
			return (...args: unknown[]) => {
				chainCalls.push({ method: String(prop), args });
				return proxy;
			};
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chainable()),
		insert: vi.fn(() => chainable()),
		update: vi.fn(() => chainable()),
		delete: vi.fn(() => chainable())
	}
}));

const {
	sponsorshipDeadline,
	summarizeSponsors,
	listSponsorshipDeadlinesBetween,
	getSponsor,
	listSponsors,
	archiveSponsor,
	restoreSponsor,
	deleteSponsor,
	SponsorNotFoundError,
	SponsorInUseError
} = await import('./sponsor-service');

const TODAY = '2026-09-23';

/** Every `where` the queries built, rendered to SQL text. */
function renderedWheres() {
	const dialect = new SQLiteSyncDialect();
	return chainCalls
		.filter((c) => c.method === 'where' && c.args[0])
		.map((c) => dialect.sqlToQuery(c.args[0] as SQL).sql);
}

function setColumns() {
	return chainCalls.find((c) => c.method === 'set')?.args[0] as Record<string, unknown>;
}

beforeEach(() => {
	selectResult = [];
	chainCalls = [];
});

describe('sponsorshipDeadline', () => {
	it('is the end of the term while active', () => {
		expect(sponsorshipDeadline({ status: 'active', endsOn: '2026-12-31' }, TODAY)).toEqual({
			kind: 'end',
			on: '2026-12-31',
			overdue: false
		});
	});

	it('reads a term that has run out as overdue until someone ends it', () => {
		expect(sponsorshipDeadline({ status: 'active', endsOn: '2026-09-01' }, TODAY)?.overdue).toBe(
			true
		);
	});

	it('has none for a pitch, a refusal or a finished term', () => {
		for (const status of ['prospect', 'declined', 'ended'] as const) {
			expect(sponsorshipDeadline({ status, endsOn: '2026-12-31' }, TODAY)).toBeNull();
		}
	});
});

describe('listSponsorshipDeadlinesBetween', () => {
	it("names each active term's end as its own subject, dated in the range", async () => {
		selectResult = [
			{
				id: 'p1',
				title: 'Season sponsor',
				endsOn: '2026-10-01',
				sponsorId: 's1',
				sponsorName: 'Troubadour Music'
			}
		];
		const items = await listSponsorshipDeadlinesBetween('2026-09-23', '2026-10-07');
		expect(items).toEqual([
			{
				kind: 'end',
				on: '2026-10-01',
				subjectId: 'sponsorship:p1',
				title: 'Sponsorship ends',
				parentId: 's1',
				parentTitle: 'Season sponsor',
				counterparty: 'Troubadour Music'
			}
		]);
		expect(chainCalls.some((c) => c.method === 'where')).toBe(true);
	});
});

describe('summarizeSponsors', () => {
	const sponsor = (id: string) => ({ id, name: id, website: null });
	const ship = (sponsorId: string, over: Record<string, unknown>) => ({
		id: `${sponsorId}-${String(over.status)}`,
		sponsorId,
		title: 'Season',
		tier: null,
		amountCents: null,
		startsOn: null,
		endsOn: null,
		status: 'active' as const,
		...over
	});

	it('puts the sponsor whose term ends soonest first, idle sponsors last', () => {
		const rows = summarizeSponsors(
			[sponsor('idle'), sponsor('later'), sponsor('sooner')],
			[
				ship('later', { endsOn: '2027-06-01' }),
				ship('sooner', { endsOn: '2026-10-15', tier: 'Gold' }),
				ship('idle', { status: 'ended', endsOn: '2026-01-01' })
			],
			TODAY
		);
		expect(rows.map((r) => r.id)).toEqual(['sooner', 'later', 'idle']);
		expect(rows[0].current?.tier).toBe('Gold');
		expect(rows[2].current).toBeNull();
	});

	it('prefers a running sponsorship over a pitch as the current one', () => {
		const [row] = summarizeSponsors(
			[sponsor('s')],
			[
				ship('s', { id: 'pitch', status: 'prospect' }),
				ship('s', { id: 'run', endsOn: '2027-01-01' })
			],
			TODAY
		);
		expect(row.current?.id).toBe('run');
		expect(row.sponsorships).toBe(2);
	});
});

describe('getSponsor', () => {
	it('throws a not-found domain error for an unknown id', async () => {
		await expect(getSponsor('nope', TODAY)).rejects.toBeInstanceOf(SponsorNotFoundError);
	});
});

describe('deleteSponsor', () => {
	it('refuses while sponsorships still name the sponsor', async () => {
		selectResult = [{ n: 2 }];
		await expect(deleteSponsor('s1')).rejects.toBeInstanceOf(SponsorInUseError);
		expect(chainCalls.some((c) => c.method === 'returning')).toBe(false);
	});
});

describe('listSponsors', () => {
	it('leaves archived sponsors out of the active list', async () => {
		await listSponsors(TODAY);
		expect(renderedWheres()).toContainEqual(expect.stringContaining('"deleted_at" is null'));
	});

	it('includes them when the archived filter is on', async () => {
		await listSponsors(TODAY, { includeArchived: true });
		expect(renderedWheres().some((w) => w.includes('deleted_at'))).toBe(false);
	});
});

describe('archiveSponsor and restoreSponsor', () => {
	it('stamps deleted_at rather than deleting, so the sponsorships stay', async () => {
		selectResult = [{ id: 's1' }];
		await archiveSponsor('s1');
		expect(setColumns().deletedAt).toBeInstanceOf(Date);
		expect(chainCalls.some((c) => c.method === 'delete')).toBe(false);
	});

	it('clears deleted_at on restore', async () => {
		selectResult = [{ id: 's1' }];
		await restoreSponsor('s1');
		expect(setColumns().deletedAt).toBeNull();
	});

	it('throws not-found for an unknown id', async () => {
		await expect(archiveSponsor('nope')).rejects.toBeInstanceOf(SponsorNotFoundError);
		await expect(restoreSponsor('nope')).rejects.toBeInstanceOf(SponsorNotFoundError);
	});
});
