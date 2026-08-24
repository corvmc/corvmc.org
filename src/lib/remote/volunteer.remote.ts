import { z } from 'zod';
import { error, redirect } from '@sveltejs/kit';
import { query, form } from '$app/server';
import { requireStaff, requireUser } from '$lib/server/authorization';
import { getVolunteerProfile } from '$lib/server/volunteer/volunteer-profile-service';
import { listInterestsForUser } from '$lib/server/volunteer/volunteer-interest-service';
import { listSignupsForUser } from '$lib/server/volunteer/volunteer-signup-service';
import { requireFeature } from '$lib/server/feature-flags';
import { mapDomainError } from '$lib/server/errors';
import { renderMarkdown } from '$lib/utils/markdown';
import {
	createVolunteerRole as createRoleService,
	updateVolunteerRole as updateRoleService,
	archiveVolunteerRole as archiveRoleService,
	restoreVolunteerRole as restoreRoleService,
	deleteVolunteerRole as deleteRoleService,
	listVolunteerRoles
} from '$lib/server/volunteer/volunteer-role-service';
import {
	submitHours,
	updateHourLog,
	withdrawHourLog,
	approveHourLog,
	rejectHourLog,
	listHourLogs,
	listUserHourLogs,
	getStatusCounts,
	getUserHourSummary
} from '$lib/server/volunteer/hour-log-service';
import {
	getVolunteerTotals,
	getHoursByMember,
	getHoursByRole,
	getHoursByMonth
} from '$lib/server/volunteer/volunteer-report-service';
import {
	getInterestsForUser,
	setInterests,
	listInterestedMembers,
	countInterestsByRole
} from '$lib/server/volunteer/volunteer-interest-service';
import {
	completeVolunteerOnboarding,
	updateVolunteerProfile as updateProfileService,
	setAvailability,
	approveMinorVolunteer,
	getVolunteerOnboarding,
	listBlockedVolunteers,
	stageOf,
	type OnboardingStage
} from '$lib/server/volunteer/volunteer-profile-service';
import {
	createCertification as createCertificationService,
	updateCertification as updateCertificationService,
	archiveCertification as archiveCertificationService,
	restoreCertification as restoreCertificationService,
	deleteCertification as deleteCertificationService,
	listCertifications,
	getRequirementsForRole,
	getRequirementsForRoles,
	setRoleRequirements
} from '$lib/server/volunteer/volunteer-certification-service';
import {
	createShift as createShiftService,
	duplicateShift as duplicateShiftService,
	updateShift as updateShiftService,
	cancelShift as cancelShiftService,
	listShifts,
	countUnfilledByRole,
	listOpenShiftsForMember,
	getShiftDetail
} from '$lib/server/volunteer/volunteer-shift-service';
import {
	claimShift as claimShiftService,
	cancelSignup as cancelSignupService,
	confirmSignup as confirmSignupService,
	markNoShow as markNoShowService,
	listClaimants,
	listUnloggedCompletions
} from '$lib/server/volunteer/volunteer-signup-service';
import {
	submitFeedback as submitFeedbackService,
	getFeedbackContext,
	listFeedbackForShift,
	summarizeFeedbackByRole
} from '$lib/server/volunteer/volunteer-feedback-service';
import {
	grantCertification as grantCertificationService,
	revokeCertification as revokeCertificationService,
	deleteCertificationRecord,
	listForUser as listCertificationsForUser,
	listClearances,
	listHeldForGate,
	listHeldForGateMany,
	missingFrom,
	missingRequirements,
	flagUnclearedLogs
} from '$lib/server/volunteer/member-certification-service';
import {
	volunteerHourStatuses,
	volunteerRoleGroups,
	CERT_DESCRIPTION_MAX,
	CERT_NAME_MAX,
	CERT_NOTES_MAX,
	CERT_REFERENCE_MAX,
	CERT_REVOKED_REASON_MAX,
	VOLUNTEER_SHIFT_NOTES_MAX,
	SHIFT_FEEDBACK_COMMENT_MAX,
	VOLUNTEER_AVAILABILITY_MAX,
	VOLUNTEER_DESCRIPTION_MAX,
	VOLUNTEER_MAX_INTERESTS,
	VOLUNTEER_NAME_MAX,
	VOLUNTEER_REVIEW_NOTES_MAX,
	VOLUNTEER_ROLE_DESCRIPTION_MAX,
	VOLUNTEER_ROLE_NAME_MAX
} from '$lib/config';
import type { VolunteerHourStatus } from '$lib/server/db/schema/volunteer';

// Hours come off the form as a decimal (0.25 steps) and are stored as integer
// minutes. One place does the conversion so the two can't drift.
function hoursToMinutes(hours: string | number): number {
	const parsed = typeof hours === 'number' ? hours : parseFloat(hours);
	if (!Number.isFinite(parsed)) error(400, 'Enter how long you worked');
	return Math.round(parsed * 60);
}

function asStatus(raw: string | undefined): VolunteerHourStatus | undefined {
	return volunteerHourStatuses.includes(raw as VolunteerHourStatus)
		? (raw as VolunteerHourStatus)
		: undefined;
}

// ---------------------------------------------------------------------------
// Queries — Staff
// ---------------------------------------------------------------------------
// Staff functions guard with requireStaff() and deliberately do NOT check the
// feature flag: flags gate the member, band and public surfaces only, so staff
// can set up roles and work the queue before volunteering is switched on for
// everyone — and keep administering it if it is switched back off (#171).
// The member functions below do check it.

