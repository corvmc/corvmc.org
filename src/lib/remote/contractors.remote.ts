import { z } from 'zod';
import { query } from '$app/server';
import { form } from './_remote';
import { can, requireCapability } from '$lib/server/authorization';
import { mapDomainError } from '$lib/server/errors';
import { getStaffAssetDetail } from './inventory.remote';
import { getStaffShiftPage } from './volunteer.remote';
import { getProjectTaskPage } from './tasks.remote';
import {
	contractorTrades,
	contractorJobStatuses,
	contractorJobViews,
	DEFAULT_TIMEZONE
} from '$lib/config';
import { buildDateInTz } from '$lib/server/reservation/timezone';
import {
	archiveContractor,
	createContractor,
	getContractorById,
	listContractors,
	listLapsingInsurance,
	updateContractor
} from '$lib/server/contractor/contractor-service';
import {
	cancelJob,
	completeJob,
	countJobsByView,
	createJob,
	declineJob,
	listJobs,
	listOverdueJobs,
	markJobNoShow,
	recordInvoice,
	scheduleJob,
	type Engagement
} from '$lib/server/contractor/contractor-job-service';

/**
 * Contractor work — every surface staff-only.
 *
 * There is deliberately no member-facing entry point. A member who finds a
 * broken amp reports damage; deciding that the fix costs money and who to call
 * is a staff judgement, and the invoice on the other side is nobody else's
 * business.
 */

// ---------------------------------------------------------------------------
// Schemas
//
// Declared inline rather than imported from the schema module: a `form()` schema
// is shaped by what the *form* sends, not by what the table holds. An emptied
// number field is dropped rather than sent as null, and `.transform()` or
// `z.null()` break `fields` inference.
// ---------------------------------------------------------------------------

const optionalText = z.string().max(500).optional();
/** `MoneyField` posts a real number through a hidden sibling, so no coercion. */
const optionalMoney = z.number().int().min(0).optional();
/** A `type="date"` field posts `YYYY-MM-DD`; `calendarDate` anchors it at noon. */
const optionalDate = z.string().optional();

/**
 * Noon in the collective's timezone, matching `inventory.remote.ts`. A date with
 * no time is a calendar day, and anchoring it at midnight puts it on the
 * previous day for anybody east of us.
 */
function calendarDate(value: string | undefined): Date | undefined {
	return value ? buildDateInTz(value, '12:00', DEFAULT_TIMEZONE) : undefined;
}

const contractorFields = {
	name: z.string().min(1).max(200),
	trade: z.enum(contractorTrades),
	contactName: optionalText,
	phone: optionalText,
	email: z.union([z.literal(''), z.email()]).optional(),
	website: optionalText,
	licenseNumber: optionalText,
	insuranceExpiresAt: optionalDate,
	notes: z.string().max(2000).optional()
};

const jobFields = {
	contractorId: z.uuid(),
	/** The work order's title: a job made here creates its work order. */
	title: z.string().min(1).max(300),
	// `''` rather than a bare `.optional()`: the "Building work — no unit" option
	// submits an empty string, and `.optional()` rejects that instead of
	// ignoring it, which fails the whole submit rather than the one field.
	assetId: z.union([z.literal(''), z.uuid()]).optional(),
	scheduledFor: optionalDate,
	expectedBackAt: optionalDate,
	quotedCents: optionalMoney,
	notes: z.string().max(2000).optional()
};

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const contractorFilters = z
	.object({
		trade: z.enum(contractorTrades).optional(),
		includeArchived: z.boolean().optional()
	})
	.optional();

export const getContractors = query(contractorFilters, async (filters) => {
	await requireCapability('contractor.read');
	return listContractors(filters ?? {});
});

const jobFilters = z
	.object({
		status: z.enum(contractorJobStatuses).optional(),
		contractorId: z.uuid().optional()
	})
	.optional();

export const getJobs = query(jobFilters, async (filters) => {
	await requireCapability('contractor.read');
	return listJobs(filters ?? {});
});

// ---------------------------------------------------------------------------
// Composed page queries — one load-bearing query per page
// ---------------------------------------------------------------------------

