import { sql } from 'drizzle-orm';
import { group, groupCapability } from '$lib/server/db/schema/group';

/** SQLite's `json_group_array` output, which is `[]` when there are no rows. */
export function parseGrantList(value: string): string[] {
	return JSON.parse(value) as string[];
}

/**
 * A committee's stored grant list, as a correlated subquery on `group`, so a
 * query that already reads the group row carries its grants without a second
 * read. Unfiltered: callers apply `allowlisted` where it matters.
 */
export function groupGrantsColumn() {
	return sql<
		string[]
	>`(SELECT json_group_array(${groupCapability.capability}) FROM ${groupCapability} WHERE ${groupCapability.groupId} = ${group.id})`.mapWith(
		parseGrantList
	);
}
