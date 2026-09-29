import { z } from 'zod';
import { query } from '$app/server';
import { form } from './_remote';
import { mapDomainError } from '$lib/server/errors';
import { can, requireUser } from '$lib/server/authorization';
import { requireApplicationReviewer } from '$lib/server/group/group-context';
import {
	getMemberGroup,
	getMemberGroups,
	getStaffCommitteePage,
	getStaffCommittees,
	getStaffGroupPage
} from '$lib/remote/groups.remote';
import { APPLICATION_ANSWER_MAX } from '$lib/config';
import {
	acceptApplication,
	declineApplication,
	listCommittees,
	listForApplicant,
	markContacted,
	submitApplication,
	withdrawApplication
} from '$lib/server/group/application-service';

/**
 * Applying to a `by_application` group, and a reviewer answering.
 *
 * Every review write goes through `requireApplicationReviewer` and re-scopes the
 * choice id to the group that guard resolved, so a reviewer's authority stops
 * at their own group.
 */

const answer = z.string().trim().max(APPLICATION_ANSWER_MAX).optional();

/**
 * One optional field per question id across every kind, spelled out rather
 * than built from `groupApplicationQuestions`: a schema assembled in a loop
 * infers as `{}` and every field loses its type. `config.spec.ts` keeps the
 * lists together, and the service keeps only the answering kind's ids.
 */
// `groupIds` defaults to `[]` — with nothing ticked the browser submits no
// entry at all, and the service says "pick one" better than Zod.
const applySchema = z.object({
	groupIds: z.array(z.string()).default([]),
	experience: answer,
	vision: answer,
	note: answer
});

/** The committee apply page: every committee taking applications, and yours. */
export const getCommitteeApplyPage = query(async () => {
	const user = requireUser();
	const [committees, mine] = await Promise.all([
		listCommittees({ acceptingOnly: true }),
		listForApplicant(user.id, { kind: 'committee' })
	]);
	return { committees, mine };
});

async function refreshApplicantViews() {
	await Promise.all([getCommitteeApplyPage().refresh(), getMemberGroups().refresh()]);
}

export const applyToGroups = form(applySchema, async (data) => {
	const user = requireUser();
	const answers: Record<string, string> = {};
	for (const key of ['experience', 'vision', 'note'] as const) {
		const value = data[key];
		if (value) answers[key] = value;
	}
	try {
		await submitApplication(user.id, { groupIds: data.groupIds, answers });
		await refreshApplicantViews();
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

export const withdrawGroupApplication = form(
	z.object({ applicationId: z.string().min(1) }),
	async (data) => {
		const user = requireUser();
		try {
			await withdrawApplication(data.applicationId, user.id);
			await refreshApplicantViews();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

// ---------------------------------------------------------------------------
// The reviewer's side
// ---------------------------------------------------------------------------

const choiceRef = z.object({ slug: z.string().min(1), choiceId: z.string().min(1) });

/**
 * After a decision: the member group page, and the staff club or committee
 * pages — each only for a caller its own guard admits, so a refresh never 403s.
 */
async function refreshReviewerViews(slug: string, groupId: string, kind: string) {
	const [staff, coordinator] = await Promise.all([
		can('group.read'),
		can('committee.reviewApplications')
	]);
	const committee = kind === 'committee';
	await Promise.all([
		getMemberGroup(slug).refresh(),
		staff && !committee ? getStaffGroupPage(groupId).refresh() : undefined,
		coordinator && committee ? getStaffCommittees().refresh() : undefined,
		coordinator && committee ? getStaffCommitteePage(groupId).refresh() : undefined
	]);
}

export const markApplicantContacted = form(choiceRef, async (data) => {
	const { user, group } = await requireApplicationReviewer({ slug: data.slug });
	try {
		await markContacted(data.choiceId, group.id, user.id);
		await refreshReviewerViews(data.slug, group.id, group.kind);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

export const acceptGroupApplication = form(choiceRef, async (data) => {
	const { user, group } = await requireApplicationReviewer({ slug: data.slug });
	try {
		await acceptApplication(data.choiceId, group.id, user.id);
		await refreshReviewerViews(data.slug, group.id, group.kind);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

export const declineGroupApplication = form(
	choiceRef.extend({ reviewNotes: z.string().trim().max(APPLICATION_ANSWER_MAX).optional() }),
	async (data) => {
		const { user, group } = await requireApplicationReviewer({ slug: data.slug });
		try {
			await declineApplication(data.choiceId, group.id, user.id, data.reviewNotes ?? null);
			await refreshReviewerViews(data.slug, group.id, group.kind);
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);
