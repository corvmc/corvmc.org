import { z } from 'zod';
import { invalid } from '@sveltejs/kit';
import { query } from '$app/server';
import { form } from './_remote';
import { requireCapability, requireUser } from '$lib/server/authorization';
import { allowRateLimited } from '$lib/server/rate-limit';
import { APPEAL_BODY_MAX, standingScopes } from '$lib/config';
import {
	getMemberAppeal,
	fileAppeal as fileAppealSvc,
	decideAppeal as decideAppealSvc,
	reopenAppeal as reopenAppealSvc,
	type AppealTarget
} from '$lib/server/moderation/appeal-service';
import { getFlagDetail } from './flags.remote';

// Appeals against upheld reports. The member never names a flag: they name the
// thing they are looking at, and the service finds the decision after checking
// it is theirs. Account actions (bans, deactivation) are not appealable here.

const APPEALS_PER_HOUR = 5;

const targetSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('suggestion'), suggestionId: z.string().min(1) }),
	z.object({ kind: z.literal('listing'), eventId: z.string().min(1) }),
	z.object({ kind: z.literal('standing'), scope: z.enum(standingScopes) })
]);

// ---------------------------------------------------------------------------
// Member
// ---------------------------------------------------------------------------

/** Null when there is no upheld decision here that belongs to the viewer. */
export const getMyAppeal = query(targetSchema, async (target) => {
	const me = requireUser();
	return getMemberAppeal(me.id, target);
});

/** Form fields are flat, so the target arrives as `kind` plus one key. */
function targetFrom(data: {
	kind: 'suggestion' | 'listing' | 'standing';
	targetId: string;
}): AppealTarget | null {
	if (data.kind === 'suggestion') return { kind: 'suggestion', suggestionId: data.targetId };
	if (data.kind === 'listing') return { kind: 'listing', eventId: data.targetId };
	const scope = standingScopes.find((s) => s === data.targetId);
	return scope ? { kind: 'standing', scope } : null;
}

export const fileAppeal = form(
	z.object({
		kind: z.enum(['suggestion', 'listing', 'standing']),
		targetId: z.string().min(1),
		body: z.string().trim().min(1, 'Say why you think the decision was wrong').max(APPEAL_BODY_MAX)
	}),
	async (data, issue) => {
		const me = requireUser();
		const target = targetFrom(data);
		if (!target) invalid(issue.targetId('Nothing to appeal'));

		if (!(await allowRateLimited(`appeal-file:${me.id}`, APPEALS_PER_HOUR, 3600))) {
			invalid(issue.body('You have filed several appeals recently. Try again later.'));
		}

		await fileAppealSvc({ userId: me.id, userName: me.name, target, body: data.body });
		void getMyAppeal(target).refresh();
		return { success: true };
	}
);

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export const decideAppeal = form(
	z.object({
		flagId: z.string().min(1),
		restoreContent: z.boolean().default(false),
		restoreStanding: z.boolean().default(false),
		notes: z.string().trim().min(1, 'Tell the member why').max(APPEAL_BODY_MAX)
	}),
	async (data) => {
		const staff = await requireCapability('moderation.reviewFlags');
		await decideAppealSvc({ ...data, staffId: staff.id });
		void getFlagDetail(data.flagId).refresh();
		return { success: true };
	}
);

export const reopenAppeal = form(z.object({ flagId: z.string().min(1) }), async (data) => {
	await requireCapability('moderation.reviewFlags');
	await reopenAppealSvc({ flagId: data.flagId });
	void getFlagDetail(data.flagId).refresh();
	return { success: true };
});
