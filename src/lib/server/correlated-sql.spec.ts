import { describe, it, expect, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { user } from './db/schema/authentication';

// ---------------------------------------------------------------------------
// Regression: correlated SQL fragments must qualify their outer reference.
//
// When a drizzle Column is interpolated into a sql`` fragment in the select
// list of a SINGLE-TABLE query, drizzle renders it unqualified ("id", not
// "user"."id"). Inside a correlated subquery that re-selects the same table
// under an alias, SQLite resolves the bare name against the INNER table, so
// the correlation collapses to `u.id = u.id` — always true — and every outer
// row gets the first table row's value. This is the bug that marked every
// user on the staff Users page as a sustaining member in production.
//
// These tests pin the rendered SQL of both correlated helpers when used from
// a single-table select (the shape of getStaffUsers). Joined queries render
// columns qualified and were never affected.
// ---------------------------------------------------------------------------

vi.mock('$lib/server/db', () => ({ db: {}, getRowCount: () => 0 }));
vi.mock('./reservation/conflict-service', () => ({
	validateBooking: vi.fn(),
	hasConflict: vi.fn()
}));
vi.mock('$lib/server/stripe', () => ({ stripe: {} }));
vi.mock('$app/server', () => ({ getRequestEvent: vi.fn() }));
vi.mock('$lib/server/finance/payment-service', () => ({ checkout: vi.fn() }));
vi.mock('$lib/server/finance/product-config-service', () => ({
	getProductConfig: vi.fn(),
	getStripeProductId: vi.fn(),
	buildSubscriptionLineItem: vi.fn()
}));

const { isSustainingMemberSql } = await import('./finance/subscription-service');
const { topPositionFor } = await import('./authorization');
const { isFirstReservationSql } = await import('./reservation/reservation-service');
const { reservation } = await import('./db/schema/reservation');

// A bare drizzle instance is enough to render SQL — no D1 binding needed.
const db = drizzle({} as never);

describe('isSustainingMemberSql', () => {
	it('correlates to the OUTER user row in a single-table select', () => {
		const { sql: rendered } = db
			.select({ id: user.id, sustaining: isSustainingMemberSql(user.id) })
			.from(user)
			.toSQL();

		// The subquery's where-clause must reference the outer table explicitly.
		// An unqualified `u.id = "id"` binds to the inner alias and is always true.
		expect(rendered).toContain('u.id = "user"."id"');
		expect(rendered).not.toMatch(/u\.id = "id"/);
	});
});

describe('topPositionFor', () => {
	it('correlates to the OUTER user row in a single-table select', () => {
		const { sql: rendered } = db
			.select({ id: user.id, role: topPositionFor(user.id) })
			.from(user)
			.toSQL();

		// Unqualified, the bare "id" would resolve to roles.id inside the
		// subquery and the predicate could never match a user id.
		expect(rendered).toContain('mhr.user_id = "user"."id"');
		expect(rendered).not.toMatch(/mhr\.user_id = "id"/);
	});

	it('restricts to real positions, so a legacy role row cannot be returned', () => {
		const { sql: rendered } = db
			.select({ id: user.id, role: topPositionFor(user.id) })
			.from(user)
			.toSQL();

		// Without the `in (…)` filter a member holding only the legacy 'member'
		// row comes back with that name, and memberSubtype would badge them.
		expect(rendered).toContain("r.name in ('admin', 'staff'");
		expect(rendered).not.toContain("'member'");
		expect(rendered).not.toContain("'sustaining'");
	});

	it('generates its display ladder from positionOrder', async () => {
		const { positionOrder } = await import('$lib/config');
		const { sql: rendered } = db
			.select({ id: user.id, role: topPositionFor(user.id) })
			.from(user)
			.toSQL();

		// Adding a position to the matrix must not silently leave the badge
		// behind — every one of them has to appear in the CASE ladder.
		positionOrder.forEach((p, i) => expect(rendered).toContain(`when '${p}' then ${i}`));
	});
});

describe('isFirstReservationSql', () => {
	const rendered = () =>
		db.select({ id: reservation.id, first: isFirstReservationSql() }).from(reservation).toSQL().sql;

	it('correlates to the OUTER reservation row in a single-table select', () => {
		// Unqualified, `created_by_user_id` binds to the inner `r0` alias, the
		// predicate is always true, and every booking on the page reads as a
		// first visit.
		expect(rendered()).toContain('r0.created_by_user_id = "reservation"."created_by_user_id"');
		expect(rendered()).not.toMatch(/r0\.created_by_user_id = "created_by_user_id"/);
		expect(rendered()).toContain('r0.starts_at < "reservation"."starts_at"');
		expect(rendered()).toContain('r0.id < "reservation"."id"');
	});

	it('counts only member bookings, and neither a cancelled nor a waitlisted one', () => {
		const sql = rendered();
		// The flag is for a member walking in for the first time — not a band's
		// hold, and not a booking nobody will show up to.
		expect(sql).toContain(`"reservation"."booker_type" = 'user'`);
		expect(sql).toContain(`"reservation"."status" not in ('cancelled', 'waitlisted')`);
		// Neither a cancelled booking nor a queue position is a visit, so neither
		// is prior history. The waitlisted half was missing while this only drove
		// a badge; sharing the rule with the orientation listener made a stale
		// waitlisted row able to suppress somebody's orientation outright.
		expect(sql).toContain(`r0.status not in ('cancelled', 'waitlisted')`);
	});
});
