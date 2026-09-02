import { directoryEntry } from '../../src/lib/server/db/schema/directory';
import { db } from './db';

export async function seedExternalActs() {
	const acts = [
		{
			name: 'Sawtooth Rivals',
			hometown: 'Boise, ID',
			bio: 'Toured through twice in 2025. Easy load-in, brought their own monitors.',
			links: [{ label: 'Bandcamp', url: 'https://sawtoothrivals.bandcamp.com' }]
		},
		{
			name: 'The Quiet Part',
			hometown: 'Olympia, WA',
			bio: 'Three-piece, quiet set, asked for a rug.',
			links: [{ label: 'Instagram', url: 'https://instagram.com/thequietpart' }]
		},
		// No links at all: on a public bill this one is the plain-text case,
		// which is the branch that has no URL to point at rather than a broken one.
		{
			name: 'Fenwick',
			hometown: 'Eugene, OR',
			bio: 'Solo act. Books through a manager.',
			links: null
		}
	];

	const rows = [];
	for (const a of acts) {
		const [row] = await db
			.insert(directoryEntry)
			.values({
				userId: null,
				groupId: null,
				name: a.name,
				hometown: a.hometown,
				bio: a.bio,
				links: a.links,
				visibility: 'hidden'
			})
			.returning();
		rows.push(row);
	}
	return rows;
}
