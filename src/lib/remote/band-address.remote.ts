import { z } from 'zod';
import { invalid } from '@sveltejs/kit';
import { form } from '$app/server';
import { requireGroupRole } from '$lib/server/group/group-context';
import { allowRateLimited } from '$lib/server/rate-limit';
import {
	MAX_BAND_SLUG_LENGTH,
	SlugUnavailableError,
	assertValidBandSlug,
	changeBandSlug,
	normalizeBandSlug
} from '$lib/server/band/band-address-service';

/**
 * A band's free address — {slug}.corvmc.org and everything else keyed on the
 * slug. Deliberately NOT in band-custom-domain.remote.ts: every export there
 * runs through `requirePremiumOwner()`, and co-locating a free feature with the
 * paid one invites it to inherit that gate by accident.
 *
 * Owner-only, matching custom domains — the address is the band's public
 * identity, while admins can still rename and edit the profile.
 */

/** Three changes per 30 days: room for a real move plus a typo fix, not enough to churn. */
const MAX_CHANGES = 3;
const CHANGE_WINDOW_SECONDS = 60 * 60 * 24 * 30;

export const changeBandAddress = form(
	z.object({
		slug: z.string().min(1),
		newSlug: z.string().trim().min(1).max(MAX_BAND_SLUG_LENGTH)
	}),
	async (data, issue) => {
		// Two slugs, and the distinction is the whole reason `newSlug` is named
		// that. `slug` is the ref — a lookup key the guard resolves before
		// checking the caller's own ownership on the resolved band, so a spoofed
		// one lands somewhere they own nothing. `newSlug` is the *desired*
		// address and is never a lookup key; feeding it to the guard would let a
		// rename authorize itself against whatever band already holds the name.
		const { group: band } = await requireGroupRole({ slug: data.slug }, 'owner');

		const next = normalizeBandSlug(data.newSlug);
		try {
			assertValidBandSlug(next);
		} catch (err) {
			if (err instanceof SlugUnavailableError) invalid(issue.newSlug(err.message));
			throw err;
		}

		// Resubmitting the current address is a no-op, not a spent change.
		if (next === band.slug) return { success: true, slug: band.slug, changed: false };

		// Surfaced as a field issue rather than `throw error(429)`: the Form
		// component routes a thrown error into `onfailure(issues)`, which carries no
		// message, so the owner would get a generic toast instead of the reason.
		// Both are Sentry-safe — 4xx statuses are filtered in report-error.ts.
		if (!(await allowRateLimited(`band-slug:${band.id}`, MAX_CHANGES, CHANGE_WINDOW_SECONDS))) {
			invalid(
				issue.newSlug(
					"You've changed this band's address too many times recently. Get in touch if you need another change."
				)
			);
		}

		try {
			const result = await changeBandSlug(band.id, next);
			// Refresh nothing. Every band-scoped query is keyed on the OLD slug (the
			// route param comes from the `x-sveltekit-pathname` header the client
			// sent), so refreshing here would 404 and drop the page that just saved
			// into an error state. The client navigates to the new address instead.
			return { success: true, slug: result.slug, changed: result.status === 'changed' };
		} catch (err) {
			if (err instanceof SlugUnavailableError) invalid(issue.newSlug(err.message));
			throw err;
		}
	}
);