const staffLogFilters = z.object({
	status: z.string().optional(),
	volunteerRoleId: z.string().optional(),
	search: z.string().optional(),
	from: z.string().optional(),
	to: z.string().optional(),
	page: z.number().optional()
});

export const getStaffVolunteerLogs = query(staffLogFilters, async (f) => {
	await requireStaff();
	const result = await listHourLogs(
		{
			status: asStatus(f.status),
			volunteerRoleId: f.volunteerRoleId || undefined,
			search: f.search || undefined,
			from: f.from || undefined,
			to: f.to || undefined
		},
		{ page: f.page ?? 1, pageSize: 50 }
	);

	// Advisory only: flags a log whose role required a clearance the member did
	// not hold on the date worked. It never blocks approval — refusing the hours
	// would not un-do the work, it would just lose the record. Flagged for the
	// page in view, so the cost is one extra pair of queries per page load.
	const uncleared = await flagUnclearedLogs(
		result.rows.map((r) => ({
			id: r.id,
			userId: r.userId,
			volunteerRoleId: r.volunteerRoleId,
			workedOn: r.workedOn
		}))
	);

	return {
		...result,
		rows: result.rows.map((r) => ({ ...r, uncleared: uncleared.has(r.id) }))
	};
});

export const getVolunteerStatusCounts = query(async () => {
	await requireStaff();
	return getStatusCounts();
});

/**
 * Staff view of the role list — includes archived roles, and each role's
 * required certifications, interest count, and count of upcoming shifts still
 * short of capacity, so the table can render them without a query per row.
 */
export const getVolunteerRoles = query(async () => {
	await requireStaff();
	const roles = await listVolunteerRoles({ includeInactive: true });
	const [requirements, interestCounts, unfilled] = await Promise.all([
		getRequirementsForRoles(roles.map((r) => r.id)),
		countInterestsByRole(),
		countUnfilledByRole()
	]);

	const interested = new Map(interestCounts.map((c) => [c.roleId, c.interested]));

	return roles.map((r) => ({
		...r,
		requiredCertifications: requirements.get(r.id) ?? [],
		interested: interested.get(r.id) ?? 0,
		unfilled: unfilled.get(r.id) ?? 0
	}));
});

/**
 * One role, for its detail page.
 *
 * Reuses the list rather than adding a per-role query: it is the only thing that
 * carries `logCount`, and a dozen rows is cheaper to filter than a second SQL
 * path is to maintain. Requirements stay out of here — the page reads them from
 * `getRoleRequirements`, which `setRoleCertifications` already refreshes.
 */
export const getVolunteerRoleDetail = query(z.string(), async (id) => {
	await requireStaff();
	const role = (await listVolunteerRoles({ includeInactive: true })).find((r) => r.id === id);
	if (!role) error(404, 'Role not found');
	return role;
});

const interestFilters = z.object({
	volunteerRoleId: z.string().optional(),
	search: z.string().optional(),
	page: z.number().optional()
});

/**
 * Who has said they'd help, and with what.
 *
 * Filtered to one role, each member also carries what they'd still need before
 * they could claim a shift for it — the difference between twelve names and the
 * three a coordinator can actually roster. Two extra queries for the whole page
 * (the role's requirements, then everyone's certification rows) rather than the
 * two per member `missingRequirements` would cost; the same shape `getOpenShifts`
 * uses for the member shift board.
 */
export const getInterestedVolunteers = query(interestFilters, async (f) => {
	await requireStaff();

	const roleId = f.volunteerRoleId || undefined;
	const result = await listInterestedMembers(
		{ roleId, search: f.search || undefined },
		{ page: f.page ?? 1, pageSize: 50 }
	);

	if (!roleId || result.rows.length === 0) {
		return { ...result, rows: result.rows.map((m) => ({ ...m, missing: [] })), gated: false };
	}

	const required = await getRequirementsForRole(roleId);
	if (required.length === 0) {
		// `gated: false` so the page can drop the readiness column outright — a role
		// that needs no clearance shouldn't grow a row of meaningless ticks.
		return { ...result, rows: result.rows.map((m) => ({ ...m, missing: [] })), gated: false };
	}

	const held = await listHeldForGateMany(result.rows.map((m) => m.userId));
	const now = new Date();

	return {
		...result,
		gated: true,
		rows: result.rows.map((m) => ({
			...m,
			missing: missingFrom(required, held.get(m.userId) ?? [], now)
		}))
	};
});

/**
 * Under-18 signups waiting on a person.
 *
 * Argless, so the approve form below can refresh it server-side — unlike the
 * arg-keyed queue queries, which the page has to refresh itself.
 */
export const getBlockedVolunteers = query(async () => {
	await requireStaff();
	return listBlockedVolunteers();
});

/** Staff clearing a minor to volunteer. Leaves `isAdult` alone — see the service. */
export const approveVolunteerSignup = form(
	z.object({ userId: z.string().min(1) }),
	async (data) => {
		const staff = await requireStaff();

		try {
			await approveMinorVolunteer(data.userId, staff.id);
		} catch (err) {
			mapDomainError(err);
		}

		await getBlockedVolunteers().refresh();
		return { success: true };
	}
);

const reportRange = z.object({
	from: z.string().optional(),
	to: z.string().optional()
});

