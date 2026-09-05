import { z } from 'zod';
import { query, form } from '$app/server';
import { requireCapability } from '$lib/server/authorization';
import { mapDomainError } from '$lib/server/errors';
import { projectStatuses, DEFAULT_TIMEZONE } from '$lib/config';
import { buildDateInTz } from '$lib/server/reservation/timezone';
import { db } from '$lib/server/db';
import { suggestion } from '$lib/server/db/schema/suggestion';
import { asc, eq } from 'drizzle-orm';
import {
	attachToProject,
	createProject,
	detachFromProject,
	getProjectBurn,
	getProjectById,
	listProjectAttachments,
	listCommittees,
	listProjects,
	setProjectStatus,
	startProjectFromSuggestion,
	updateProject
} from '$lib/server/project/project-service';

/**
 * Projects — staff-only, every surface.
 *
 * The member-facing half of this feature is one read-only line on a suggestion
 * the member wrote, and it lives in the suggestions module rather than here.
 * Deciding what the collective spends money on is staff work; a committee
 * window onto its own projects is a later phase, and it reads `group_member`
 * rather than a role.
 */

// ---------------------------------------------------------------------------
// Schemas
//
// Inline, not imported from the table: a `form()` schema is shaped by what the
// *form* sends. An emptied number field is dropped rather than sent as null,
// and `.transform()` or `z.null()` break `fields` inference.
// ---------------------------------------------------------------------------

/** `MoneyField` posts a real number through a hidden sibling, so no coercion. */
const optionalMoney = z.number().int().min(0).optional();
/** A `type="date"` field posts `YYYY-MM-DD`; `calendarDate` anchors it at noon. */
const optionalDate = z.string().optional();
/** A cleared `select` posts `''`, which `.optional()` rejects instead of ignoring. */
const optionalId = z.union([z.literal(''), z.uuid()]).optional();

function calendarDate(value: string | undefined): Date | undefined {
	return value ? buildDateInTz(value, '12:00', DEFAULT_TIMEZONE) : undefined;
}

const projectFields = {
	name: z.string().min(1).max(200),
	description: z.string().max(2000).optional(),
	groupId: optionalId,
	suggestionId: optionalId,
	budgetCents: optionalMoney,
	startsAt: optionalDate,
	endsAt: optionalDate
};

type ProjectFields = z.infer<z.ZodObject<typeof projectFields>>;

/** Dates and ids the form sends as strings, in the shape the service wants. */
function toServiceInput(data: ProjectFields) {
	return {
		name: data.name,
		description: data.description || null,
		groupId: data.groupId || null,
		suggestionId: data.suggestionId || null,
		budgetCents: data.budgetCents ?? null,
		startsAt: calendarDate(data.startsAt) ?? null,
		endsAt: calendarDate(data.endsAt) ?? null
	};
}

const attachableKinds = z.enum([
	'work_order',
	'contractor_job',
	'purchase_order',
	'acquisition',
	'event_listing'
]);

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Suggestions no project answers yet — the pickable half of the board. */
async function listUnansweredSuggestions() {
	return db
		.select({ id: suggestion.id, title: suggestion.title })
		.from(suggestion)
		.where(eq(suggestion.visibility, 'visible'))
		.orderBy(asc(suggestion.title));
}

const projectFilters = z
	.object({
		status: z.enum(projectStatuses).optional(),
		groupId: z.uuid().optional()
	})
	.optional();

/**
 * The index, its filter options, and every project's burn.
 *
 * Burn per row is why this is one query rather than a component asking per
 * card: several awaited remote queries in one page are serial round trips, and
 * past kit 2.64 that shape stops the page rendering entirely.
 */
export const getProjectsPage = query(projectFilters, async (filters) => {
	await requireCapability('project.read');

	const [projects, committees] = await Promise.all([listProjects(filters ?? {}), listCommittees()]);

	const burns = await Promise.all(projects.map((p) => getProjectBurn(p.id)));
	const byName = new Map(committees.map((c) => [c.id, c.name]));

	return {
		committees,
		projects: projects.map((project, i) => ({
			project,
			burn: burns[i],
			committeeName: project.groupId ? (byName.get(project.groupId) ?? null) : null
		}))
	};
});

