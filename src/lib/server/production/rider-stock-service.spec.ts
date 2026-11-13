import { describe, it, expect, vi, beforeAll } from 'vitest';

/**
 * A bill's riders against the catalog, on a real SQLite: the match is joins
 * and the availability is aggregates, which a mocked `db` agrees with either way.
 */

const { testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const {
	getEventRiderStock,
	setRiderElementStock,
	categoryServesKind,
	RiderStockTargetNotFoundError
} = await import('./rider-stock-service');
const { saveElementsFor } = await import('#lib/server/band/rider-service.js');
const schema = await import('#lib/server/db/schema.js');
const { eq } = await import('drizzle-orm');

type Kind = (typeof schema.riderElement.$inferInsert)['kind'];

async function band(id: string, billingOrder: number | null) {
	await testDb.insert(schema.group).values({ id, kind: 'band', name: id, slug: id });
	await testDb.insert(schema.directoryEntry).values({ id: `de-${id}`, name: id, groupId: id });
	await testDb.insert(schema.rider).values({ id: `rider-${id}`, groupId: id });
	if (billingOrder !== null) {
		await testDb.insert(schema.eventBand).values({
			id: `eb-${id}`,
			eventId: 'show',
			name: id,
			directoryEntryId: `de-${id}`,
			billingOrder
		});
	}
}

async function element(
	id: string,
	groupId: string,
	kind: Kind,
	providedBy: 'band' | 'venue' = 'venue'
) {
	await testDb
		.insert(schema.riderElement)
		.values({ id, riderId: `rider-${groupId}`, kind, label: id, providedBy });
}

beforeAll(async () => {
	await testDb.insert(schema.eventListing).values({
		id: 'show',
		title: 'show',
		startsAt: new Date('2031-05-10T03:00:00Z'),
		endsAt: new Date('2031-05-10T06:00:00Z'),
		createdByUserId: 'u1'
	});
	await testDb.insert(schema.equipmentCategory).values([
		{ id: 'cat-mic', name: 'Microphones', displayOrder: 0, pricingTier: 'major' },
		{ id: 'cat-amp', name: 'Amplifiers', displayOrder: 1, pricingTier: 'major' },
		{ id: 'cat-stand', name: 'Stands', displayOrder: 2, pricingTier: 'accessory' }
	]);
	await testDb.insert(schema.inventoryItem).values([
		{ id: 'sm58', name: 'SM58', categoryId: 'cat-mic', kind: 'serialized' },
		{ id: 'deluxe', name: 'Blues Deluxe', categoryId: 'cat-amp', kind: 'serialized' },
		{ id: 'boom', name: 'Boom stand', categoryId: 'cat-stand', kind: 'bulk' },
		{
			id: 'gone',
			name: 'Old amp',
			categoryId: 'cat-amp',
			kind: 'serialized',
			deletedAt: new Date()
		}
	]);
	// Two mics free and one on the bench; one amp; three stands on the shelf.
	await testDb.insert(schema.inventoryAsset).values([
		{ itemId: 'sm58', condition: 'good', status: 'in_service' },
		{ itemId: 'sm58', condition: 'good', status: 'in_service' },
		{ itemId: 'sm58', condition: 'fair', status: 'maintenance' },
		{ itemId: 'deluxe', condition: 'good', status: 'in_service' }
	]);
	await testDb
		.insert(schema.stockMovement)
		.values({ itemId: 'boom', quantity: 3, reason: 'receive' });

	await band('alpha', 1);
	await element('a-vox-1', 'alpha', 'vocals');
	await element('a-vox-2', 'alpha', 'vocals');
	await element('a-vox-3', 'alpha', 'vocals');
	await element('a-amp', 'alpha', 'guitar_amp');
	await element('a-keys', 'alpha', 'keys');
	await element('a-kit', 'alpha', 'drum_kit', 'band');

	await band('beta', 2);
	await element('b-vox', 'beta', 'vocals');
	await element('b-stand', 'beta', 'other');

	await band('offbill', null);
	await element('o-vox', 'offbill', 'vocals');
});

const line = async (id: string) =>
	(await getEventRiderStock('show')).lines.find((l) => l.elementId === id);

describe('getEventRiderStock', () => {
	it('reads only what the bill asks CMC for', async () => {
		const check = await getEventRiderStock('show');
		const ids = check.lines.map((l) => l.elementId);
		expect(ids).not.toContain('a-kit');
		expect(ids).not.toContain('o-vox');
		expect(ids[0]).toMatch(/^a-/);
		expect(check.catalog.map((c) => c.id)).not.toContain('gone');
	});

	it('suggests a category whose name serves the kind', async () => {
		expect(await line('a-amp')).toMatchObject({
			match: { via: 'category', categoryId: 'cat-amp' },
			needed: 1,
			available: 1,
			short: false
		});
	});

	it('lists what nothing in the catalog answers', async () => {
		const check = await getEventRiderStock('show');
		expect((await line('a-keys'))?.match).toBeNull();
		expect(check.unmatchedCount).toBe(check.lines.filter((l) => l.match === null).length);
		expect(check.unmatchedCount).toBeGreaterThan(0);
	});

	it('counts demand per act, so one act asking for more than is free is short', async () => {
		// Three vocal mics against two in service; the one in maintenance does not count.
		expect(await line('a-vox-1')).toMatchObject({ needed: 3, available: 2, short: true });
		// The other act's one vocal is a set change away from the same mics.
		expect(await line('b-vox')).toMatchObject({ needed: 1, available: 2, short: false });
	});

	it('lets a staff link override the category, and clearing it falls back', async () => {
		await setRiderElementStock({ eventId: 'show', elementId: 'b-vox', itemId: 'deluxe' });
		expect((await line('b-vox'))?.match).toEqual({
			via: 'link',
			itemId: 'deluxe',
			itemName: 'Blues Deluxe'
		});

		await setRiderElementStock({ eventId: 'show', elementId: 'b-stand', itemId: 'boom' });
		expect(await line('b-stand')).toMatchObject({
			match: { via: 'link', itemId: 'boom' },
			available: 3,
			short: false
		});

		await setRiderElementStock({ eventId: 'show', elementId: 'b-vox', itemId: null });
		expect((await line('b-vox'))?.match).toMatchObject({ via: 'category', categoryId: 'cat-mic' });
	});

	it('reads a link to a retired catalog item as no link', async () => {
		await testDb
			.update(schema.riderElement)
			.set({ inventoryItemId: 'gone' })
			.where(eq(schema.riderElement.id, 'a-keys'));
		expect((await line('a-keys'))?.match).toBeNull();
		await testDb
			.update(schema.riderElement)
			.set({ inventoryItemId: null })
			.where(eq(schema.riderElement.id, 'a-keys'));
	});
});

describe('setRiderElementStock', () => {
	it('refuses an element that is not on this bill', async () => {
		await expect(
			setRiderElementStock({ eventId: 'show', elementId: 'o-vox', itemId: 'sm58' })
		).rejects.toBeInstanceOf(RiderStockTargetNotFoundError);
	});

	it('refuses a retired catalog item', async () => {
		await expect(
			setRiderElementStock({ eventId: 'show', elementId: 'a-keys', itemId: 'gone' })
		).rejects.toBeInstanceOf(RiderStockTargetNotFoundError);
	});

	it('survives the band re-saving its rider, which mints new element ids', async () => {
		await setRiderElementStock({ eventId: 'show', elementId: 'a-keys', itemId: 'boom' });
		await saveElementsFor('alpha', null, [
			{ kind: 'keys', label: 'a-keys', providedBy: 'venue' },
			{ kind: 'vocals', label: 'a-vox-1', providedBy: 'venue' }
		]);
		const [row] = await testDb
			.select({ itemId: schema.riderElement.inventoryItemId })
			.from(schema.riderElement)
			.where(eq(schema.riderElement.label, 'a-keys'));
		expect(row.itemId).toBe('boom');
	});
});

describe('categoryServesKind', () => {
	it('matches on the start of a word, not anywhere in the name', () => {
		expect(categoryServesKind('Microphones', 'vocals')).toBe(true);
		expect(categoryServesKind('Drum Hardware', 'drum_kit')).toBe(true);
		expect(categoryServesKind('Audio cables', 'playback')).toBe(false);
		expect(categoryServesKind('Anything', 'other')).toBe(false);
	});
});
