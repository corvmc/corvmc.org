/**
 * Custom domains for premium bands, backed by Cloudflare for SaaS custom
 * hostnames.
 *
 * Flow: the band enters `theband.com` → we create a custom hostname with TXT
 * validation → they add two TXT records at their registrar → once Cloudflare
 * reports the hostname and its certificate active, they point the domain at our
 * CNAME target and it serves their site.
 *
 * TXT rather than HTTP validation on purpose: the band proves ownership and
 * gets a certificate issued *before* cutting DNS over, so there is never a
 * window where their live site is down waiting on us.
 */
import { env } from '$env/dynamic/private';
import { DomainError } from '../domain-error';
import { env as publicEnv } from '$env/dynamic/public';
import { eq, and, isNull, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { band } from '$lib/server/db/schema/band';
import { baseDomainFromSiteUrl } from '$lib/utils/band-site-url';
import { forgetCustomDomain } from './band-host-service';
import type { CustomDomainStatus, CustomDomainVerification } from '$lib/server/db/schema/band';

const API_BASE = 'https://api.cloudflare.com/client/v4';

export class CustomDomainError extends DomainError {
	readonly httpStatus = 400;
}

/**
 * Where bands point their domain. A CNAME at our zone rather than the fallback
 * origin directly, so the origin can move without every band re-pointing DNS.
 */
export function cnameTarget(): string {
	return `domains.${baseDomainFromSiteUrl(publicEnv.PUBLIC_SITE_URL)}`;
}

/**
 * Custom domains need Cloudflare credentials. Without them the feature reports
 * itself unavailable rather than throwing halfway through a band's setup.
 */
export function isCustomDomainConfigured(): boolean {
	return Boolean(env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ZONE_ID);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Deliberately strict: at least two labels, letters/digits/hyphens only, no
// leading or trailing hyphen, TLD of 2+ letters. Rejects URLs, ports, paths,
// and anything with a userinfo or wildcard in it.
const HOSTNAME = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,}$/;

/**
 * Normalise and check a domain a band wants to claim. Returns the hostname to
 * store; throws CustomDomainError with a message meant for the band.
 */
export function normalizeCustomDomain(input: string): string {
	const host = input
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, '')
		.replace(/\/.*$/, '')
		.replace(/\.$/, '');

	if (!host) throw new CustomDomainError('Enter a domain.');
	if (host.length > 253) throw new CustomDomainError('That domain is too long.');
	if (!HOSTNAME.test(host)) {
		throw new CustomDomainError(
			'That does not look like a domain. Enter it as theband.com — no http:// and no trailing path.'
		);
	}
	if (host.split('.').length > 3) {
		throw new CustomDomainError(
			'Use a domain or a single subdomain, like theband.com or www.theband.com.'
		);
	}

	// Our own zone is handed out for free as {slug}.corvmc.org; letting a band
	// claim one here would collide with the subdomain router.
	const baseDomain = baseDomainFromSiteUrl(publicEnv.PUBLIC_SITE_URL);
	if (host === baseDomain || host.endsWith(`.${baseDomain}`)) {
		throw new CustomDomainError(
			`${baseDomain} addresses are assigned automatically — every band already has one.`
		);
	}

	return host;
}

/** Throws if another band already claimed this domain. */
export async function assertDomainUnclaimed(host: string, bandId: string): Promise<void> {
	const [existing] = await db
		.select({ id: band.id })
		.from(band)
		.where(and(eq(band.customDomain, host), ne(band.id, bandId), isNull(band.deletedAt)))
		.limit(1);

	if (existing) throw new CustomDomainError('That domain is already connected to another band.');
}

// ---------------------------------------------------------------------------
// Cloudflare API
// ---------------------------------------------------------------------------

type CloudflareHostname = {
	id: string;
	status: string;
	ssl?: {
		status?: string;
		validation_records?: Array<{ txt_name?: string; txt_value?: string }>;
	};
	ownership_verification?: { name?: string; value?: string };
};

async function cloudflare<T>(path: string, init?: RequestInit): Promise<T> {
	if (!isCustomDomainConfigured()) {
		throw new CustomDomainError('Custom domains are not configured on this site yet.');
	}

	const response = await fetch(`${API_BASE}/zones/${env.CLOUDFLARE_ZONE_ID}${path}`, {
		...init,
		headers: {
			authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
			'content-type': 'application/json',
			...init?.headers
		}
	});

	const body = (await response.json()) as {
		success: boolean;
		result: T;
		errors?: Array<{ message: string }>;
	};

	if (!response.ok || !body.success) {
		// Cloudflare's messages are specific and safe to show ("Duplicate custom
		// hostname found", "hostname is not valid"), which beats a generic failure.
		const detail = body.errors?.map((e) => e.message).join('; ');
		throw new CustomDomainError(detail || 'Cloudflare rejected that domain.');
	}

	return body.result;
}

/** The verification records a band must add, extracted from a Cloudflare hostname. */
function verificationFrom(hostname: CloudflareHostname): CustomDomainVerification {
	const ssl = hostname.ssl?.validation_records?.[0];
	return {
		ownership:
			hostname.ownership_verification?.name && hostname.ownership_verification.value
				? {
						name: hostname.ownership_verification.name,
						value: hostname.ownership_verification.value
					}
				: null,
		ssl: ssl?.txt_name && ssl.txt_value ? { name: ssl.txt_name, value: ssl.txt_value } : null,
		cnameTarget: cnameTarget()
	};
}

/** Cloudflare reports two statuses; the domain only works when both are active. */
function statusFrom(hostname: CloudflareHostname): CustomDomainStatus {
	if (hostname.status === 'active' && hostname.ssl?.status === 'active') return 'active';
	// Cloudflare's terminal failures all contain these words; everything else is
	// still in flight (pending_validation, pending_issuance, initializing…).
	if (/deleted|moved|blocked|timed_out/i.test(hostname.status)) return 'failed';
	return 'pending';
}

export type CustomDomainState = {
	domain: string;
	status: CustomDomainStatus;
	hostnameId: string;
	verification: CustomDomainVerification;
};

/** Register a hostname with Cloudflare and return what the band must do next. */
export async function createCustomHostname(host: string): Promise<CustomDomainState> {
	const result = await cloudflare<CloudflareHostname>('/custom_hostnames', {
		method: 'POST',
		body: JSON.stringify({
			hostname: host,
			ssl: { method: 'txt', type: 'dv', settings: { min_tls_version: '1.2' } }
		})
	});

	return {
		domain: host,
		status: statusFrom(result),
		hostnameId: result.id,
		verification: verificationFrom(result)
	};
}

/** Re-read a hostname's status — what the band's "Check status" button calls. */
export async function readCustomHostname(hostnameId: string): Promise<{
	status: CustomDomainStatus;
	verification: CustomDomainVerification;
}> {
	const result = await cloudflare<CloudflareHostname>(`/custom_hostnames/${hostnameId}`);
	return { status: statusFrom(result), verification: verificationFrom(result) };
}

/**
 * Remove a hostname. Cloudflare 404s if it is already gone — that is a success
 * for our purposes, since the goal is "this band no longer owns this hostname".
 */
export async function deleteCustomHostname(hostnameId: string, host: string): Promise<void> {
	try {
		await cloudflare(`/custom_hostnames/${hostnameId}`, { method: 'DELETE' });
	} catch (error) {
		if (!(error instanceof CustomDomainError)) throw error;
		if (!/not found|could not be found/i.test(error.message)) throw error;
	}
	await forgetCustomDomain(host);
}
