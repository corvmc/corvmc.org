import { z } from 'zod';
import { mapDomainError } from '$lib/server/errors';
import { error } from '@sveltejs/kit';
import { query, form } from '$app/server';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { band as bandTable } from '$lib/server/db/schema/band';
import { requireBandOwner } from '$lib/server/band/band-context';
import { requireUser } from '$lib/server/authorization';
import { requireFeature } from '$lib/server/feature-flags';
import { getBySlug, getUserRole } from '$lib/server/band/band-service';
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
 * Each function re-derives the band from the caller's owner role rather than
 * trusting the slug it was handed: remote functions take route params from a
 * client-supplied header, so the guard has to live in the handler.
 */

/** Owner-only, premium-only. Returns the band alongside its domain state. */
async function requirePremiumOwner() {
	await requireFeature('bandPremium');
	const ctx = await requireBandOwner();
	if (ctx.band.tier !== 'premium') {
		throw error(403, 'Custom domains are part of the premium plan.');
	}
	return ctx;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getCustomDomain = query(z.string(), async (slug) => {
	await requireFeature('bandPremium');
	const user = requireUser();
	const band = await getBySlug(slug);
	if (!band) throw error(404, 'Band not found');

	// Band-private configuration — the verification records included below are
	// the band's own DNS setup. The slug is caller-supplied, so this has to be
	// checked here rather than left to whichever page happens to render it.
	const role = await getUserRole(band.id, user.id);
	if (role !== 'owner') throw error(403, 'Only the band owner can manage the custom domain.');

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
		const { band } = await requirePremiumOwner();

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
				.update(bandTable)
				.set({
					customDomain: state.domain,
					customDomainStatus: state.status,
					customDomainHostnameId: state.hostnameId,
					customDomainVerification: state.verification,
					customDomainAddedAt: new Date(),
					updatedAt: new Date()
				})
				.where(eq(bandTable.id, band.id));

			await forgetCustomDomain(state.domain);
			return { success: true, status: state.status };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

/** Re-reads Cloudflare's view of the hostname — the "Check status" button. */
export const refreshCustomDomain = form(z.object({ slug: z.string().min(1) }), async () => {
	const { band } = await requirePremiumOwner();
	if (!band.customDomainHostnameId || !band.customDomain) {
		throw error(400, 'No custom domain to check.');
	}

	try {
		const { status, verification } = await readCustomHostname(band.customDomainHostnameId);

		await db
			.update(bandTable)
			.set({
				customDomainStatus: status,
				customDomainVerification: verification,
				updatedAt: new Date()
			})
			.where(eq(bandTable.id, band.id));

		// The router caches hostname → band; a domain that just went active has to
		// start resolving now, not in five minutes.
		await forgetCustomDomain(band.customDomain);
		return { success: true, status };
	} catch (err) {
		mapDomainError(err);
	}
});

export const removeCustomDomain = form(z.object({ slug: z.string().min(1) }), async () => {
	const { band } = await requirePremiumOwner();
	if (!band.customDomain) throw error(400, 'No custom domain to remove.');

	try {
		if (band.customDomainHostnameId) {
			await deleteCustomHostname(band.customDomainHostnameId, band.customDomain);
		}

		await db
			.update(bandTable)
			.set({
				customDomain: null,
				customDomainStatus: null,
				customDomainHostnameId: null,
				customDomainVerification: null,
				customDomainAddedAt: null,
				updatedAt: new Date()
			})
			.where(eq(bandTable.id, band.id));

		await forgetCustomDomain(band.customDomain);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});
