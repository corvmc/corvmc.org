import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { query } from '$app/server';
import { form } from './_remote';
import { APPEAL_BODY_MAX } from '#lib/config.js';
import { verifyRemovalToken } from '#lib/server/moderation/removal-link.js';
import { getRemovalNotice as getRemovalNoticeSvc } from '#lib/server/moderation/removal-service.js';
import { fileRemovalAppeal as fileRemovalAppealSvc } from '#lib/server/moderation/appeal-service.js';

/**
 * The removal notice a removed member opens from their email. They have no
 * session, so the signed link is the guard: it names one removal and expires.
 */
function removalFrom(token: string): string {
	const verified = verifyRemovalToken(token);
	if (verified === 'expired') error(410, 'This link has expired');
	if (!verified) error(404, 'Not found');
	return verified.removalId;
}

/** A bad or expired link answers with a state, so the page can say what to do next. */
export const getRemovalNotice = query(z.string().max(512), async (token) => {
	const verified = verifyRemovalToken(token);
	if (verified === 'expired') return { state: 'expired' as const };
	const notice = verified ? await getRemovalNoticeSvc(verified.removalId) : null;
	if (!notice) return { state: 'invalid' as const };
	return { state: 'ok' as const, ...notice };
});

export const fileRemovalAppeal = form(
	z.object({
		token: z.string().max(512),
		body: z.string().trim().min(1, 'Say why you think the decision was wrong').max(APPEAL_BODY_MAX)
	}),
	async (data) => {
		await fileRemovalAppealSvc({ removalId: removalFrom(data.token), body: data.body });
		void getRemovalNotice(data.token).refresh();
		return { success: true };
	}
);
