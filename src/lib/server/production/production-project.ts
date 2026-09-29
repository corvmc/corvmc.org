import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { db } from '$lib/server/db';
import { group } from '$lib/server/db/schema/group';
import { production } from '$lib/server/db/schema/production';
import { project, projectCommittee } from '$lib/server/db/schema/project';
import { showCommitteeSlugs, type ProjectCommitteeRole } from '$lib/config';

/**
 * Every production is a project, specialised — docs/specs/production-projects-spec.md.
 *
 * The writes that open a show's two rows and its committees, as batch items, so
 * each caller runs them in the same `db.batch` as whatever else it writes.
 */

export interface ShowCommittee {
	groupId: string;
	role: ProjectCommitteeRole;
}

export interface ShowProjectInput {
	productionId: string;
	projectId: string;
	/** The listing's title; the project is named for the show. */
	name: string;
	startsAt: Date | null;
	endsAt: Date | null;
	createdByUserId: string | null;
}

/** Booking and Production, where each exists and is live. A missing one is skipped. */
export async function showCommittees(): Promise<ShowCommittee[]> {
	const bySlug = new Map<string, ProjectCommitteeRole>(
		Object.entries(showCommitteeSlugs).map(([role, slug]) => [slug, role as ProjectCommitteeRole])
	);
	const rows = await db
		.select({ id: group.id, slug: group.slug })
		.from(group)
		.where(
			and(
				inArray(group.slug, [...bySlug.keys()]),
				eq(group.kind, 'committee'),
				isNull(group.deletedAt)
			)
		);
	return rows.map((r) => ({ groupId: r.id, role: bySlug.get(r.slug)! }));
}

/** The project a show's dates hold: an end no later than the start is no end at all. */
function projectWindow(startsAt: Date | null, endsAt: Date | null) {
	return {
		startsAt,
		endsAt: startsAt && endsAt && endsAt > startsAt ? endsAt : null
	};
}

/**
 * The project, then the production pointing at it, then the committees. Order is
 * load-bearing: `production.project_id` is a real foreign key.
 */
export function showProjectWrites(
	input: ShowProjectInput,
	committees: readonly ShowCommittee[]
): [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] {
	return [
		db.insert(project).values({
			id: input.projectId,
			name: input.name,
			kind: 'production',
			...projectWindow(input.startsAt, input.endsAt),
			createdByUserId: input.createdByUserId
		}),
		db.insert(production).values({
			id: input.productionId,
			projectId: input.projectId,
			createdByUserId: input.createdByUserId
		}),
		...committees.map((c) =>
			db
				.insert(projectCommittee)
				.values({ projectId: input.projectId, groupId: c.groupId, role: c.role })
				.onConflictDoNothing()
		)
	];
}

/** Write a show's project, production and committees in one batch. */
export async function createShowProject(input: ShowProjectInput): Promise<void> {
	await db.batch(showProjectWrites(input, await showCommittees()));
}

/**
 * Undo `createShowProject` when the write that should follow it lost. The
 * production goes first: its project is `restrict`ed while it points there.
 */
export async function deleteShowProject(productionId: string): Promise<void> {
	const [row] = await db
		.select({ projectId: production.projectId })
		.from(production)
		.where(eq(production.id, productionId))
		.limit(1);
	if (!row) return;
	const writes: [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]] = [
		db.delete(production).where(eq(production.id, productionId))
	];
	if (row.projectId) writes.push(db.delete(project).where(eq(project.id, row.projectId)));
	await db.batch(writes);
}