export const getVolunteerReport = query(reportRange, async (range) => {
	await requireStaff();

	const [totals, byRole, byMonth] = await Promise.all([
		getVolunteerTotals(range),
		getHoursByRole(range),
		getHoursByMonth(range)
	]);

	return { totals, byRole, byMonth };
});

export const getVolunteerReportByMember = query(
	reportRange.extend({ page: z.number().optional() }),
	async (r) => {
		await requireStaff();
		return getHoursByMember({ from: r.from, to: r.to }, { page: r.page ?? 1, pageSize: 50 });
	}
);

// ---------------------------------------------------------------------------
// Queries — Member
// ---------------------------------------------------------------------------

/**
 * Member view of the role list — live roles only, with job descriptions.
 *
 * The description is authored as markdown and rendered here rather than in the
 * component: `sanitizeBio` only sanitizes HTML, so passing markdown through it
 * left `**bold**` on the page as literal asterisks. Rendering server-side also
 * keeps `marked` and `xss` out of the client bundle.
 */
export const getActiveVolunteerRoles = query(async () => {
	await requireFeature('volunteering');
	requireUser();
	const roles = await listVolunteerRoles();
	return roles.map((r) => ({
		id: r.id,
		name: r.name,
		group: r.group,
		descriptionHtml: r.description ? renderMarkdown(r.description) : null
	}));
});

/** Role ids the member has ticked, for rendering their own interest form. */
export const getMyVolunteerInterests = query(async () => {
	await requireFeature('volunteering');
	const currentUser = requireUser();
	return getInterestsForUser(currentUser.id);
});

export const getMyVolunteerHours = query(async () => {
	await requireFeature('volunteering');
	const currentUser = requireUser();
	return listUserHourLogs(currentUser.id);
});

export const getMyVolunteerSummary = query(async () => {
	await requireFeature('volunteering');
	const currentUser = requireUser();
	return getUserHourSummary(currentUser.id);
});

// ---------------------------------------------------------------------------
// Onboarding — queries and gates
// ---------------------------------------------------------------------------
// Before anybody claims a shift we need their name and, above all, whether they
// are 18 or older. The gate is three routes, and each one is guarded by its own
// query throwing a redirect — the pattern getMemberLayout uses, since this app
// has no +layout.server.ts anywhere.
//
// `getMyVolunteerOnboarding` is deliberately NOT one of them. Every gated route
// needs the same data, so if the shared query redirected, /member/volunteer/start
// would bounce itself in a loop. It stays pure; the gates wrap it.
// ---------------------------------------------------------------------------

/** Split a display name for prefill. A guess, and the fields are editable. */
function splitName(name: string): { firstName: string; lastName: string } {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return { firstName: '', lastName: '' };
	const [first, ...rest] = parts;
	return { firstName: first, lastName: rest.join(' ') };
}

async function loadOnboarding() {
	await requireFeature('volunteering');
	const currentUser = requireUser();
	const { profile, account } = await getVolunteerOnboarding(currentUser.id);
	const fallback = splitName(account.name);

	return {
		stage: stageOf(profile),
		firstName: profile?.firstName ?? fallback.firstName,
		lastName: profile?.lastName ?? fallback.lastName,
		availability: profile?.availability ?? '',
		// The login address. Shown so they can check it, changed elsewhere.
		email: account.email,
		pronouns: account.pronouns ?? '',
		phone: account.phone ?? ''
	};
}

export const getMyVolunteerOnboarding = query(loadOnboarding);

/**
 * Send a member to wherever they actually belong in the flow. `allow` is the set
 * of stages the calling route is for; anything else redirects.
 */
function gate(stage: OnboardingStage, allow: OnboardingStage[]): void {
	if (allow.includes(stage)) return;
	if (stage === 'none') redirect(302, '/member/volunteer/start');
	if (stage === 'blocked') redirect(302, '/member/volunteer/blocked');
	redirect(302, '/member/volunteer');
}

export const getVolunteerStartStep = query(async () => {
	const data = await loadOnboarding();
	gate(data.stage, ['none']);
	return data;
});

export const getVolunteerInterestsStep = query(async () => {
	const data = await loadOnboarding();
	gate(data.stage, ['active']);
	return data;
});

export const getVolunteerBlockedNotice = query(async () => {
	const data = await loadOnboarding();
	gate(data.stage, ['blocked']);
	return data;
});

/** /member/volunteer's own gate, and the data behind its two header modals. */
export const getMyVolunteerAccess = query(async () => {
	const data = await loadOnboarding();
	gate(data.stage, ['active']);
	return data;
});

// ---------------------------------------------------------------------------
// Onboarding — forms
// ---------------------------------------------------------------------------

const profileFieldsSchema = z.object({
	firstName: z
		.string()
		.min(1, 'Enter your first name')
		.max(VOLUNTEER_NAME_MAX, `Keep this under ${VOLUNTEER_NAME_MAX} characters`),
	lastName: z
		.string()
		.min(1, 'Enter your last name')
		.max(VOLUNTEER_NAME_MAX, `Keep this under ${VOLUNTEER_NAME_MAX} characters`),
	pronouns: z.string().max(50, 'Keep pronouns under 50 characters').optional().default(''),
	phone: z.string().max(30, 'Keep this under 30 characters').optional().default('')
});

