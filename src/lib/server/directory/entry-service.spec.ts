import { describe, it, expect, vi } from 'vitest';
import { drizzle as drizzleProxy } from 'drizzle-orm/sqlite-proxy';

/**
 * `replaceTags` is the whole write path for `directory_tag`, and its one
 * dangerous property is that its delete is scoped to a `kind`.
 *
 * Genres, instruments and — since directory matching — sought instruments share
 * one table. An unscoped delete would clear a member's instruments every time
 * they saved their genres, and *every* assertion that "saving genres works"
 * would still pass, because the genres would be correct. So this reads the
 * generated SQL rather than the shape of the call.
 *
 * A real drizzle instance over the proxy driver (which never runs a query) so
 * the statements are the ones that ship, built from the schema rather than
 * retyped here.
 */
vi.mock('$lib/server/db', () => ({ db: drizzleProxy(async () => ({ rows: [] })) }));

import { replaceTags } from './entry-service';

/** The rendered SQL + bound parameters of one batch statement. */
function render(statement: unknown) {
	return (statement as { toSQL: () => { sql: string; params: unknown[] } }).toSQL();
}

describe('replaceTags', () => {
	it('scopes its delete to the kind being replaced', () => {
		const [del] = replaceTags('entry-1', 'seeking_instrument', ['bass']);
		const { sql, params } = render(del);

		expect(sql).toContain('delete from "directory_tag"');
		expect(sql).toContain('"kind"');
		// Both halves of the predicate, as bound values: the entry AND the kind.
		expect(params).toContain('entry-1');
		expect(params).toContain('seeking_instrument');
	});

	it('leaves every other kind alone', () => {
		// The regression the comment on `replaceTags` warns about, stated as an
		// assertion: saving what a band is looking for must not touch its genres.
		const statements = replaceTags('entry-1', 'seeking_instrument', ['drums']);
		const params = statements.flatMap((s) => render(s).params);

		expect(params).not.toContain('genre');
		expect(params).not.toContain('instrument');
	});

	it('writes the new kind onto every inserted row', () => {
		const [, insert] = replaceTags('entry-1', 'seeking_instrument', ['bass', 'drums']);
		const { sql, params } = render(insert);

		expect(sql).toContain('insert into "directory_tag"');
		expect(params.filter((p) => p === 'seeking_instrument')).toHaveLength(2);
		expect(params).toContain('bass');
		expect(params).toContain('drums');
	});

	it('emits the delete alone when the list is empty', () => {
		// Clearing is a real edit — a band that filled a chair says so by emptying
		// the field — and an INSERT with no rows is not a statement.
		expect(replaceTags('entry-1', 'seeking_instrument', [])).toHaveLength(1);
	});

	it('still serves the kinds it served before', () => {
		// The parameter widened from a hand-listed pair to the vocabulary; the two
		// original kinds have to come out unchanged.
		for (const kind of ['genre', 'instrument'] as const) {
			const [del] = replaceTags('entry-1', kind, ['jazz']);
			expect(render(del).params).toContain(kind);
		}
	});
});
