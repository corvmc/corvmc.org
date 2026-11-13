import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * An outside act's bookings against a real SQLite: two acts on one bill, and
 * the scoping is the `WHERE`, which a mocked `db` agrees with either way.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedD1 } = await import('#lib/server/testing/migrated-d1.js');
	return migratedD1();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { listActSlotTerms } = await import('./run-of-show-service');
const { actContactNamesUnguarded } = await import('#lib/server/directory/contact-service.js');
const schema = await import('#lib/server/db/schema.js');

const NOW = new Date('2026-11-13T12:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

async function show(id: string, startsAt: Date, status: 'draft' | 'offered' | 'settled') {
	await testDb.insert(schema.project).values({ id: `proj-${id}`, name: id, kind: 'production' });
	await testDb.insert(schema.eventListing).values({
		id,
		title: id,
		startsAt,
		endsAt: new Date(startsAt.getTime() + 3_600_000),
		createdByUserId: 'u1',
		projectId: `proj-${id}`
	});
	await testDb
		.insert(schema.production)
		.values({ id: `prod-${id}`, projectId: `proj-${id}`, status });
}

async function slot(
	eventId: string,
	entryId: string,
	terms: { guaranteeCents: number; paidCents?: number; contactId?: string }
) {
	const eb = `eb-${eventId}-${entryId}`;
	await testDb
		.insert(schema.eventBand)
		.values({ id: eb, eventId, name: entryId, directoryEntryId: entryId });
	await testDb.insert(schema.productionSlot).values({
		productionId: `prod-${eventId}`,
		eventBandId: eb,
		sortOrder: 1,
		setLengthMinutes: 30,
		...terms
	});
}

beforeAll(async () => {
	for (const id of ['act-a', 'act-b']) {
		await testDb.insert(schema.directoryEntry).values({ id, name: id });
		await testDb
			.insert(schema.organization)
			.values({ id: `org-${id}`, name: id, directoryEntryId: id });
	}
	// Raw SQL: only `contact-service.ts` may name the table (`custom/no-contact-schema-imports`).
	sqlite.exec(`insert into contact (id, organization_id, name, source) values
		('c-a', 'org-act-a', 'Tour manager A', 'self_entered'),
		('c-b', 'org-act-b', 'Tour manager B', 'self_entered')`);

	await show('upcoming', day(10), 'offered');
	await slot('upcoming', 'act-a', { guaranteeCents: 20000, contactId: 'c-a' });
	await slot('upcoming', 'act-b', { guaranteeCents: 99900, contactId: 'c-b' });

	await show('recent', day(-20), 'settled');
	await slot('recent', 'act-a', { guaranteeCents: 15000, paidCents: 15000 });

	await show('long-ago', day(-400), 'settled');
	await slot('long-ago', 'act-a', { guaranteeCents: 10000 });

	await show('sketch', day(30), 'draft');
	await slot('sketch', 'act-a', { guaranteeCents: 50000 });
});

describe('listActSlotTerms', () => {
	it('returns only the act’s own slots, offered or later, upcoming and recent', async () => {
		const rows = await listActSlotTerms('act-a', NOW);

		expect(rows.map((r) => r.eventId)).toEqual(['recent', 'upcoming']);
		expect(rows.map((r) => r.terms.guaranteeCents)).toEqual([15000, 20000]);
		expect(rows.map((r) => r.paidCents)).toEqual([15000, null]);
	});

	it('never carries another act’s terms from the same bill', async () => {
		const rows = await listActSlotTerms('act-a', NOW);
		expect(rows.some((r) => r.terms.guaranteeCents === 99900)).toBe(false);
		expect(rows.some((r) => r.contactId === 'c-b')).toBe(false);
	});

	it('returns nothing for an entry with no slots', async () => {
		expect(await listActSlotTerms('nobody', NOW)).toEqual([]);
	});
});

describe('actContactNamesUnguarded', () => {
	it('names only people at the act’s own organization, whatever ids are asked for', async () => {
		const names = await actContactNamesUnguarded('act-a', ['c-a', 'c-b']);
		expect([...names.keys()]).toEqual(['c-a']);
	});
});
