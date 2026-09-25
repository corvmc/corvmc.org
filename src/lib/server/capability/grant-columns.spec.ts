import { describe, it, expect } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { groupGrantsColumn } from './grant-columns';

describe('groupGrantsColumn', () => {
	it('reads the join table for the outer query’s group row', () => {
		const { sql, params } = new SQLiteSyncDialect().sqlToQuery(groupGrantsColumn());
		expect(sql).toBe(
			'(SELECT json_group_array("group_capability"."capability") FROM "group_capability" WHERE "group_capability"."group_id" = "group"."id")'
		);
		expect(params).toEqual([]);
	});

	it('decodes the JSON array SQLite returns, including an empty one', () => {
		const column = groupGrantsColumn();
		expect(column.decoder.mapFromDriverValue('["sponsor.read","grant.read"]')).toEqual([
			'sponsor.read',
			'grant.read'
		]);
		expect(column.decoder.mapFromDriverValue('[]')).toEqual([]);
	});
});