/**
 * The age answer is a two-value select, never a checkbox.
 *
 * FormField gives a checkbox a `b:` name prefix, and an unticked box submits
 * nothing at all — so "I am under 18" and "I did not answer" arrive identically.
 * Whichever way the default fell, it would either block every adult or unblock
 * every minor.
 */
const onboardingSchema = profileFieldsSchema.extend({
	isAdult: z.enum(['yes', 'no'], { message: 'Let us know whether you are 18 or older' })
});

export const startVolunteerOnboarding = form(onboardingSchema, async (data) => {
	await requireFeature('volunteering');
	const currentUser = requireUser();

	let status: string;
	try {
		const profile = await completeVolunteerOnboarding(currentUser.id, {
			firstName: data.firstName,
			lastName: data.lastName,
			isAdult: data.isAdult === 'yes',
			pronouns: data.pronouns,
			phone: data.phone
		});
		status = profile.status;
	} catch (err) {
		mapDomainError(err);
	}

	// Before the redirect, which throws.
	await getMyVolunteerOnboarding().refresh();

	redirect(303, status === 'blocked' ? '/member/volunteer/blocked' : '/member/volunteer/interests');
});

/** The Profile modal. No `isAdult` — see updateVolunteerProfile in the service. */
export const updateVolunteerProfile = form(profileFieldsSchema, async (data) => {
	await requireFeature('volunteering');
	const currentUser = requireUser();

	try {
		await updateProfileService(currentUser.id, data);
	} catch (err) {
		mapDomainError(err);
	}

	await Promise.all([getMyVolunteerOnboarding().refresh(), getMyVolunteerAccess().refresh()]);
	return { success: true };
});

// ---------------------------------------------------------------------------
// Forms — Hour logs (member)
// ---------------------------------------------------------------------------

// Messages are supplied on every user-facing rule: the field-level zod error is
// what the form renders, and the default reads "Too small: expected string to
// have >=1 characters".
const hoursFormSchema = z.object({
	volunteerRoleId: z.string().min(1, 'Pick what you helped with'),
	// Present when the log comes from a completed shift's pre-fill; staff see
	// those marked as scheduled in the queue and can approve with less scrutiny.
	shiftId: z.string().optional(),
	workedOn: z.string().min(1, 'Pick the date you worked'),
	hours: z.string().min(1, 'Enter how long you worked'),
	description: z
		.string()
		.min(1, 'Describe what you worked on')
		.max(VOLUNTEER_DESCRIPTION_MAX, `Keep this under ${VOLUNTEER_DESCRIPTION_MAX} characters`)
});

export const submitVolunteerHours = form(hoursFormSchema, async (data) => {
	await requireFeature('volunteering');
	const currentUser = requireUser();

	try {
		await submitHours(currentUser.id, {
			volunteerRoleId: data.volunteerRoleId,
			workedOn: data.workedOn,
			minutes: hoursToMinutes(data.hours),
			description: data.description,
			shiftId: data.shiftId || null
		});
	} catch (err) {
		mapDomainError(err);
	}

	await refreshMemberViews();
	return { success: true };
});

/**
 * Save the member's whole interest set.
 *
 * The checkbox group posts nothing at all when every box is unchecked, so
 * `roleIds` defaults to an empty array rather than failing validation — clearing
 * the list is a legitimate thing to want, and a form that silently refused to
 * would be worse than one that never offered the boxes.
 */
export const saveVolunteerInterests = form(
	z.object({
		roleIds: z.array(z.string().min(1)).max(VOLUNTEER_MAX_INTERESTS).default([]),
		availability: z
			.string()
			.max(VOLUNTEER_AVAILABILITY_MAX, `Keep this under ${VOLUNTEER_AVAILABILITY_MAX} characters`)
			.optional()
			.default('')
	}),
	async (data) => {
		await requireFeature('volunteering');
		const currentUser = requireUser();

		try {
			await setInterests(currentUser.id, data.roleIds);
			// Availability lives on the profile, not the join table — it describes the
			// person, not the role. Same form, two services.
			await setAvailability(currentUser.id, data.availability || null);
		} catch (err) {
			mapDomainError(err);
		}

		await Promise.all([getMyVolunteerInterests().refresh(), getMyVolunteerAccess().refresh()]);
		// No redirect: this form is shared by the onboarding step and the modal on
		// /member/volunteer, and only the step wants to navigate. It does that itself.
		return { success: true };
	}
);

export const editVolunteerHours = form(
	hoursFormSchema.extend({ id: z.string().min(1) }),
	async (data) => {
		await requireFeature('volunteering');
		const currentUser = requireUser();

		try {
			await updateHourLog(data.id, currentUser.id, {
				volunteerRoleId: data.volunteerRoleId,
				workedOn: data.workedOn,
				minutes: hoursToMinutes(data.hours),
				description: data.description
			});
		} catch (err) {
			mapDomainError(err);
		}

		await refreshMemberViews();
		return { success: true };
	}
);

export const withdrawVolunteerHours = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireFeature('volunteering');
	const currentUser = requireUser();

	try {
		await withdrawHourLog(data.id, currentUser.id);
	} catch (err) {
		mapDomainError(err);
	}

	await refreshMemberViews();
	return { success: true };
});

// ---------------------------------------------------------------------------
// Forms — Review (staff)
// ---------------------------------------------------------------------------

