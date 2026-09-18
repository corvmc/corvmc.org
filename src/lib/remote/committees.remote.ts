import { query } from '$app/server';
import { listCommittees } from '$lib/server/group/committee-application-service';

/**
 * The committees, for the public pages that describe them.
 *
 * Unguarded on purpose: a committee's name and remit are what the paper
 * application tells people to go and read. No guard means no ids either —
 * `/contribute` and `/about` need the words, not the rows.
 */
export const getPublicCommittees = query(async () => {
	const rows = await listCommittees();
	return rows.map((c) => ({ name: c.name, bio: c.bio }));
});
