import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The bands the booking form offers under For, against a real SQLite. The class
 * pinned: the form offers exactly the bands `bookBandReservation`'s guard admits,
 * so it neither offers a band that 403s nor hides one the member may book for.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { listBookableBands } = await import('./bookable-bands');
const { getBySlug, getUserRole } = await import('#lib/server/band/band-service.js');

const SUB = `'{"status":"active"}'`;

beforeEach(() => {
	sqlite.exec(`
		delete from group_member; delete from "group"; delete from "user";
		insert into "user" (id, name, email, subscription) values
			('ana', 'Ana', 'ana@example.com', null),
			('ben', 'Ben', 'ben@example.com', ${SUB}),
			('cy', 'Cy', 'cy@example.com', ${SUB});
		insert into "group" (id, kind, name, slug, join_policy, deleted_at) values
			('b-solo', 'band', 'Solo Act', 'solo-act', 'invite_only', null),
			('b-duo', 'band', 'Duo', 'duo', 'invite_only', null),
			('b-pending', 'band', 'Pending Band', 'pending-band', 'invite_only', null),
			('b-gone', 'band', 'Gone Band', 'gone-band', 'invite_only', 1000),
			('b-other', 'band', 'Other Band', 'other-band', 'invite_only', null),
			('club', 'club', 'Film Club', 'film-club', 'open', null),
			('cmte', 'committee', 'Booking', 'booking', 'invite_only', null);
		insert into group_member (id, group_id, user_id, role, status) values
			('m1', 'b-solo', 'ana', 'owner', 'active'),
			('m2', 'b-duo', 'ana', 'member', 'active'),
			('m3', 'b-duo', 'ben', 'member', 'active'),
			('m4', 'b-pending', 'ana', 'member', 'pending'),
			('m5', 'b-gone', 'ana', 'owner', 'active'),
			('m6', 'b-other', 'cy', 'owner', 'active'),
			('m7', 'club', 'ana', 'member', 'active'),
			('m8', 'cmte', 'ana', 'member', 'active'),
			('m9', 'b-solo', 'cy', 'member', 'pending');
	`);
});

describe('listBookableBands', () => {
	it('offers exactly the bands the booking guard admits', async () => {
		const offered = new Set((await listBookableBands('ana')).map((b) => b.slug));
		const bands = sqlite.prepare(`select id, slug from "group" where kind = 'band'`).all() as {
			id: string;
			slug: string;
		}[];

		for (const band of bands) {
			// `requireGroupRole(…, 'member')`: a live group and an active roster row.
			const admitted =
				(await getBySlug(band.slug)) !== null && (await getUserRole(band.id, 'ana')) !== null;
			expect(offered.has(band.slug), band.slug).toBe(admitted);
		}
	});

	it('leaves out clubs and committees, whose bookings are program holds', async () => {
		const offered = (await listBookableBands('ana')).map((b) => b.slug);
		expect(offered).not.toContain('film-club');
		expect(offered).not.toContain('booking');
	});

	it('marks a band with an active sustaining member', async () => {
		const bands = await listBookableBands('ana');
		const sustaining = Object.fromEntries(bands.map((b) => [b.slug, b.hasSustainingMember]));
		// Cy is sustaining but only pending on Solo Act, so it does not count.
		expect(sustaining).toEqual({ duo: true, 'solo-act': false });
	});

	it('offers nothing to a member of no band', async () => {
		sqlite.exec(`insert into "user" (id, name, email) values ('dee', 'Dee', 'dee@example.com')`);
		expect(await listBookableBands('dee')).toEqual([]);
	});
});
