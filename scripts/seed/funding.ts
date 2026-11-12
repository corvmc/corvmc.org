import { readdirSync, readFileSync } from 'node:fs';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { project, projectCommittee, projectSection } from '../../src/lib/server/db/schema/project';
import { grantApplication } from '../../src/lib/server/db/schema/grant';
import { sponsorship } from '../../src/lib/server/db/schema/sponsor';
import { group, groupCapability } from '../../src/lib/server/db/schema/group';
import { dutyList, dutyListItem, workOrder } from '../../src/lib/server/db/schema/volunteer';
import type { GrantStage } from '../../src/lib/config';
import { batchInsert, db } from './db';
import { ptDate } from './util';

/**
 * A grant application or sponsorship is a project (#2622). Each seeded one is
 * given its project here, before its own row, which names it.
 */
export async function fundingProjects(
	kind: 'grant' | 'sponsorship',
	rows: { id?: string; title: string; projectId?: string | null }[]
) {
	for (const row of rows) row.projectId = `${row.id}-project`;
	await batchInsert(
		project,
		rows.map((r) => ({ id: r.projectId!, name: r.title, kind }))
	);
}

const MIGRATIONS = new URL('../../migrations/', import.meta.url);

/**
 * The grant templates, from the migration that writes them in production: one
 * copy of their text. The wipe empties them, so the seed runs it again; every
 * statement in it is a no-op the second time.
 */
async function replayTemplateMigration() {
	const folder = readdirSync(MIGRATIONS).find((f) => f.endsWith('_grant_stage_templates'));
	if (!folder) throw new Error('The grant_stage_templates migration is missing.');
	const text = readFileSync(new URL(`${folder}/migration.sql`, MIGRATIONS), 'utf8');
	for (const statement of text.split('--> statement-breakpoint')) {
		if (statement.trim()) await db.run(sql.raw(statement));
	}
}

async function committeeHolding(capability: string) {
	const [row] = await db
		.select({ id: group.id })
		.from(group)
		.innerJoin(groupCapability, eq(groupCapability.groupId, group.id))
		.where(and(eq(group.kind, 'committee'), eq(groupCapability.capability, capability)))
		.limit(1);
	return row?.id ?? null;
}

/** A stage's template copied onto a grant's project, as `applyDutyList` would. */
async function stamp(projectId: string, stage: GrantStage, anchorDay: string, done = 0) {
	const items = await db
		.select({ item: dutyListItem, listId: dutyList.id, anchor: dutyList.anchor })
		.from(dutyListItem)
		.innerJoin(dutyList, eq(dutyList.id, dutyListItem.dutyListId))
		.where(eq(dutyList.grantStage, stage))
		.orderBy(asc(dutyListItem.sortOrder));
	if (items.length === 0) return 0;
	const sectionId = `${projectId}-${stage}`;
	await batchInsert(projectSection, [
		{ id: sectionId, projectId, name: items[0].item.section ?? stage, sortOrder: 0 }
	]);
	// 17:00 in Corvallis, as `grantDayAt`; a template offset is whole days.
	const anchor = new Date(`${anchorDay}T17:00:00-08:00`).getTime();
	await batchInsert(
		workOrder,
		items.map(({ item, listId, anchor: anchorName }, n) => ({
			id: `${sectionId}-${n}`,
			projectId,
			sectionId,
			sortOrder: n,
			title: item.title,
			notes: item.notes,
			volunteerRoleId: item.volunteerRoleId,
			groupId: item.groupId,
			dutyListId: listId,
			anchor: anchorName,
			dueAt: new Date(anchor + (item.dueOffsetMinutes ?? 0) * 60_000),
			resolvedAt: n < done ? new Date() : null
		}))
	);
	return items.length;
}

const day = (offset: number) => ptDate(offset, 12).toISOString().slice(0, 10);

/**
 * The work on the seeded grants and sponsorships, once the committees exist: the
 * Development committee owns every one, the prospect carries its application
 * checklist with two steps done, and the award its own tasks plus two reports,
 * one overdue so the committee's reminder and the late state both render.
 */
export async function seedFundingWork() {
	console.log('Seeding funding work...');
	await replayTemplateMigration();
	const [grantOwner, sponsorOwner] = await Promise.all([
		committeeHolding('grant.manage'),
		committeeHolding('sponsor.manage')
	]);
	const [grants, ships] = await Promise.all([
		db
			.select({ id: grantApplication.id, projectId: grantApplication.projectId })
			.from(grantApplication)
			.where(isNotNull(grantApplication.projectId)),
		db
			.select({ projectId: sponsorship.projectId })
			.from(sponsorship)
			.where(isNotNull(sponsorship.projectId))
	]);
	const owners = [
		...(grantOwner ? grants.map((g) => ({ projectId: g.projectId!, groupId: grantOwner })) : []),
		...(sponsorOwner ? ships.map((s) => ({ projectId: s.projectId!, groupId: sponsorOwner })) : [])
	];
	if (owners.length > 0) {
		await batchInsert(
			projectCommittee,
			owners.map((o) => ({ ...o, role: 'owner' as const }))
		);
	}

	const projectOf = new Map(grants.map((g) => [g.id, g.projectId!]));
	const prospect = projectOf.get('seed-grant-oac');
	const award = projectOf.get('seed-grant-soundproofing');
	let tasks = 0;
	if (prospect) tasks += await stamp(prospect, 'application', day(18), 2);
	if (award) {
		tasks += await stamp(award, 'award', day(-200), 3);
		const reports = [
			['Submit the interim report', day(-3)],
			['Submit the final report', day(195)]
		] as const;
		await batchInsert(
			workOrder,
			reports.map(([title, on], n) => ({
				id: `${award}-report-${n}`,
				projectId: award,
				title,
				groupId: grantOwner,
				sortOrder: 10 + n,
				dueAt: new Date(`${on}T17:00:00-08:00`)
			}))
		);
		tasks += reports.length;
	}
	return { owners: owners.length, tasks };
}
