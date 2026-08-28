import { z } from 'zod';
import { mapDomainError } from '$lib/server/errors';
import { error } from '@sveltejs/kit';
import { query, form } from '$app/server';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { bandSite } from '$lib/server/db/schema/band-site';
import { requireGroupRole } from '$lib/server/group/group-context';
import { requireFeature } from '$lib/server/feature-flags';
import {
	assertDomainUnclaimed,
	cnameTarget,
	createCustomHostname,
	deleteCustomHostname,
	isCustomDomainConfigured,
	normalizeCustomDomain,
	readCustomHostname
} from '$lib/server/band/custom-domain-service';
import { forgetCustomDomain } from '$lib/server/band/band-host-service';

/**
 * Custom domains are the paid half of band addressing — every band gets
 * {slug}.corvmc.org free, premium bands can bring their own domain.
 *
 * Every function here takes the slug as an argument and hands it to the guard.
 * That is a lookup key, not a capability: the guard resolves the band from it
 * and then checks the caller's own ownership on the *resolved* band, so a
 * spoofed slug lands somewhere the caller owns nothing and yields 403. The
 * slugs these forms already carried were previously ignored for want of a
 * guard that could take one.
 */

/** Owner-only, premium-only. Returns the band alongside its domain state. */
async function requirePremiumOwner(slug: string) {
	await requireFeature('bandPremium');
	const ctx = await requireGroupRole({ slug }, 'owner');
	if (ctx.group.tier !== 'premium') {
		throw error(403, 'Custom domains are part of the premium plan.');
	}
	return ctx;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getCustomDomain = query(z.string(), async (slug) => {
	await requireFeature('bandPremium');
	// Band-private configuration — the verification records below are the band's
	// own DNS setup, which is why this hand-rolled its own owner check before
	// there was a guard that took a ref. Not `requirePremiumOwner`: a band that
	// let its subscription lapse still has to be able to read, and remove, the
	// domain it configured while premium.
	const { group: band } = await requireGroupRole({ slug }, 'owner');

	return {
		tier: band.tier,
		configured: isCustomDomainConfigured(),
		cnameTarget: cnameTarget(),
		domain: band.customDomain,
		status: band.customDomainStatus,
		verification: band.customDomainVerification
	};
});

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export const setCustomDomain = form(
	z.object({ slug: z.string().min(1), domain: z.string().min(1).max(253) }),
	async (data) => {
		const { group: band } = await requirePremiumOwner(data.slug);

		try {
			const host = normalizeCustomDomain(data.domain);
			await assertDomainUnclaimed(host, band.id);

			// Replacing a domain: release the old hostname first so Cloudflare
			// doesn't keep serving a certificate for a domain we no longer claim.
			if (band.customDomainHostnameId && band.customDomain) {
				await deleteCustomHostname(band.customDomainHostnameId, band.customDomain);
			}

			const state = await createCustomHostname(host);

			await db
				.update(bandSite)
				.set({
					customDomain: state.domain,
					customDomainStatus: state.status,
					customDomainHostnameId: state.hostnameId,
					customDomainVerification: state.verification,
					customDomainAddedAt: new Date(),
					updatedAt: new Date()
				})
				.where(eq(bandSite.groupId, band.id));

			await forgetCustomDomain(state.domain);
			return { success: true, status: state.status };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

/** Re-reads Cloudflare's view of the hostname — the "Check status" button. */
export const refreshCustomDomain = form(z.object({ slug: z.string().min(1) }), async (data) => {
	const { group: band } = await requirePremiumOwner(data.slug);
	if (!band.customDomainHostnameId || !band.customDomain) {
		throw error(400, 'No custom domain to check.');
	}

	try {
		const { status, verification } = await readCustomHostname(band.customDomainHostnameId);

		await db
			.update(bandSite)
			.set({
				customDomainStatus: status,
				customDomainVerification: verification,
				updatedAt: new Date()
			})
			.where(eq(bandSite.groupId, band.id));

		// The router caches hostname → band; a domain that just went active has to
		// start resolving now, not in five minutes.
		await forgetCustomDomain(band.customDomain);
		return { success: true, status };
	} catch (err) {
		mapDomainError(err);
	}
});

export const removeCustomDomain = form(z.object({ slug: z.string().min(1) }), async (data) => {
	const { group: band } = await requirePremiumOwner(data.slug);
	if (!band.customDomain) throw error(400, 'No custom domain to remove.');

	try {
		if (band.customDomainHostnameId) {
			await deleteCustomHostname(band.customDomainHostnameId, band.customDomain);
		}

		await db
			.update(bandSite)
			.set({
				customDomain: null,
				customDomainStatus: null,
				customDomainHostnameId: null,
				customDomainVerification: null,
				customDomainAddedAt: null,
				updatedAt: new Date()
			})
			.where(eq(bandSite.groupId, band.id));

		await forgetCustomDomain(band.customDomain);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});
