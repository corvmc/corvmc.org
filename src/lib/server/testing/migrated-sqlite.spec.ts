import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { migratedSqlite } from './migrated-sqlite';
import { user } from '#lib/server/db/schema/authentication.js';
import { isUniqueConstraintError } from '#lib/server/db/constraint-errors.js';

/**
 * Every real-SQLite spec runs on this fixture, so it throws what production
 * throws (#2715). Pinned against a real `getPlatformProxy()` D1 under drizzle 1.0.0-rc.3:
 * a single write throws DrizzleQueryError("Failed query: …") with
 * "D1_ERROR: UNIQUE constraint failed: t.email: SQLITE_CONSTRAINT (extended:
 * SQLITE_CONSTRAINT_UNIQUE)" on `cause`; `db.batch` throws that error bare.
 */
const { sqlite, testDb } = migratedSqlite();

const caught = (p: PromiseLike<unknown>) =>
	Promise.resolve(p).then(
		() => null,
		(e: Error & { cause?: Error }) => e
	);

beforeEach(() => {
	sqlite.exec('delete from user');
	sqlite.exec(`insert into user (id, name, email) values ('u1', 'A', 'a@example.com')`);
});

describe('migratedSqlite', () => {
	it('wraps a single write, with the D1 text on cause', async () => {
		const err = await caught(
			testDb.insert(user).values({ id: 'u2', name: 'B', email: 'a@example.com' })
		);
		expect(err?.name).toBe('DrizzleQueryError');
		expect(err?.message).not.toMatch(/unique/i);
		expect(err?.cause?.message).toMatch(/^D1_ERROR: UNIQUE constraint failed: user\.email: /);
		expect(isUniqueConstraintError(err)).toBe(true);
	});

	it('throws the D1 error bare from a batch, and rolls it back', async () => {
		const err = await caught(
			testDb.batch([
				testDb.update(user).set({ name: 'Changed' }).where(eq(user.id, 'u1')),
				testDb.insert(user).values({ id: 'u2', name: 'B', email: 'a@example.com' })
			])
		);
		expect(err?.message).toMatch(/^D1_ERROR: UNIQUE constraint failed: user\.email: /);
		expect(isUniqueConstraintError(err)).toBe(true);
		const [row] = await testDb.select({ name: user.name }).from(user).where(eq(user.id, 'u1'));
		expect(row.name).toBe('A');
	});

	it('reads, returns and maps columns as the D1 driver does', async () => {
		const [inserted] = await testDb
			.insert(user)
			.values({ id: 'u3', name: 'C', email: 'c@example.com', emailVerified: true })
			.returning({ id: user.id, emailVerified: user.emailVerified });
		expect(inserted).toEqual({ id: 'u3', emailVerified: true });
		const found = await testDb.query.user.findFirst({ where: { id: 'u3' } });
		expect(found?.emailVerified).toBe(true);
	});

	it('refuses a statement over D1’s 100 bound parameters', async () => {
		const insert = (n: number) =>
			testDb
				.insert(user)
				.values(
					Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: 'P', email: `p${i}@x.org` }))
				);
		const perRow = insert(1).toSQL().params.length;
		const fits = Math.floor(100 / perRow);
		expect((await caught(insert(fits + 1)))?.name).toBe('DrizzleQueryError');
		expect(await caught(insert(fits))).toBeNull();
	});
});
