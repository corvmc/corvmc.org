import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { db, env } from './db';
import { PRACTICE_SPACE_CLEARANCE_ID } from '../../src/lib/config';

const MIGRATION = new URL(
	'../../migrations/20261111205130_practice_space_clearance/migration.sql',
	import.meta.url
);

/**
 * The Practice space clearance, and the orientation shift switched on.
 *
 * The wipe at the top of the seed empties the catalog row the migration wrote,
 * so the migration's own SQL runs again here, after the bookings and
 * orientations it backfills from: one copy of the rule, and local data that
 * looks like production did after it ran.
 */
export async function seedPracticeSpaceClearance(volunteerRoles: { id: string; name: string }[]) {
	console.log('Seeding the Practice space clearance...');
	const statements = readFileSync(MIGRATION, 'utf8').split('--> statement-breakpoint');
	for (const statement of statements) await db.run(sql.raw(statement));

	// Production sets this on /staff/settings; locally the seed does it, so a
	// first booking raises an orientation shift without a trip to that page.
	const role = volunteerRoles.find((r) => r.name === 'Rehearsal Orientation');
	if (role) {
		await env.KV.put('site-config:volunteer.orientationRoleId', JSON.stringify(role.id));
	}

	const [{ n }] = await db.all<{ n: number }>(
		sql`select count(*) as n from member_certification where certification_id = ${PRACTICE_SPACE_CLEARANCE_ID}`
	);
	return { holders: n, orientationRoleId: role?.id ?? null };
}
