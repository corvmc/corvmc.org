import { describe, it, expect, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';

// A bare drizzle instance renders SQL with no D1 binding behind it.
vi.mock('$lib/server/db', () => ({ db: drizzle({} as never) }));

const { saveTicketSale } = await import('./ticket-sale');

function render(q: ReturnType<typeof saveTicketSale>) {
	if (!q) throw new Error('expected a statement');
	const { sql, params } = q.toSQL();
	return { sql: sql.toLowerCase(), params };
}

describe('saveTicketSale', () => {
	it('upserts on the listing, so a listing has one set of sale terms', () => {
		const { sql } = render(saveTicketSale('evt-1', { enabled: true, priceCents: 1500 }));
		expect(sql).toContain('insert into "ticket_sale"');
		expect(sql).toMatch(/on conflict \(("ticket_sale"\.)?"event_listing_id"\) do update/);
	});

	it('updates only the terms it was given', () => {
		const { sql } = render(saveTicketSale('evt-1', { quantity: 80 }));
		const update = sql.slice(sql.indexOf('do update'));
		expect(update).toContain('"quantity"');
		expect(update).not.toContain('"enabled"');
		expect(update).not.toContain('"price_cents"');
		expect(update).not.toContain('"price_floor_cents"');
	});

	it('writes the collective as the seller: group_id is left null', () => {
		const { sql, params } = render(saveTicketSale('evt-1', { enabled: true, priceCents: 1500 }));
		expect(params).toContain('evt-1');
		const update = sql.slice(sql.indexOf('do update'));
		expect(update).not.toContain('"group_id"');
	});

	it('names a band as the seller when given one', () => {
		const { sql, params } = render(saveTicketSale('evt-1', { enabled: true, groupId: 'band-1' }));
		expect(sql.slice(sql.indexOf('do update'))).toContain('"group_id"');
		expect(params).toContain('band-1');
	});

	it('returns nothing when there is nothing to write', () => {
		expect(saveTicketSale('evt-1', {})).toBeNull();
	});
});
