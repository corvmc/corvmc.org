import { describe, it, expect } from 'vitest';
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { getTableName } from 'drizzle-orm';
import * as schema from '$lib/server/db/schema';
import { ballotChoice, ballotParticipation } from '$lib/server/db/schema/ballot';

/**
 * The storage half of "secret but auditable": nothing in the schema lets a
 * `ballot_choice` counter be joined back to the member who incremented it.
 * docs/specs/formal-balloting-spec.md § Secrecy has the reasoning.
 */

function referencedTables(table: SQLiteTable): string[] {
	return getTableConfig(table).foreignKeys.map((fk) => getTableName(fk.reference().foreignTable));
}

function columnNames(table: SQLiteTable): string[] {
	return getTableConfig(table).columns.map((c) => c.name);
}

const TIMESTAMPISH = /(_at|_on|time|date|stamp|seq|order|position)$/;

describe('ballot_choice', () => {
	it('references only the ballot and the option', () => {
		expect(referencedTables(ballotChoice).sort()).toEqual(['ballot', 'ballot_option']);
	});

	it('has no column that could name, order or time a voter', () => {
		const cols = columnNames(ballotChoice);
		expect(cols.sort()).toEqual(['ballot_id', 'option_id', 'votes']);
		expect(cols.filter((c) => TIMESTAMPISH.test(c))).toEqual([]);
	});

	it('is a counter keyed on (ballot, option), so no row exists per vote', () => {
		const pk = getTableConfig(ballotChoice).primaryKeys[0];
		expect(pk.columns.map((c) => c.name)).toEqual(['ballot_id', 'option_id']);
	});
});

describe('ballot_participation', () => {
	it('references only the ballot and the member', () => {
		expect(referencedTables(ballotParticipation).sort()).toEqual(['ballot', 'user']);
	});

	it('carries no choice, option or timestamp', () => {
		expect(columnNames(ballotParticipation).sort()).toEqual(['ballot_id', 'user_id']);
	});
});

describe('the schema as a whole', () => {
	const tables = Object.values(schema as Record<string, unknown>).filter(
		(v): v is SQLiteTable =>
			typeof v === 'object' && v !== null && Symbol.for('drizzle:IsDrizzleTable') in v
	);

	it('finds the tables it is about to reason over', () => {
		const names = tables.map((t) => getTableName(t));
		expect(names).toContain('ballot_choice');
		expect(names).toContain('ballot_participation');
	});

	it('has no table referencing ballot_choice or ballot_participation', () => {
		const bridges = tables
			.filter((t) => {
				const refs = referencedTables(t);
				return refs.includes('ballot_choice') || refs.includes('ballot_participation');
			})
			.map((t) => getTableName(t));
		expect(bridges).toEqual([]);
	});

	it('has no table that references both a user and a ballot_option except the recorded vote', () => {
		const both = tables
			.filter((t) => {
				const refs = referencedTables(t);
				return refs.includes('user') && refs.includes('ballot_option');
			})
			.map((t) => getTableName(t));
		expect(both).toEqual(['ballot_recorded_vote']);
	});
});