export const approveVolunteerHours = form(
	z.object({
		id: z.string().min(1),
		notes: z.string().max(VOLUNTEER_REVIEW_NOTES_MAX).optional()
	}),
	async (data) => {
		const staff = await requireStaff();

		try {
			await approveHourLog(data.id, staff.id, data.notes);
		} catch (err) {
			mapDomainError(err);
		}

		await refreshStaffQueue();
		return { success: true };
	}
);

export const rejectVolunteerHours = form(
	z.object({
		id: z.string().min(1),
		notes: z
			.string()
			.min(1, 'Give the member a reason so they can correct and resubmit')
			.max(VOLUNTEER_REVIEW_NOTES_MAX, `Keep this under ${VOLUNTEER_REVIEW_NOTES_MAX} characters`)
	}),
	async (data) => {
		const staff = await requireStaff();

		try {
			await rejectHourLog(data.id, staff.id, data.notes);
		} catch (err) {
			mapDomainError(err);
		}

		await refreshStaffQueue();
		return { success: true };
	}
);

// ---------------------------------------------------------------------------
// Forms — Roles (staff)
// ---------------------------------------------------------------------------

/**
 * A number field reaches here two ways. Registered through `field.as('number')`
 * — how the role detail page binds them — it posts a real number; posted by name
 * from the create modal it arrives as a string. Cleared, it is `''`, `null`, or
 * `NaN` depending on which path. So: `undefined` means the form didn't carry the
 * field, `null` means "cleared", and anything else is a number for the service to
 * range-check.
 */
const optionalNumber = z.union([z.string(), z.number()]).optional();

/**
 * `undefined` (field absent) and `null` (cleared) are different answers, so this
 * keeps them apart rather than collapsing both to a falsy number. Kept out of the
 * schema deliberately: a `.transform()` there makes the object a ZodEffects and
 * SvelteKit's `form()` stops inferring `fields`.
 */
function optionalCount(raw: string | number | null | undefined): number | null | undefined {
	if (raw === undefined) return undefined;
	if (raw === null || raw === '') return null;
	const n = Number(raw);
	return Number.isNaN(n) ? null : n;
}

const roleFormSchema = z.object({
	name: z
		.string()
		.min(1, 'Give the role a name')
		.max(VOLUNTEER_ROLE_NAME_MAX, `Keep the name under ${VOLUNTEER_ROLE_NAME_MAX} characters`),
	description: z
		.string()
		.max(
			VOLUNTEER_ROLE_DESCRIPTION_MAX,
			`Keep the description under ${VOLUNTEER_ROLE_DESCRIPTION_MAX} characters`
		)
		.optional(),
	group: z.enum(volunteerRoleGroups).optional(),
	displayOrder: optionalNumber,
	isActive: z.string().optional(),
	// Blank means "no default", not zero. Range-checked in the service.
	defaultDurationMinutes: optionalNumber,
	defaultCapacity: optionalNumber
});

export const createVolunteerRole = form(roleFormSchema, async (data) => {
	await requireStaff();

	try {
		await createRoleService({
			name: data.name,
			description: data.description,
			group: data.group,
			displayOrder: optionalCount(data.displayOrder) ?? 0,
			isActive: data.isActive !== 'false',
			defaultDurationMinutes: optionalCount(data.defaultDurationMinutes),
			defaultCapacity: optionalCount(data.defaultCapacity)
		});
	} catch (err) {
		mapDomainError(err);
	}

	void getVolunteerRoles().refresh();
	void getActiveVolunteerRoles().refresh();
	return { success: true };
});

export const updateVolunteerRole = form(
	roleFormSchema.extend({ id: z.string().min(1) }),
	async (data) => {
		await requireStaff();

		try {
			await updateRoleService(data.id, {
				name: data.name,
				description: data.description ?? '',
				group: data.group,
				// A cleared display order falls back to 0 rather than being skipped —
				// the column is NOT NULL and "no order" has always meant first.
				displayOrder: optionalCount(data.displayOrder) ?? undefined,
				isActive: data.isActive !== 'false',
				defaultDurationMinutes: optionalCount(data.defaultDurationMinutes),
				defaultCapacity: optionalCount(data.defaultCapacity)
			});
		} catch (err) {
			mapDomainError(err);
		}

		await refreshRoleViews(data.id);
		return { success: true };
	}
);

export const archiveVolunteerRole = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireStaff();

	try {
		await archiveRoleService(data.id);
	} catch (err) {
		mapDomainError(err);
	}

	await refreshRoleViews(data.id);
	return { success: true };
});

export const restoreVolunteerRole = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireStaff();

	try {
		await restoreRoleService(data.id);
	} catch (err) {
		mapDomainError(err);
	}

	await refreshRoleViews(data.id);
	return { success: true };
});

export const deleteVolunteerRole = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireStaff();

	try {
		await deleteRoleService(data.id);
	} catch (err) {
		mapDomainError(err);
	}

	await refreshRoleViews();
	return { success: true };
});

// ---------------------------------------------------------------------------
// Refresh helpers
// ---------------------------------------------------------------------------

async function refreshMemberViews() {
	await Promise.all([
		getMyVolunteerHours().refresh(),
		getMyVolunteerSummary().refresh(),
		// Logging against a shift clears it from the "log your hours" prompt.
		getUnloggedShifts().refresh()
	]);
}

