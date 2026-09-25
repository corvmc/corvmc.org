import { sql } from 'drizzle-orm';
import { project } from '../../src/lib/server/db/schema/project';
import { production } from '../../src/lib/server/db/schema/production';
import { batchInsert, db } from './db';

/**
 * Every production is a project (docs/specs/production-projects-spec.md), and
 * `production.project_id` is required by a trigger. The seeders mint a show's
 * production before its listing exists, so the project starts with a stand-in
 * name and `syncShowProjects` copies the listing's title and dates over once
 * it does.
 */
export async function insertShowProductions(
	rows: (typeof production.$inferInsert)[]
): Promise<(typeof production.$inferSelect)[]> {
	const withProjects = rows.map((row) => ({ ...row, projectId: crypto.randomUUID() }));
	await batchInsert(
		project,
		withProjects.map((row) => ({
			id: row.projectId,
			name: 'Show',
			kind: 'production' as const,
			createdByUserId: row.createdByUserId ?? null
		}))
	);
	return batchInsert(production, withProjects);
}

/** Name and date each show's project from its listing, and point the listing at it. */
export async function syncShowProjects(): Promise<void> {
	await db.run(sql`
		update event_listing
		set project_id = (select p.project_id from production p where p.id = event_listing.production_id)
		where production_id is not null
	`);
	await db.run(sql`
		update project
		set name = e.title,
			starts_at = e.starts_at,
			ends_at = case when e.ends_at > e.starts_at then e.ends_at else null end
		from event_listing e
		join production p on p.id = e.production_id
		where p.project_id = project.id and project.kind = 'production'
	`);
}

/**
 * `project_committee` rows, once the committees exist: an owner row for every
 * `project.group_id`, and Booking and Production on every show. What the
 * phase 1 migration does in production, idempotently.
 */
export async function seedProjectCommittees(): Promise<number> {
	await db.run(sql`
		insert or ignore into project_committee (project_id, group_id, role)
		select pr.id, pr.group_id, 'owner'
		from project pr join "group" g on g.id = pr.group_id
		where g.kind = 'committee'
	`);
	await db.run(sql`
		insert or ignore into project_committee (project_id, group_id, role)
		select pr.id, g.id,
			case g.slug when 'booking-committee' then 'booking' else 'production' end
		from project pr
		join "group" g on g.slug in ('booking-committee', 'production-committee')
			and g.kind = 'committee' and g.deleted_at is null
		where pr.kind = 'production'
	`);
	const [{ n }] = await db.all<{ n: number }>(sql`select count(*) as n from project_committee`);
	return Number(n);
}
