import { and, asc, eq, isNull, max, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { isUniqueConstraintError } from '$lib/server/db/constraint-errors';
import { project, projectSection, type ProjectSection } from '$lib/server/db/schema/project';
import { workOrder } from '$lib/server/db/schema/volunteer';
import { DomainError } from '$lib/server/domain-error';
import { recordAuditEntry } from '$lib/server/audit/audit-service';

// ---------------------------------------------------------------------------
// Sections: the headings on a project's task list. Deleting one moves its
// work orders to the unlabelled group; nothing here ever deletes a work order.
// Depends on the schema and the audit log only, so the duty-list service can use it too.
// ---------------------------------------------------------------------------

const SECTION_NAME_MAX = 80;

/** How a section name is stored, and so how one is looked up by name. */
export function sectionNameKey(name: string): string {
	return name.trim().slice(0, SECTION_NAME_MAX);
}

export class SectionNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Section not found');
	}
}

export class SectionValidationError extends DomainError {
	readonly httpStatus = 400;
	constructor(message: string) {
		super(message);
	}
}

function validName(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) throw new SectionValidationError('Give the section a name.');
	if (trimmed.length > SECTION_NAME_MAX) {
		throw new SectionValidationError(`Keep the name under ${SECTION_NAME_MAX} characters.`);
	}
	return trimmed;
}

/** Names compare trimmed and case-insensitively: "Prep" and " prep " are one heading. */
const nameKey = (name: string) => sectionNameKey(name).toLowerCase();

function duplicate(name: string): SectionValidationError {
	return new SectionValidationError(`This project already has a section called “${name}”.`);
}

/** Refuses a name another section of the project already has; `except` is the one being renamed. */
async function assertNameFree(projectId: string, name: string, except?: string) {
	const taken = (await listSections(projectId)).some(
		(s) => s.id !== except && nameKey(s.name) === nameKey(name)
	);
	if (taken) throw duplicate(name);
}

export async function listSections(projectId: string): Promise<ProjectSection[]> {
	return db
		.select()
		.from(projectSection)
		.where(eq(projectSection.projectId, projectId))
		.orderBy(asc(projectSection.sortOrder), asc(projectSection.createdAt), asc(projectSection.id));
}

/** The audit subject for a project, labelled with its name as it is now. */
export async function projectSubject(projectId: string) {
	const [row] = await db
		.select({ name: project.name })
		.from(project)
		.where(eq(project.id, projectId))
		.limit(1);
	return { type: 'project' as const, id: projectId, label: row?.name ?? null };
}

/** The section, refused unless it is this project's: both ids come from the client. */
export async function requireSection(
	projectId: string,
	sectionId: string
): Promise<ProjectSection> {
	const [row] = await db
		.select()
		.from(projectSection)
		.where(and(eq(projectSection.id, sectionId), eq(projectSection.projectId, projectId)))
		.limit(1);
	if (!row) throw new SectionNotFoundError();
	return row;
}

async function nextSectionOrder(projectId: string): Promise<number> {
	const [row] = await db
		.select({ last: max(projectSection.sortOrder) })
		.from(projectSection)
		.where(eq(projectSection.projectId, projectId));
	return (row?.last ?? -1) + 1;
}

export async function createSection(projectId: string, name: string): Promise<ProjectSection> {
	const clean = validName(name);
	await assertNameFree(projectId, clean);
	try {
		const [row] = await db
			.insert(projectSection)
			.values({ projectId, name: clean, sortOrder: await nextSectionOrder(projectId) })
			.returning();
		await recordAuditEntry({
			action: 'project.section_created',
			subject: await projectSubject(projectId),
			details: { sectionId: row.id, name: row.name }
		});
		return row;
	} catch (err) {
		// The index is the backstop for two creates racing past the check above.
		if (isUniqueConstraintError(err)) throw duplicate(clean);
		throw err;
	}
}

export async function renameSection(
	projectId: string,
	sectionId: string,
	name: string
): Promise<ProjectSection> {
	const before = await requireSection(projectId, sectionId);
	const clean = validName(name);
	await assertNameFree(projectId, clean, sectionId);
	try {
		const [row] = await db
			.update(projectSection)
			.set({ name: clean, updatedAt: new Date() })
			.where(eq(projectSection.id, sectionId))
			.returning();
		if (before.name !== row.name) {
			await recordAuditEntry({
				action: 'project.section_renamed',
				subject: await projectSubject(projectId),
				details: { sectionId, from: before.name, to: row.name }
			});
		}
		return row;
	} catch (err) {
		if (isUniqueConstraintError(err)) throw duplicate(clean);
		throw err;
	}
}