/**
 * The contractor index. The directory and the two things that need chasing,
 * assembled server-side rather than fanned out of the component — several
 * awaited queries in one page are serial round trips, and past kit 2.64 they
 * are also the shape that stops the page rendering.
 */
export const getContractorsPage = query(contractorFilters, async (filters) => {
	await requireCapability('contractor.read');
	const [contractors, lapsing, overdue] = await Promise.all([
		listContractors(filters ?? {}),
		listLapsingInsurance(),
		listOverdueJobs()
	]);
	return { contractors, lapsing, overdue };
});

/** One contractor, with everything they have ever done for us. */
export const getContractorDetail = query(z.string(), async (id) => {
	await requireCapability('contractor.read');
	try {
		const [record, jobs] = await Promise.all([
			getContractorById(id),
			listJobs({ contractorId: id })
		]);
		return { contractor: record, jobs };
	} catch (err) {
		mapDomainError(err);
	}
});

/**
 * Engagements across every work order, one filter at a time, with each filter's
 * count for its tab. Late gets a tab count rather than an alert: the alert
 * repeated the Late tab's rows above whichever tab was open.
 */
export const getJobsPage = query(
	z.object({ view: z.enum(contractorJobViews).optional() }).optional(),
	async (input) => {
		await requireCapability('contractor.read');
		const now = new Date();
		const [jobs, counts, contractors] = await Promise.all([
			listJobs({ view: input?.view ?? 'open', now }),
			countJobsByView(now),
			listContractors()
		]);
		return { jobs, counts, contractors };
	}
);

/** The page is keyed by its filter, and a mutation can move a job between any of them. */
function refreshJobsPage() {
	for (const view of contractorJobViews) void getJobsPage({ view }).refresh();
}

/** The engagement's own card lives on its work order's page, whichever route that is. */
async function refreshWorkOrderPage(job: { workOrderId: string; projectId: string | null }) {
	if (!job.projectId) return getStaffShiftPage(job.workOrderId).refresh();
	// The task page's guard is the project's; a caller without it is not looking at it.
	if (await can('project.read')) {
		return getProjectTaskPage({ projectId: job.projectId, workOrderId: job.workOrderId }).refresh();
	}
}

// ---------------------------------------------------------------------------
// Contractor mutations
// ---------------------------------------------------------------------------

export const createContractorForm = form(z.object(contractorFields), async (raw) => {
	await requireCapability('contractor.manage');
	const data = raw as z.infer<z.ZodObject<typeof contractorFields>>;
	try {
		const record = await createContractor({
			...data,
			email: data.email || null,
			insuranceExpiresAt: calendarDate(data.insuranceExpiresAt) ?? null
		});
		void getContractorsPage().refresh();
		return { success: true, id: record.id };
	} catch (err) {
		mapDomainError(err);
	}
});

