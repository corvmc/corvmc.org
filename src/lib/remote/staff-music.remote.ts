import { z } from 'zod';
import { query, form } from '$app/server';
import { requireStaff } from '$lib/server/authorization';
import { isFeatureEnabled } from '$lib/server/feature-flags';
import {
	listAllReleases,
	radioPoolStats,
	recentSales,
	restoreRelease,
	salesTotals,
	setRadioExclusion,
	withholdRelease
} from '$lib/server/audio/staff-audio-service';
import { getRadioNow, getRecentlyPlayed } from '$lib/server/audio/radio-service';
import { refundPurchase } from '$lib/server/audio/purchase-service';
import { LONG_TEXT_MAX } from '$lib/config';

/**
 * Staff music tools.
 *
 * **Not behind `bandAudio`, and that is deliberate.** The flag is the launch
 * switch, and the question it gates on — is there enough music yet — can only be
 * answered from a screen that works while it is off. Gating this page behind the
 * flag would mean turning the feature on to find out whether to turn it on.
 *
 * `requireStaff()` is the whole guard, on every export.
 */

/** The one load-bearing query for /staff/music. */
export const getStaffMusicPage = query(async () => {
	await requireStaff();

	const [releases, pool, sales, purchases, radioEnabled, audioEnabled, now, recent] =
		await Promise.all([
			listAllReleases(),
			radioPoolStats(),
			salesTotals(),
			recentSales(),
			isFeatureEnabled('cmcRadio'),
			isFeatureEnabled('bandAudio'),
			getRadioNow(),
			getRecentlyPlayed(15)
		]);

	return { releases, pool, sales, purchases, radioEnabled, audioEnabled, now, recent };
});

/**
 * Take a release down.
 *
 * A reason is required rather than optional: it is shown to the band on their
 * own release page, and a takedown they cannot see the cause of is one they
 * cannot fix.
 */
export const withholdReleaseForm = form(
	z.object({
		releaseId: z.string().min(1),
		reason: z.string().trim().min(1, 'Say why — the band sees this').max(LONG_TEXT_MAX)
	}),
	async ({ releaseId, reason }) => {
		await requireStaff();
		await withholdRelease(releaseId, reason);
		void getStaffMusicPage().refresh();
		return { success: true };
	}
);

/** Hand a withheld release back to the band as a draft, theirs to publish again. */
export const restoreReleaseForm = form(
	z.object({ releaseId: z.string().min(1) }),
	async ({ releaseId }) => {
		await requireStaff();
		await restoreRelease(releaseId);
		void getStaffMusicPage().refresh();
		return { success: true };
	}
);

/**
 * Pull a release off the air, or put it back, without touching its publication.
 *
 * `excluded` is `.optional().default(false)` because an unchecked checkbox posts
 * nothing at all — a required boolean rejects the submission with an error
 * naming a field the user cannot see.
 */
export const setRadioExclusionForm = form(
	z.object({
		releaseId: z.string().min(1),
		excluded: z.boolean().optional().default(false),
		reason: z.string().trim().max(LONG_TEXT_MAX).optional()
	}),
	async ({ releaseId, excluded, reason }) => {
		await requireStaff();
		await setRadioExclusion(releaseId, excluded, reason);
		void getStaffMusicPage().refresh();
		return { success: true };
	}
);

/**
 * Reverse a sale.
 *
 * Staff-run rather than self-serve: a refund moves money out of a band's account
 * as well as the collective's, and there is no automated case where that is the
 * right call without somebody having read the request.
 *
 * The confirmation lives in the UI. This is the guard and the audit point — the
 * service is idempotent, so a second submission is a no-op rather than a second
 * refund.
 */
export const refundPurchaseForm = form(
	z.object({ purchaseId: z.string().min(1) }),
	async ({ purchaseId }) => {
		await requireStaff();
		await refundPurchase(purchaseId);
		void getStaffMusicPage().refresh();
		return { success: true };
	}
);