/** One project: its burn, everything attached to it, and the pickers to change either. */
export const getProjectDetail = query(z.string(), async (id) => {
	await requireCapability('project.read');
	try {
		const [project, burn, attachments, committees, suggestions] = await Promise.all([
			getProjectById(id),
			getProjectBurn(id),
			listProjectAttachments(id),
			listCommittees(),
			listUnansweredSuggestions()
		]);
		return { project, burn, attachments, committees, suggestions };
	} catch (err) {
		mapDomainError(err);
	}
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const createProjectForm = form(z.object(projectFields), async (raw) => {
	// `requireStaff` returns the caller, so the guard and the author are one call.
	const user = await requireCapability('project.manage');
	try {
		const row = await createProject({
			...toServiceInput(raw as ProjectFields),
			createdByUserId: user.id
		});
		void getProjectsPage().refresh();
		return { success: true, id: row.id };
	} catch (err) {
		mapDomainError(err);
	}
});

export const updateProjectForm = form(z.object({ id: z.uuid(), ...projectFields }), async (raw) => {
	await requireCapability('project.manage');
	const { id, ...data } = raw as { id: string } & ProjectFields;
	try {
		await updateProject(id, toServiceInput(data));
		void getProjectDetail(id).refresh();
		void getProjectsPage().refresh();
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

/**
 * Move the project along, and the suggestion it answers with it.
 *
 * Both queries refresh: the detail page reads the project, the index reads it
 * again through `getProjectsPage`, and refreshing only the one the mutation was
 * fired from leaves the other showing the old status until a reload.
 */
export const setProjectStatusForm = form(
	z.object({ id: z.uuid(), status: z.enum(projectStatuses) }),
	async (raw) => {
		await requireCapability('project.manage');
		const { id, status } = raw as { id: string; status: (typeof projectStatuses)[number] };
		try {
			await setProjectStatus(id, status);
			void getProjectDetail(id).refresh();
			void getProjectsPage().refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

/**
 * Commit to a member's suggestion by starting the project that answers it.
 *
 * Lives here rather than in `suggestions.remote.ts` because the write is a
 * project write; the suggestion moving with it is a consequence the service
 * owns. Both pages' queries refresh, since the suggestion's own status changed
 * too and the staff page reads it from the other module.
 */
export const startProjectFromSuggestionForm = form(
	z.object({
		suggestionId: z.uuid(),
		name: z.string().min(1).max(200),
		groupId: optionalId,
		budgetCents: optionalMoney
	}),
	async (raw) => {
		const user = await requireCapability('project.manage');
		const { suggestionId, name, groupId, budgetCents } = raw as {
			suggestionId: string;
			name: string;
			groupId?: string;
			budgetCents?: number;
		};
		try {
			const row = await startProjectFromSuggestion(suggestionId, {
				name,
				groupId: groupId || null,
				budgetCents: budgetCents ?? null,
				createdByUserId: user.id
			});
			void getProjectsPage().refresh();
			return { success: true, id: row.id };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

export const attachToProjectForm = form(
	z.object({ projectId: z.uuid(), kind: attachableKinds, rowId: z.string().min(1) }),
	async (raw) => {
		await requireCapability('project.manage');
		const { projectId, kind, rowId } = raw as {
			projectId: string;
			kind: z.infer<typeof attachableKinds>;
			rowId: string;
		};
		try {
			await attachToProject(kind, rowId.trim(), projectId);
			void getProjectDetail(projectId).refresh();
			void getProjectsPage().refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

export const detachFromProjectForm = form(
	z.object({ projectId: z.uuid(), kind: attachableKinds, rowId: z.string().min(1) }),
	async (raw) => {
		await requireCapability('project.manage');
		const { projectId, kind, rowId } = raw as {
			projectId: string;
			kind: z.infer<typeof attachableKinds>;
			rowId: string;
		};
		try {
			await detachFromProject(kind, rowId);
			void getProjectDetail(projectId).refresh();
			void getProjectsPage().refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);