/**
 * Only the argless queries can be refreshed from here. `refresh()` is keyed by
 * argument, so `getStaffVolunteerLogs({})` refreshes the empty-filter instance
 * — never the `{ status: 'pending', page: 1 }` one the queue page actually
 * subscribes to. Arg-keyed queries are refreshed by the page, which is the only
 * place that knows its own filters; see the `onsuccess` handlers on
 * /staff/volunteer and the mount refresh on /staff/volunteer/report.
 */
async function refreshStaffQueue() {
	await getVolunteerStatusCounts().refresh();
}

// Role edits change the member picker, the staff table (log counts included),
// and the report's role names all at once.
//
// `roleId` opts the detail page in. It is arg-keyed, so it can only be refreshed
// where the id is known — which is here, unlike the filter-keyed queue queries
// the comment above describes. Deleting a role leaves it out: refreshing a
// detail query for a row that no longer exists just fetches a 404 behind the
// redirect the page is already making.
async function refreshRoleViews(roleId?: string) {
	await Promise.all([
		getVolunteerRoles().refresh(),
		getActiveVolunteerRoles().refresh(),
		...(roleId ? [getVolunteerRoleDetail(roleId).refresh()] : [])
	]);
}

// ---------------------------------------------------------------------------
// Certifications
// ---------------------------------------------------------------------------

/** Staff view of the catalog — includes archived entries. */
export const getCertifications = query(async () => {
	await requireStaff();
	return listCertifications({ includeInactive: true });
});

/** Live catalog entries, for the grant form and the role requirements picker. */
export const getActiveCertifications = query(async () => {
	await requireStaff();
	return listCertifications();
});

export const getMemberCertifications = query(z.string(), async (userId) => {
	await requireStaff();
	return listCertificationsForUser(userId);
});

/** The member's own — what they hold, and what it unlocks. */
export const getMyCertifications = query(async () => {
	await requireFeature('volunteering');
	const currentUser = requireUser();
	return listCertificationsForUser(currentUser.id);
});

const clearanceFilters = z.object({
	certificationId: z.string().optional(),
	state: z.enum(['current', 'expiring', 'expired', 'revoked']).optional()
});

export const getClearances = query(clearanceFilters, async (f) => {
	await requireStaff();
	return listClearances({
		certificationId: f.certificationId || undefined,
		state: f.state
	});
});

export const getRoleRequirements = query(z.string(), async (roleId) => {
	await requireStaff();
	return getRequirementsForRole(roleId);
});

/** What a member still needs before they could claim this role's shifts. */
export const getMyMissingRequirements = query(z.string(), async (roleId) => {
	await requireFeature('volunteering');
	const currentUser = requireUser();
	return missingRequirements(currentUser.id, roleId);
});

const certificationFormSchema = z.object({
	name: z
		.string()
		.min(1, 'Give the certification a name')
		.max(CERT_NAME_MAX, `Keep the name under ${CERT_NAME_MAX} characters`),
	description: z
		.string()
		.max(CERT_DESCRIPTION_MAX, `Keep the description under ${CERT_DESCRIPTION_MAX} characters`)
		.optional(),
	issuedBy: z.string().max(CERT_NAME_MAX).optional(),
	validityMonths: z.string().optional(),
	displayOrder: z.string().optional(),
	isActive: z.string().optional()
});

/** Blank means "never expires", which is the normal case for internal clearances. */
function parseValidityMonths(raw: string | undefined): number | null {
	if (!raw?.trim()) return null;
	const parsed = parseInt(raw, 10);
	if (!Number.isFinite(parsed)) error(400, 'Validity must be a whole number of months');
	return parsed;
}

export const createCertification = form(certificationFormSchema, async (data) => {
	await requireStaff();

	try {
		await createCertificationService({
			name: data.name,
			description: data.description,
			issuedBy: data.issuedBy,
			validityMonths: parseValidityMonths(data.validityMonths),
			displayOrder: data.displayOrder ? parseInt(data.displayOrder, 10) : 0,
			isActive: data.isActive !== 'false'
		});
	} catch (err) {
		mapDomainError(err);
	}

	await refreshCertificationViews();
	return { success: true };
});

export const updateCertification = form(
	certificationFormSchema.extend({ id: z.string().min(1) }),
	async (data) => {
		await requireStaff();

		try {
			await updateCertificationService(data.id, {
				name: data.name,
				description: data.description ?? '',
				issuedBy: data.issuedBy ?? '',
				validityMonths: parseValidityMonths(data.validityMonths),
				displayOrder: data.displayOrder ? parseInt(data.displayOrder, 10) : undefined,
				isActive: data.isActive !== 'false'
			});
		} catch (err) {
			mapDomainError(err);
		}

		await refreshCertificationViews();
		return { success: true };
	}
);

export const archiveCertification = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireStaff();
	try {
		await archiveCertificationService(data.id);
	} catch (err) {
		mapDomainError(err);
	}
	await refreshCertificationViews();
	return { success: true };
});

export const restoreCertification = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireStaff();
	try {
		await restoreCertificationService(data.id);
	} catch (err) {
		mapDomainError(err);
	}
	await refreshCertificationViews();
	return { success: true };
});

export const deleteCertification = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireStaff();
	try {
		await deleteCertificationService(data.id);
	} catch (err) {
		mapDomainError(err);
	}
	await refreshCertificationViews();
	return { success: true };
});