export const updateContractorForm = form(
	z.object({ id: z.uuid(), ...contractorFields }),
	async (raw) => {
		await requireCapability('contractor.manage');
		const { id, ...data } = raw as { id: string } & z.infer<z.ZodObject<typeof contractorFields>>;
		try {
			await updateContractor(id, {
				...data,
				email: data.email || null,
				insuranceExpiresAt: calendarDate(data.insuranceExpiresAt) ?? null
			});
			void getContractorDetail(id).refresh();
			void getContractorsPage().refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

export const archiveContractorForm = form(
	z.object({ id: z.uuid(), archived: z.boolean().optional().default(false) }),
	async (raw) => {
		await requireCapability('contractor.manage');
		const { id, archived } = raw as { id: string; archived: boolean };
		try {
			await archiveContractor(id, archived);
			void getContractorDetail(id).refresh();
			void getContractorsPage().refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

// ---------------------------------------------------------------------------
// Job mutations
// ---------------------------------------------------------------------------

export const createJobForm = form(z.object(jobFields), async (raw) => {
	const actor = await requireCapability('contractor.manage');
	const data = raw as z.infer<z.ZodObject<typeof jobFields>>;
	try {
		const job = await createJob({
			contractorId: data.contractorId,
			title: data.title,
			assetId: data.assetId || null,
			scheduledFor: calendarDate(data.scheduledFor) ?? null,
			expectedBackAt: calendarDate(data.expectedBackAt) ?? null,
			quotedCents: data.quotedCents ?? null,
			notes: data.notes ?? null,
			requestedByUserId: actor.id
		});
		refreshJobsPage();
		if (job.assetId) void getStaffAssetDetail(job.assetId).refresh();
		return { success: true, id: job.id };
	} catch (err) {
		mapDomainError(err);
	}
});

export const scheduleJobForm = form(
	z.object({
		id: z.uuid(),
		scheduledFor: optionalDate,
		expectedBackAt: optionalDate
	}),
	async (raw) => {
		const actor = await requireCapability('contractor.manage');
		const data = raw as { id: string; scheduledFor?: string; expectedBackAt?: string };
		try {
			const job = await scheduleJob(data.id, {
				scheduledFor: calendarDate(data.scheduledFor),
				expectedBackAt: calendarDate(data.expectedBackAt),
				actorId: actor.id
			});
			await refreshWorkOrderPage(job);
			refreshJobsPage();
			if (job.assetId) void getStaffAssetDetail(job.assetId).refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

export const completeJobForm = form(
	z.object({
		id: z.uuid(),
		completedAt: optionalDate,
		costCents: optionalMoney,
		invoiceRef: optionalText,
		// Unchecked boxes are not submitted at all, so a required boolean fails
		// every time it is left off. Default false and invert the meaning: the
		// staffer ticks the exception, which is the repair that did not take.
		leaveOutOfService: z.boolean().optional().default(false),
		// Same shape, same reason. A donated job is a contributed service: the
		// value is what it would have cost, and it never reaches cash spend.
		isDonated: z.boolean().optional().default(false),
		fairValueCents: optionalMoney,
		fairValueBasis: optionalText
	}),
	async (raw) => {
		const actor = await requireCapability('contractor.manage');
		const data = raw as {
			id: string;
			completedAt?: string;
			costCents?: number;
			invoiceRef?: string;
			leaveOutOfService: boolean;
			isDonated: boolean;
			fairValueCents?: number;
			fairValueBasis?: string;
		};
		try {
			const job = await completeJob(data.id, {
				completedAt: calendarDate(data.completedAt),
				costCents: data.costCents ?? null,
				invoiceRef: data.invoiceRef ?? null,
				returnToService: !data.leaveOutOfService,
				isDonated: data.isDonated,
				fairValueCents: data.fairValueCents ?? null,
				fairValueBasis: data.fairValueBasis ?? null,
				actorId: actor.id
			});
			await refreshWorkOrderPage(job);
			refreshJobsPage();
			if (job.assetId) void getStaffAssetDetail(job.assetId).refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

export const cancelJobForm = form(z.object({ id: z.uuid() }), async (raw) => {
	await requireCapability('contractor.manage');
	const { id } = raw as { id: string };
	try {
		const job = await cancelJob(id);
		await refreshWorkOrderPage(job);
		refreshJobsPage();
		if (job.assetId) void getStaffAssetDetail(job.assetId).refresh();
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

/** Two terminal endings with nobody's work done; neither touches the unit. */
function closeJobForm(close: (id: string) => Promise<Engagement>) {
	return form(z.object({ id: z.uuid() }), async (raw) => {
		await requireCapability('contractor.manage');
		const { id } = raw as { id: string };
		try {
			const job = await close(id);
			await refreshWorkOrderPage(job);
			refreshJobsPage();
			if (job.assetId) void getStaffAssetDetail(job.assetId).refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	});
}

export const declineJobForm = closeJobForm(declineJob);
export const noShowJobForm = closeJobForm(markJobNoShow);

export const recordInvoiceForm = form(
	z.object({
		id: z.uuid(),
		costCents: optionalMoney,
		invoiceRef: optionalText,
		paidAt: optionalDate
	}),
	async (raw) => {
		await requireCapability('contractor.recordInvoice');
		const data = raw as { id: string; costCents?: number; invoiceRef?: string; paidAt?: string };
		try {
			const job = await recordInvoice(data.id, {
				costCents: data.costCents ?? null,
				invoiceRef: data.invoiceRef ?? null,
				paidAt: calendarDate(data.paidAt) ?? null
			});
			await refreshWorkOrderPage(job);
			refreshJobsPage();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);