/** `orderedIds` must name every section of the project exactly once. */
export async function reorderSections(projectId: string, orderedIds: string[]): Promise<void> {
	const current = await listSections(projectId);
	const known = new Set(current.map((s) => s.id));
	if (
		orderedIds.length !== current.length ||
		new Set(orderedIds).size !== orderedIds.length ||
		orderedIds.some((id) => !known.has(id))
	) {
		throw new SectionValidationError('The sections changed while you were moving them. Reload.');
	}
	if (orderedIds.length === 0) return;
	const now = new Date();
	await db.batch(
		orderedIds.map((id, i) =>
			db
				.update(projectSection)
				.set({ sortOrder: i, updatedAt: now })
				.where(eq(projectSection.id, id))
		) as unknown as Parameters<typeof db.batch>[0]
	);
}

/**
 * Delete the heading, keeping its work: they join the end of the unlabelled
 * group in their existing order. Returns how many moved.
 */
export async function deleteSection(projectId: string, sectionId: string): Promise<number> {
	const section = await requireSection(projectId, sectionId);
	const [moving, [unlabelled]] = await Promise.all([
		db
			.select({ id: workOrder.id })
			.from(workOrder)
			.where(eq(workOrder.sectionId, sectionId))
			.orderBy(asc(workOrder.sortOrder), asc(workOrder.createdAt), asc(workOrder.id)),
		db
			.select({ last: max(workOrder.sortOrder) })
			.from(workOrder)
			.where(and(eq(workOrder.projectId, projectId), isNull(workOrder.sectionId)))
	]);
	const base = (unlabelled?.last ?? -1) + 1;
	const now = new Date();
	await db.batch([
		...moving.map((w, i) =>
			db
				.update(workOrder)
				.set({ sectionId: null, sortOrder: base + i, updatedAt: now })
				.where(eq(workOrder.id, w.id))
		),
		db.delete(projectSection).where(eq(projectSection.id, sectionId))
	] as unknown as Parameters<typeof db.batch>[0]);
	await recordAuditEntry({
		action: 'project.section_deleted',
		subject: await projectSubject(projectId),
		details: { sectionId, name: section.name, tasks: moving.length }
	});
	return moving.length;
}

/**
 * The project's sections by name, creating any that do not exist yet: what
 * lets a duty list applied twice land in one "Load-in", not two. Matches the
 * way `createSection` does, so "load-in" reuses "Load-in". Keyed by
 * `sectionNameKey` of each name given.
 */
export async function ensureSections(
	projectId: string,
	names: string[]
): Promise<Map<string, string>> {
	const wanted = [...new Set(names.map(sectionNameKey).filter(Boolean))];
	if (wanted.length === 0) return new Map();
	const existing = await listSections(projectId);
	const have = new Set(existing.map((s) => nameKey(s.name)));
	const base = existing.reduce((m, s) => Math.max(m, s.sortOrder), -1) + 1;
	const missing = [
		...new Map(wanted.filter((n) => !have.has(nameKey(n))).map((n) => [nameKey(n), n])).values()
	];
	if (missing.length > 0) {
		await db.batch(
			missing.map((name, i) =>
				db
					.insert(projectSection)
					.values({ projectId, name, sortOrder: base + i })
					.onConflictDoNothing()
			) as unknown as Parameters<typeof db.batch>[0]
		);
	}
	const byKey = new Map((await listSections(projectId)).map((s) => [nameKey(s.name), s.id]));
	return new Map(
		wanted.flatMap((n) => (byKey.has(nameKey(n)) ? [[n, byKey.get(nameKey(n))!]] : []))
	);
}

/** The next free position in each section of the project; `null` keys the unlabelled group. */
export async function nextTaskOrders(projectId: string): Promise<Map<string | null, number>> {
	const rows = await db
		.select({
			sectionId: workOrder.sectionId,
			last: sql<number>`max(${workOrder.sortOrder})`
		})
		.from(workOrder)
		.where(eq(workOrder.projectId, projectId))
		.groupBy(workOrder.sectionId);
	return new Map(rows.map((r) => [r.sectionId, Number(r.last) + 1]));
}
