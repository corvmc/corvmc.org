import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { query, form, getRequestEvent } from '$app/server';
import { requireFeature } from '$lib/server/feature-flags';
import { getPublishedRelease, listTracks } from '$lib/server/audio/audio-service';
import { beginPurchase, findPurchaseByToken } from '$lib/server/audio/purchase-service';
import { destinationFor } from '$lib/server/audio/connect-service';
import { db } from '$lib/server/db';
import { media, mediaAttachment } from '$lib/server/db/schema/media';
import { and, eq } from 'drizzle-orm';
import { resolveImageUrl } from '$lib/server/storage';

// ---------------------------------------------------------------------------
// Public reads
// ---------------------------------------------------------------------------
// The buyer's side of the feature. Unauthenticated throughout: a record has to
// be listenable and buyable by someone who has never signed in, which is most
// of the people a flyer sends here.

async function coverUrlFor(releaseId: string): Promise<string | null> {
	const [row] = await db
		.select({ key: media.key })
		.from(mediaAttachment)
		.innerJoin(media, eq(media.id, mediaAttachment.mediaId))
		.where(
			and(
				eq(mediaAttachment.attachableType, 'audio_release'),
				eq(mediaAttachment.attachableId, releaseId),
				eq(mediaAttachment.slot, 'cover')
			)
		)
		.limit(1);
	return row ? resolveImageUrl(row.key) : null;
}

/** The release page's one load-bearing query. */
export const getPublicRelease = query(
	z.object({ bandSlug: z.string().min(1), releaseSlug: z.string().min(1) }),
	async ({ bandSlug, releaseSlug }) => {
		await requireFeature('bandAudio');

		const { locals } = getRequestEvent();

		const found = await getPublishedRelease(bandSlug, releaseSlug);
		// Draft, withheld and nonexistent all answer the same way. A takedown that
		// 403s tells the world there is something to see.
		if (!found) throw error(404, 'Not found');

		const { release } = found;
		const [tracks, coverUrl, destination] = await Promise.all([
			listTracks(release.id),
			coverUrlFor(release.id),
			destinationFor(found.bandId)
		]);

		return {
			release: {
				id: release.id,
				title: release.title,
				slug: release.slug,
				kind: release.kind,
				description: release.description,
				releasedAt: release.releasedAt,
				priceMinCents: release.priceMinCents,
				allowPayMore: release.allowPayMore,
				coverUrl
			},
			band: { id: found.bandId, name: found.bandName, slug: found.bandSlug },
			tracks,
			/**
			 * Whether the Buy control does anything. A free release is always
			 * buyable; a priced one needs the band's Stripe account to be live,
			 * and offering a button that 409s is worse than explaining why.
			 */
			purchasable: release.priceMinCents === 0 || destination !== null,
			/**
			 * The signed-in buyer's address, or `null` for a visitor.
			 *
			 * Carried by this query rather than fetched alongside it: a page gets one
			 * load-bearing query, and `custom/no-concurrent-remote-queries` errors on
			 * the second. It only decides whether the buy panel asks for an email or
			 * offers a sign-in, so it costs one field on a request that already has
			 * the session in hand.
			 */
			viewerEmail: locals.user?.email ?? null
		};
	}
);

/**
 * What a download token entitles its holder to.
 *
 * The token is the entitlement and there is no session check, because an
 * anonymous buyer has nothing else — it is a full random UUID, never listed
 * anywhere, and it arrives by email so it survives the tab being closed.
 */
export const getDownload = query(z.string().min(16), async (token) => {
	await requireFeature('bandAudio');

	const purchase = await findPurchaseByToken(token);
	if (!purchase) throw error(404, 'Not found');

	// A purchase that exists but has not been fulfilled yet is `pending`, not a
	// 404. It used to be indistinguishable from a nonexistent token, and could
	// afford to be: paying on checkout.stripe.com, the redirect back took long
	// enough that `checkout.session.completed` had all but always landed first.
	// Paying on our own page, the buyer arrives in the same second they confirm,
	// so the honest answer is "not yet" and the page waits for it. The token is a
	// 128-bit random it takes an email to receive, so telling its holder that
	// much discloses nothing to anyone who does not already have it — and the
	// track endpoint still hands over nothing until the purchase is paid.
	if (purchase.purchase.status !== 'paid') return { status: 'pending' as const };

	const tracks = await listTracks(purchase.releaseId);
	return {
		status: 'ready' as const,
		releaseTitle: purchase.releaseTitle,
		bandName: purchase.bandName,
		amountPaidCents: purchase.purchase.amountPaidCents,
		// Ids, not a prebuilt href. The page resolves the route itself, which is
		// what `svelte/no-navigation-without-resolve` is asking for — a URL
		// assembled on the server arrives as an opaque string the rule cannot check.
		tracks: tracks.map((t) => ({
			id: t.id,
			title: t.title,
			trackNumber: t.trackNumber,
			durationMs: t.durationMs
		}))
	};
});

// ---------------------------------------------------------------------------
// Buying
// ---------------------------------------------------------------------------

/**
 * Start a purchase.
 *
 * Everything money-shaped in this payload is an **allocation the buyer chose**,
 * not an amount to be believed: the service recomputes the whole split from the
 * release's own floor, because these numbers become `application_fee_amount`.
 * There is deliberately nowhere here to post a Stripe fee.
 *
 * `n:` number fields are dropped from the payload when cleared, so both are
 * optional with a default rather than required — a required number field that
 * the buyer emptied would reject the form with an error about a field they
 * cannot see.
 */
export const buyReleaseForm = form(
	z.object({
		bandSlug: z.string().min(1),
		releaseSlug: z.string().min(1),
		email: z.string().trim().email('Enter an email we can send the download to'),
		totalCents: z.number().int().min(0).optional().default(0),
		platformCents: z.number().int().min(0).optional().default(0),
		coverFees: z.boolean().optional().default(false)
	}),
	async ({ bandSlug, releaseSlug, email, totalCents, platformCents, coverFees }) => {
		await requireFeature('bandAudio');

		const { url, locals } = getRequestEvent();

		// Minted here so the success URL can carry it. Stripe needs an absolute
		// URL up front, and the page it lands on keys off the token alone — which
		// is exactly what lets a buyer with no account land on it.
		const downloadToken = crypto.randomUUID().replace(/-/g, '');

		const result = await beginPurchase({
			bandSlug,
			releaseSlug,
			buyerEmail: email,
			// Attached when there is a session, so the purchase turns up in
			// /member/purchases. Absent is the ordinary case and must stay allowed.
			userId: locals.user?.id ?? null,
			totalCents,
			platformCents,
			coverFees,
			downloadToken,
			successUrl: new URL(`/music/download/${downloadToken}`, url.origin).toString(),
			cancelUrl: new URL(`/music/${bandSlug}/${releaseSlug}`, url.origin).toString()
		});

		return {
			success: true,
			checkoutUrl: result.checkoutUrl ?? null,
			downloadToken: result.downloadToken,
			paid: result.paid
		};
	}
);
