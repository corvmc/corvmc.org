import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { query, form, command, getRequestEvent } from '$app/server';
import { requireGroupRole } from '$lib/server/group/group-context';
import { requireFeature } from '$lib/server/feature-flags';
import {
	createRelease,
	deleteRelease,
	deleteTrack,
	getReleaseById,
	listReleasesForBand,
	listTracks,
	publishRelease,
	renameTrack,
	reorderTracks,
	unpublishRelease,
	updateRelease
} from '$lib/server/audio/audio-service';
import {
	releaseKinds,
	RELEASE_TITLE_MAX,
	TRACK_TITLE_MAX,
	LONG_TEXT_MAX,
	AUDIO_MIN_PRICE_CENTS
} from '$lib/config';
import {
	createDashboardLink,
	createOnboardingLink,
	getPayoutStatus
} from '$lib/server/audio/connect-service';

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * Band-admin on the band that owns this release.
 *
 * The band comes from the *slug the caller passed*, and the release is then
 * checked to belong to it. Resolving the band from the release instead would
 * make the slug decorative and the check circular — whoever owns the release
 * would always pass. Remote functions are addressable directly and take their
 * params from a client-supplied header, so a release id on its own authorizes
 * nothing.
 */
async function requireReleaseAdmin(slug: string, releaseId: string) {
	const {
		group: band,
		user,
		role
	} = await requireGroupRole({ slug }, 'admin', { allowStaff: true });
	const release = await getReleaseById(releaseId);
	// 404 rather than 403 on a mismatch: whether a release exists under some
	// other band is not this caller's business.
	if (!release || release.groupId !== band.id) throw error(404, 'Release not found');
	return { band, user, role, release };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * The band music panel's one load-bearing query.
 *
 * `member` rather than `admin` because everyone in the band can see the
 * discography; only the mutations below require admin. Drafts are in here, which
 * is why it is not `requireUser`.
 */
export const getBandMusicPage = query(z.string(), async (slug) => {
	await requireFeature('bandAudio');
	const { group: band, role } = await requireGroupRole({ slug }, 'member', { allowStaff: true });
	const releases = await listReleasesForBand(band.id);

	return {
		releases,
		canManage: role === 'owner' || role === 'admin' || role === 'staff'
	};
});

/** One release and its tracks, for the edit page. */
export const getBandRelease = query(
	z.object({ slug: z.string().min(1), releaseId: z.string().min(1) }),
	async ({ slug, releaseId }) => {
		await requireFeature('bandAudio');
		const { group: band, role } = await requireGroupRole({ slug }, 'member', { allowStaff: true });
		const release = await getReleaseById(releaseId);
		if (!release || release.groupId !== band.id) throw error(404, 'Release not found');

		return {
			release: {
				id: release.id,
				title: release.title,
				slug: release.slug,
				kind: release.kind,
				description: release.description,
				releasedAt: release.releasedAt,
				status: release.status,
				priceMinCents: release.priceMinCents,
				allowPayMore: release.allowPayMore,
				radioOptIn: release.radioOptIn,
				radioExcluded: release.radioExcludedAt !== null,
				radioExcludedReason: release.radioExcludedReason
			},
			tracks: await listTracks(releaseId),
			canManage: role === 'owner' || role === 'admin' || role === 'staff',
			/**
			 * Assembled here rather than fetched by the page as a second query —
			 * `custom/no-concurrent-remote-queries` errors on that, and past kit
			 * 2.64 it renders the error boundary instead of the page.
			 *
			 * Only the boolean. Everything sensitive on a payout status — the
			 * account id, and Stripe's list of documents it wants from a named
			 * person — stays behind `getBandPayouts`, which is admin-only. That a
			 * band can accept money is already implied by whether its releases are
			 * purchasable.
			 */
			canSell: (await getPayoutStatus(band.id)).chargesEnabled
		};
	}
);

// ---------------------------------------------------------------------------
// Forms — releases
// ---------------------------------------------------------------------------

/**
 * A release date, as the `<input type="date">` actually posts it.
 *
 * Kept as a string and converted in the handler rather than coerced in the
 * schema, because **a `.transform()` anywhere in a `form()` schema breaks the
 * `fields` inference `<Form>` relies on** — every field on the form widens to
 * `unknown` and the page stops compiling. An empty string is the cleared field,
 * which is a legitimate answer: plenty of bands do not remember when a demo
 * came out.
 */
const dateField = z
	.string()
	.trim()
	.regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Enter a date as YYYY-MM-DD')
	.optional();

/** `''` and absent both mean "no date"; anything else is midday UTC on that day. */
function toReleaseDate(value: string | undefined): Date | null {
	if (!value) return null;
	// Midday, not midnight: a date-only value parsed as UTC midnight renders as
	// the previous day everywhere west of Greenwich, which is all of Oregon.
	const parsed = new Date(`${value}T12:00:00Z`);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const createReleaseForm = form(
	z.object({
		slug: z.string().min(1),
		title: z.string().trim().min(1, 'Give the release a title').max(RELEASE_TITLE_MAX),
		kind: z.enum(releaseKinds),
		releasedAt: dateField
	}),
	async ({ slug, title, kind, releasedAt }) => {
		await requireFeature('bandAudio');
		const { group: band } = await requireGroupRole({ slug }, 'admin', { allowStaff: true });
		const release = await createRelease({
			groupId: band.id,
			title,
			kind,
			releasedAt: toReleaseDate(releasedAt)
		});

		void getBandMusicPage(slug).refresh();
		return { success: true, releaseId: release.id };
	}
);

export const updateReleaseForm = form(
	z.object({
		slug: z.string().min(1),
		releaseId: z.string().min(1),
		title: z.string().trim().min(1, 'Give the release a title').max(RELEASE_TITLE_MAX),
		kind: z.enum(releaseKinds),
		description: z.string().trim().max(LONG_TEXT_MAX).optional(),
		releasedAt: dateField
	}),
	async ({ slug, releaseId, title, kind, description, releasedAt }) => {
		await requireFeature('bandAudio');
		await requireReleaseAdmin(slug, releaseId);
		await updateRelease(releaseId, {
			title,
			kind,
			description: description ?? null,
			releasedAt: toReleaseDate(releasedAt)
		});

		void getBandRelease({ slug, releaseId }).refresh();
		void getBandMusicPage(slug).refresh();
		return { success: true };
	}
);

/**
 * Radio consent, on its own form.
 *
 * Split from `updateReleaseForm` because a checkbox that only takes effect when
 * you also press Save on the metadata above it is the kind of consent control
 * people get wrong in both directions. Pricing gets the same treatment in phase
 * 4 for the same reason.
 *
 * `.optional().default(false)` rather than a bare boolean: an unchecked checkbox
 * posts nothing at all, and a required boolean rejects the whole submission with
 * an error naming a field the user cannot see.
 */
export const setRadioOptInForm = form(
	z.object({
		slug: z.string().min(1),
		releaseId: z.string().min(1),
		radioOptIn: z.boolean().optional().default(false)
	}),
	async ({ slug, releaseId, radioOptIn }) => {
		await requireFeature('bandAudio');
		await requireReleaseAdmin(slug, releaseId);
		await updateRelease(releaseId, { radioOptIn });

		void getBandRelease({ slug, releaseId }).refresh();
		void getBandMusicPage(slug).refresh();
		return { success: true, radioOptIn };
	}
);

export const publishReleaseForm = form(
	z.object({ slug: z.string().min(1), releaseId: z.string().min(1) }),
	async ({ slug, releaseId }) => {
		await requireFeature('bandAudio');
		await requireReleaseAdmin(slug, releaseId);
		await publishRelease(releaseId);

		void getBandRelease({ slug, releaseId }).refresh();
		void getBandMusicPage(slug).refresh();
		return { success: true };
	}
);

export const unpublishReleaseForm = form(
	z.object({ slug: z.string().min(1), releaseId: z.string().min(1) }),
	async ({ slug, releaseId }) => {
		await requireFeature('bandAudio');
		await requireReleaseAdmin(slug, releaseId);
		await unpublishRelease(releaseId);

		void getBandRelease({ slug, releaseId }).refresh();
		void getBandMusicPage(slug).refresh();
		return { success: true };
	}
);

export const deleteReleaseForm = form(
	z.object({ slug: z.string().min(1), releaseId: z.string().min(1) }),
	async ({ slug, releaseId }) => {
		await requireFeature('bandAudio');
		await requireReleaseAdmin(slug, releaseId);
		const outcome = await deleteRelease(releaseId);

		void getBandMusicPage(slug).refresh();
		return { success: true, outcome };
	}
);

// ---------------------------------------------------------------------------
// Forms — tracks
// ---------------------------------------------------------------------------
// Uploading is not here. A track's bytes arrive as multipart at
// `/api/bands/[id]/audio`, because a remote `form()` cannot carry a 50MB file.

export const renameTrackForm = form(
	z.object({
		slug: z.string().min(1),
		releaseId: z.string().min(1),
		trackId: z.string().min(1),
		title: z.string().trim().min(1, 'Give the track a title').max(TRACK_TITLE_MAX)
	}),
	async ({ slug, releaseId, trackId, title }) => {
		await requireFeature('bandAudio');
		await requireReleaseAdmin(slug, releaseId);
		await assertTrackInRelease(trackId, releaseId);
		await renameTrack(trackId, title);

		void getBandRelease({ slug, releaseId }).refresh();
		return { success: true };
	}
);

export const deleteTrackForm = form(
	z.object({
		slug: z.string().min(1),
		releaseId: z.string().min(1),
		trackId: z.string().min(1)
	}),
	async ({ slug, releaseId, trackId }) => {
		await requireFeature('bandAudio');
		await requireReleaseAdmin(slug, releaseId);
		await assertTrackInRelease(trackId, releaseId);
		await deleteTrack(trackId);

		void getBandRelease({ slug, releaseId }).refresh();
		void getBandMusicPage(slug).refresh();
		return { success: true };
	}
);

export const reorderTracksCommand = command(
	z.object({
		slug: z.string().min(1),
		releaseId: z.string().min(1),
		trackIds: z.array(z.string().min(1)).max(200)
	}),
	async ({ slug, releaseId, trackIds }) => {
		await requireFeature('bandAudio');
		await requireReleaseAdmin(slug, releaseId);
		await reorderTracks(releaseId, trackIds);

		void getBandRelease({ slug, releaseId }).refresh();
	}
);

/**
 * A track id belongs to the release the caller was authorized for.
 *
 * `requireReleaseAdmin` proves the caller may edit *this release*; without this
 * second check a band admin could pass any other band's track id and rename or
 * delete it, since `renameTrack` and `deleteTrack` take a bare id.
 */
async function assertTrackInRelease(trackId: string, releaseId: string) {
	const tracks = await listTracks(releaseId);
	if (!tracks.some((t) => t.id === trackId)) throw error(404, 'Track not found');
}

// ---------------------------------------------------------------------------
// Payouts
// ---------------------------------------------------------------------------

/**
 * Whether this band can be paid, and what Stripe still wants if not.
 *
 * Owner-or-admin rather than member: this is banking setup, and the
 * `requirementsDue` list names the documents Stripe is asking a specific person
 * for. A plain member has no business reading it.
 */
export const getBandPayouts = query(z.string(), async (slug) => {
	await requireFeature('bandAudio');
	const { group: band } = await requireGroupRole({ slug }, 'admin', { allowStaff: true });
	const status = await getPayoutStatus(band.id);

	return {
		...status,
		/** Paid releases cannot be published without this. Free ones are unaffected. */
		canSell: status.chargesEnabled
	};
});

/**
 * Begin, or resume, Stripe's onboarding.
 *
 * Returns a URL rather than redirecting. A thrown redirect from a remote form is
 * applied as a client navigation, and account links are single-use and expire in
 * minutes — so the page sends the browser off itself, immediately, rather than
 * letting the URL sit in history where a back button would replay a dead link.
 *
 * `refreshUrl` is where Stripe sends someone whose link went stale, and it points
 * back at this same page so the flow restarts rather than erroring.
 */
export const startPayoutOnboarding = form(
	z.object({ slug: z.string().min(1) }),
	async ({ slug }) => {
		await requireFeature('bandAudio');
		const { group: band, user } = await requireGroupRole({ slug }, 'admin');

		const { url: pageUrl } = getRequestEvent();
		const returnTo = new URL(`/band/${slug}/music/payouts`, pageUrl.origin).toString();

		const url = await createOnboardingLink({
			groupId: band.id,
			bandName: band.name,
			email: user.email,
			returnUrl: returnTo,
			refreshUrl: returnTo
		});

		return { success: true, url };
	}
);

/** A link into Stripe's own dashboard — where bank details and payout history live. */
export const openPayoutDashboard = form(z.object({ slug: z.string().min(1) }), async ({ slug }) => {
	await requireFeature('bandAudio');
	const { group: band } = await requireGroupRole({ slug }, 'admin');
	return { success: true, url: await createDashboardLink(band.id) };
});

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/**
 * What a release costs.
 *
 * Its own form, like radio consent, and for the same reason: a price folded into
 * the metadata form takes effect only when somebody remembers to press Save on
 * a card about titles and descriptions.
 *
 * `priceMinCents` is a `MoneyField`, which drops the field entirely when the box
 * is cleared — so an absent value means "not touched", and free is `0` typed
 * explicitly. `.optional().default(false)` on the boolean because an unchecked
 * checkbox posts nothing at all.
 */
export const updatePricingForm = form(
	z.object({
		slug: z.string().min(1),
		releaseId: z.string().min(1),
		priceMinCents: z
			.number()
			.int()
			.min(0)
			.refine(
				(cents) => cents === 0 || cents >= AUDIO_MIN_PRICE_CENTS,
				`Free, or at least $${(AUDIO_MIN_PRICE_CENTS / 100).toFixed(2)} — below that, card fees take almost all of it.`
			)
			.optional(),
		allowPayMore: z.boolean().optional().default(false)
	}),
	async ({ slug, releaseId, priceMinCents, allowPayMore }) => {
		await requireFeature('bandAudio');
		await requireReleaseAdmin(slug, releaseId);

		await updateRelease(releaseId, {
			// A cleared box is indistinguishable from an untouched one, so absent
			// leaves the price alone rather than silently making the record free.
			...(priceMinCents === undefined ? {} : { priceMinCents }),
			allowPayMore
		});

		void getBandRelease({ slug, releaseId }).refresh();
		void getBandMusicPage(slug).refresh();
		return { success: true };
	}
);