export const setRoleCertifications = form(
	z.object({
		roleId: z.string().min(1),
		// Clearing every requirement is legitimate, so this bottoms out empty.
		certificationIds: z.array(z.string().min(1)).max(20).default([])
	}),
	async (data) => {
		await requireStaff();
		try {
			await setRoleRequirements(data.roleId, data.certificationIds);
		} catch (err) {
			mapDomainError(err);
		}
		void getRoleRequirements(data.roleId).refresh();
		// The roles table renders each role's requirements too.
		void getVolunteerRoles().refresh();
		return { success: true };
	}
);

export const grantCertification = form(
	z.object({
		userId: z.string().min(1),
		certificationId: z.string().min(1, 'Pick a certification'),
		grantedOn: z.string().min(1, 'Pick the date it was granted'),
		reference: z.string().max(CERT_REFERENCE_MAX).optional(),
		notes: z.string().max(CERT_NOTES_MAX).optional()
	}),
	async (data) => {
		const staff = await requireStaff();

		try {
			await grantCertificationService({
				userId: data.userId,
				certificationId: data.certificationId,
				grantedOn: data.grantedOn,
				reference: data.reference,
				notes: data.notes,
				grantedByUserId: staff.id
			});
		} catch (err) {
			mapDomainError(err);
		}

		void getMemberCertifications(data.userId).refresh();
		return { success: true };
	}
);

export const revokeCertification = form(
	z.object({
		id: z.string().min(1),
		userId: z.string().min(1),
		reason: z
			.string()
			.min(1, 'Give a reason — the next staffer needs to know why they are off the list')
			.max(CERT_REVOKED_REASON_MAX)
	}),
	async (data) => {
		const staff = await requireStaff();

		try {
			await revokeCertificationService(data.id, staff.id, data.reason);
		} catch (err) {
			mapDomainError(err);
		}

		void getMemberCertifications(data.userId).refresh();
		return { success: true };
	}
);

export const deleteCertificationGrant = form(
	z.object({ id: z.string().min(1), userId: z.string().min(1) }),
	async (data) => {
		const staff = await requireStaff();

		try {
			await deleteCertificationRecord(data.id, staff.id);
		} catch (err) {
			mapDomainError(err);
		}

		void getMemberCertifications(data.userId).refresh();
		return { success: true };
	}
);

async function refreshCertificationViews() {
	await Promise.all([getCertifications().refresh(), getActiveCertifications().refresh()]);
}

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

const shiftFilters = z.object({
	volunteerRoleId: z.string().optional(),
	eventId: z.string().optional(),
	from: z.string().optional(),
	to: z.string().optional(),
	includeCancelled: z.boolean().optional()
});

export const getShifts = query(shiftFilters, async (f) => {
	await requireStaff();
	return listShifts({
		volunteerRoleId: f.volunteerRoleId || undefined,
		eventId: f.eventId || undefined,
		from: f.from ? new Date(f.from) : undefined,
		to: f.to ? new Date(f.to) : undefined,
		includeCancelled: f.includeCancelled
	});
});

export const getShift = query(z.string(), async (id) => {
	await requireStaff();
	const shift = await getShiftDetail(id);
	if (!shift) throw error(404, 'Shift not found');
	const claimants = await listClaimants(id);
	return { shift, claimants };
});

/**
 * Open shifts for the member, with the reason they can't take one attached
 * rather than the shift hidden — "you need Sound Desk Cleared" is the useful
 * half of a refusal.
 */
export const getOpenShifts = query(async () => {
	await requireFeature('volunteering');
	const currentUser = requireUser();

	const shifts = await listOpenShiftsForMember(currentUser.id);
	if (shifts.length === 0) return [];

	// Two queries for the whole board, not two per shift: requirements for every
	// role at once, the member's certification rows once, then the gate evaluated
	// in JS against each shift's own date (which is what makes it per-shift).
	const [requirements, held] = await Promise.all([
		getRequirementsForRoles([...new Set(shifts.map((s) => s.volunteerRoleId))]),
		listHeldForGate(currentUser.id)
	]);

	return shifts.map((shift) => ({
		...shift,
		missingCertifications: shift.myStatus
			? []
			: missingFrom(requirements.get(shift.volunteerRoleId) ?? [], held, shift.startsAt)
	}));
});

/** Completed shifts with no hour log yet — the pre-fill offer. */
export const getUnloggedShifts = query(async () => {
	await requireFeature('volunteering');
	const currentUser = requireUser();
	return listUnloggedCompletions(currentUser.id);
});

const shiftFormSchema = z.object({
	volunteerRoleId: z.string().min(1, 'Pick a role'),
	eventId: z.string().optional(),
	startsAt: z.string().min(1, 'Pick when it starts'),
	endsAt: z.string().min(1, 'Pick when it ends'),
	capacity: z.string().min(1, 'How many people do you need?'),
	notes: z
		.string()
		.max(VOLUNTEER_SHIFT_NOTES_MAX, `Keep the notes under ${VOLUNTEER_SHIFT_NOTES_MAX} characters`)
		.optional()
});

export const createShift = form(shiftFormSchema, async (data) => {
	const staff = await requireStaff();

	try {
		await createShiftService({
			volunteerRoleId: data.volunteerRoleId,
			eventId: data.eventId,
			startsAt: data.startsAt,
			endsAt: data.endsAt,
			capacity: parseInt(data.capacity, 10),
			notes: data.notes,
			createdByUserId: staff.id
		});
	} catch (err) {
		mapDomainError(err);
	}

	return { success: true };
});

