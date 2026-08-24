import { describe, it, expect, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { alias } from 'drizzle-orm/sqlite-core';
import { user } from '$lib/server/db/schema/authentication';

vi.mock('$lib/server/storage', () => ({
	resolveImageUrl: vi.fn((key: string | null | undefined) =>
		key ? `https://media.test/${key}` : null
	)
}));
// The correlated helpers reach the whole finance/auth graph on import. None of
// it runs here — only the SQL these columns render is under test.
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/stripe', () => ({ stripe: {} }));
vi.mock('$app/server', () => ({ getRequestEvent: vi.fn() }));
vi.mock('$lib/server/finance/payment-service', () => ({ checkout: vi.fn() }));
vi.mock('$lib/server/finance/product-config-service', () => ({
	getProductConfig: vi.fn(),
	getStripeProductId: vi.fn(),
	buildSubscriptionLineItem: vi.fn()
}));

import { memberRefColumns, toBookerRef, toMemberRef } from './refs';

describe('toMemberRef', () => {
	it('carries identity, contact and avatar', () => {
		expect(
			toMemberRef({
				id: 'u1',
				name: 'Ada Lovelace',
				email: 'ada@example.com',
				pronouns: 'she/her',
				image: 'avatars/ada.jpg'
			})
		).toEqual({
			type: 'member',
			id: 'u1',
			title: 'Ada Lovelace',
			subtitle: 'ada@example.com',
			pronouns: 'she/her',
			image: 'https://media.test/avatars/ada.jpg',
			subtype: null
		});
	});

	it('leaves an ordinary member unmarked', () => {
		expect(toMemberRef({ id: 'u1', name: 'Ada', role: 'member' }).subtype).toBeNull();
	});

	it('marks staff, admins and sustaining members', () => {
		expect(toMemberRef({ id: 'u1', name: 'Ada', role: 'admin' }).subtype).toBe('admin');
		expect(toMemberRef({ id: 'u1', name: 'Ada', role: 'staff' }).subtype).toBe('staff');
		expect(toMemberRef({ id: 'u1', name: 'Ada', sustaining: 1 }).subtype).toBe('sustaining');
	});

	it('reads sustaining from the subscription flag, not the legacy role', () => {
		// The correlated subquery lands as 0/1, and the legacy role name is not
		// maintained by the Stripe flow.
		expect(toMemberRef({ id: 'u1', name: 'Ada', role: 'sustaining', sustaining: 0 }).subtype).toBe(
			null
		);
		expect(toMemberRef({ id: 'u1', name: 'Ada', role: 'member', sustaining: 1 }).subtype).toBe(
			'sustaining'
		);
	});

	it('still produces a ref for a member who is gone', () => {
		// A left join that missed. The row stays, unlinked, so the count above it
		// stays honest.
		const ref = toMemberRef(null);
		expect(ref).toMatchObject({ type: 'member', id: null, title: 'Unknown member' });
	});
});

describe('memberRefColumns', () => {
	// A bare drizzle instance renders SQL without a D1 binding.
	const db = drizzle({} as never);

	it('correlates role and sustaining to the row being projected', () => {
		const { sql } = db.select({ member: memberRefColumns() }).from(user).toSQL();

		// The same trap `correlated-sql.spec.ts` pins for the helpers used alone:
		// an unqualified reference binds to the subquery's own alias.
		expect(sql).toContain('u.id = "user"."id"');
		expect(sql).toContain('mhr.user_id = "user"."id"');
	});

	it('follows an alias, so one query can project two different members', () => {
		// A booking's member and its approver are two joins to `user`; each ref
		// has to correlate to its own alias or both rows report the first one.
		const approver = alias(user, 'approver');
		const { sql } = db
			.select({ member: memberRefColumns(), approver: memberRefColumns(approver) })
			.from(user)
			.innerJoin(approver, eq(approver.id, user.id))
			.toSQL();

		expect(sql).toContain('u.id = "approver"."id"');
	});
});

describe('toBookerRef', () => {
	const member = { id: 'u1', name: 'Ada' };
	const bandRow = { id: 'b1', name: 'The Velvet Underground', slug: 'the-velvet-underground' };
	const eventRow = { id: 'e1', title: 'Loud Night' };

	it('follows bookerType to the record the booking is actually for', () => {
		const args = { member, band: bandRow, event: eventRow };
		expect(toBookerRef({ ...args, bookerType: 'user' })).toMatchObject({
			type: 'member',
			title: 'Ada'
		});
		expect(toBookerRef({ ...args, bookerType: 'band' })).toMatchObject({
			type: 'band',
			title: 'The Velvet Underground',
			slug: 'the-velvet-underground'
		});
		expect(toBookerRef({ ...args, bookerType: 'event' })).toMatchObject({
			type: 'event',
			title: 'Loud Night'
		});
	});

	/**
	 * Nothing in this app writes `lesson`; it arrives with migrated rows and has
	 * no record to point at, so the booking falls back to whoever holds it and
	 * the row keeps its own lesson glyph to say what it is.
	 */
	it('falls back to the member for a lesson, which has no booker record', () => {
		expect(toBookerRef({ bookerType: 'lesson', member })).toMatchObject({
			type: 'member',
			title: 'Ada'
		});
	});

	/**
	 * A deleted band must not quietly report as a member booking — the row would
	 * then claim something about the data that is not true.
	 */
	it('keeps the type when the join missed, rather than reporting a member', () => {
		expect(toBookerRef({ bookerType: 'band', member, band: null })).toMatchObject({
			type: 'band',
			id: null,
			title: 'Unknown band'
		});
	});
});
