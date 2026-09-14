import { z } from 'zod';
import { form, query } from '$app/server';
import { mapDomainError } from '$lib/server/errors';
import { requireCapability, requireUser } from '$lib/server/authorization';
import { requireCommitteeReviewer } from '$lib/server/group/group-context';
import { getMemberGroup } from '$lib/remote/groups.remote';
import { COMMITTEE_ANSWER_MAX, committeeApplicationQuestions } from '$lib/config';
import {
	acceptApplication,
	declineApplication,
	listCommittees,
	listForApplicant,
	listOpenByCommittee,
	markContacted,
	submitApplication,
	withdrawApplication
} from '$lib/server/group/committee-application-service';

/**
 * Applying to a committee, and a chair answering.
 *
 * A chair is a group `admin`, so every write below the fold is
 * `requireProgramRole(ref, 'admin')` and the choice id is re-scoped to the
 * group the guard resolved — a chair's authority stops at their own committee.
 */

const answer = z.string().trim().max(COMMITTEE_ANSWER_MAX).optional();

/**
 * Spelled out rather than built from `committeeApplicationQuestions`: a schema
 * assembled in a loop infers as `{}` and every answer field loses its type.
 * `config.spec.ts` keeps the two lists together.
 */
// `groupIds` defaults to `[]` — with nothing ticked the browser submits no
// entry at all, and the service says "pick at least one" better than Zod.
const applySchema = z.object({
	groupIds: z.array(z.string()).default([]),
	experience: answer,
	vision: answer
});

/** The apply page: every committee, and what the viewer has already asked for. */
export const getCommitteeApplyPage = query(async () => {
	const user = requireUser();
	const [committees, mine] = await Promise.all([listCommittees(), listForApplicant(user.id)]);
	return { committees, mine };
});

export const applyToCommittees = form(applySchema, async (data) => {
	const user = requireUser();
	const answers: Record<string, string> = {};
	for (const q of committeeApplicationQuestions) {
		const value = (data as Record<string, unknown>)[q.id];
		if (typeof value === 'string' && value.length > 0) answers[q.id] = value;
	}
	try {
		await submitApplication(user.id, { groupIds: data.groupIds, answers });
		await getCommitteeApplyPage().refresh();
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

export const withdrawCommitteeApplication = form(
	z.object({ applicationId: z.string().min(1) }),
	async (data) => {
		const user = requireUser();
		try {
			await withdrawApplication(data.applicationId, user.id);
			await getCommitteeApplyPage().refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

// ---------------------------------------------------------------------------
// The chair's side
// ---------------------------------------------------------------------------

/**
 * The queue a reviewer works who holds no committee seat.
 *
 * Its own page rather than a panel on `/staff/groups/[id]`: that surface wants
 * `group.read`, which the volunteer coordinator does not hold and should not
 * gain just to answer an application.
 */
export const getCommitteeApplicationQueue = query(async () => {
	await requireCapability('committee.reviewApplications');
	return { committees: await listOpenByCommittee() };
});

const chairRef = z.object({ slug: z.string().min(1) });
const choiceRef = chairRef.extend({ choiceId: z.string().min(1) });

/**
 * Resolve the chair's committee and re-scope the client's choice id to it.
 *
 * The applications themselves are read on `getMemberGroup`, with the rest of
 * the club page in one round trip — a query of their own fanned out of a
 * section component is what `custom/no-concurrent-remote-queries` stops.
 */
async function chairOf(slug: string) {
	return requireCommitteeReviewer({ slug });
}

export const markApplicantContacted = form(choiceRef, async (data) => {
	const { user, group } = await chairOf(data.slug);
	try {
		await markContacted(data.choiceId, group.id, user.id);
		await Promise.all([
			getMemberGroup(data.slug).refresh(),
			getCommitteeApplicationQueue().refresh()
		]);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

export const acceptCommitteeApplication = form(choiceRef, async (data) => {
	const { user, group } = await chairOf(data.slug);
	try {
		await acceptApplication(data.choiceId, group.id, user.id);
		await Promise.all([
			getMemberGroup(data.slug).refresh(),
			getCommitteeApplicationQueue().refresh()
		]);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

export const declineCommitteeApplication = form(
	choiceRef.extend({ reviewNotes: z.string().trim().max(COMMITTEE_ANSWER_MAX).optional() }),
	async (data) => {
		const { user, group } = await chairOf(data.slug);
		try {
			await declineApplication(data.choiceId, group.id, user.id, data.reviewNotes ?? null);
			await Promise.all([
				getMemberGroup(data.slug).refresh(),
				getCommitteeApplicationQueue().refresh()
			]);
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);