export const updateShift = form(
	shiftFormSchema.partial().extend({ id: z.string().min(1) }),
	async (data) => {
		await requireStaff();

		try {
			await updateShiftService(data.id, {
				volunteerRoleId: data.volunteerRoleId,
				eventId: data.eventId,
				startsAt: data.startsAt,
				endsAt: data.endsAt,
				capacity: data.capacity ? parseInt(data.capacity, 10) : undefined,
				notes: data.notes
			});
		} catch (err) {
			mapDomainError(err);
		}

		void getShift(data.id).refresh();
		return { success: true };
	}
);

export const duplicateShift = form(
	z.object({ id: z.string().min(1), offsetDays: z.string().min(1) }),
	async (data) => {
		const staff = await requireStaff();

		try {
			await duplicateShiftService(data.id, parseInt(data.offsetDays, 10), staff.id);
		} catch (err) {
			mapDomainError(err);
		}

		return { success: true };
	}
);

export const cancelShift = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireStaff();

	try {
		await cancelShiftService(data.id);
	} catch (err) {
		mapDomainError(err);
	}

	void getShift(data.id).refresh();
	return { success: true };
});

// ---------------------------------------------------------------------------
// Signups
// ---------------------------------------------------------------------------

export const claimShift = form(z.object({ shiftId: z.string().min(1) }), async (data) => {
	await requireFeature('volunteering');
	const currentUser = requireUser();

	try {
		await claimShiftService(data.shiftId, currentUser.id);
	} catch (err) {
		mapDomainError(err);
	}

	void getOpenShifts().refresh();
	return { success: true };
});

export const cancelMySignup = form(z.object({ signupId: z.string().min(1) }), async (data) => {
	await requireFeature('volunteering');
	const currentUser = requireUser();

	try {
		await cancelSignupService(data.signupId, currentUser.id);
	} catch (err) {
		mapDomainError(err);
	}

	void getOpenShifts().refresh();
	return { success: true };
});

export const confirmSignup = form(
	z.object({ signupId: z.string().min(1), shiftId: z.string().min(1) }),
	async (data) => {
		await requireStaff();

		try {
			await confirmSignupService(data.signupId);
		} catch (err) {
			mapDomainError(err);
		}

		void getShift(data.shiftId).refresh();
		return { success: true };
	}
);

export const markSignupNoShow = form(
	z.object({ signupId: z.string().min(1), shiftId: z.string().min(1) }),
	async (data) => {
		await requireStaff();

		try {
			await markNoShowService(data.signupId);
		} catch (err) {
			mapDomainError(err);
		}

		void getShift(data.shiftId).refresh();
		return { success: true };
	}
);

// ---------------------------------------------------------------------------
// Post-shift feedback
// ---------------------------------------------------------------------------

/** What the form shows above the questions; null when it isn't theirs to answer. */
export const getShiftFeedbackContext = query(z.string(), async (signupId) => {
	await requireFeature('volunteering');
	const currentUser = requireUser();
	return getFeedbackContext(signupId, currentUser.id);
});

export const submitShiftFeedback = form(
	z.object({
		signupId: z.string().min(1),
		rating: z.string().min(1, 'Pick a rating'),
		// FormField's checkbox registers with SvelteKit's `b:` prefix, which
		// coerces to a real boolean before validation — absent means false, and
		// "no, I wasn't set up" is a real answer.
		wasSetUp: z.boolean().default(false),
		comment: z
			.string()
			.max(
				SHIFT_FEEDBACK_COMMENT_MAX,
				`Keep the comment under ${SHIFT_FEEDBACK_COMMENT_MAX} characters`
			)
			.optional()
	}),
	async (data) => {
		await requireFeature('volunteering');
		const currentUser = requireUser();

		try {
			await submitFeedbackService({
				signupId: data.signupId,
				userId: currentUser.id,
				rating: parseInt(data.rating, 10),
				wasSetUp: data.wasSetUp,
				comment: data.comment
			});
		} catch (err) {
			mapDomainError(err);
		}

		void getShiftFeedbackContext(data.signupId).refresh();
		return { success: true };
	}
);

/** Staff: responses on one shift's detail page. */
export const getShiftFeedback = query(z.string(), async (shiftId) => {
	await requireStaff();
	return listFeedbackForShift(shiftId);
});

/** Staff: the per-role rollup — the version that changes how shifts are briefed. */
export const getFeedbackByRole = query(async () => {
	await requireStaff();
	return summarizeFeedbackByRole();
});

// ---------------------------------------------------------------------------
// Staff user record (/staff/users/[id])
// ---------------------------------------------------------------------------
// Read-only, staff-guarded, and scoped by an explicit userId argument rather
// than `params.id`, which on a remote call comes from a caller-supplied header.
// ---------------------------------------------------------------------------

export const getUserVolunteerProfile = query(z.string(), async (userId) => {
	await requireStaff();
	const [profile, summary, interests] = await Promise.all([
		getVolunteerProfile(userId),
		getUserHourSummary(userId),
		listInterestsForUser(userId)
	]);
	return { profile, summary, interests };
});

export const getUserShifts = query(z.string(), async (userId) => {
	await requireStaff();
	return listSignupsForUser(userId, { limit: 20 });
});

export const getUserHourLogs = query(z.string(), async (userId) => {
	await requireStaff();
	return listUserHourLogs(userId);
});
