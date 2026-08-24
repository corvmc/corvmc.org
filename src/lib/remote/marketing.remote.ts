import { z } from 'zod';
import { toGenericRef } from '$lib/server/entity/refs';
import { LONG_TEXT_MAX, SHORT_TEXT_MAX } from '$lib/config';
import { error, invalid } from '@sveltejs/kit';
import { query, form, command, getRequestEvent } from '$app/server';
import { verifyTurnstile } from '$lib/server/turnstile';
import { requireStaff } from '$lib/server/authorization';
import { requireFeature } from '$lib/server/feature-flags';
import {
	listAudiences,
	getAudience,
	getAudienceBySlug,
	getOptInAudiences,
	createAudience as createAudienceService,
	updateAudience as updateAudienceService,
	deleteAudience as deleteAudienceService,
	addSubscriber as addSubscriberService,
	removeSubscriber as removeSubscriberService,
	unsubscribe,
	bulkAddMembers as bulkAddMembersService,
	listSubscribers,
	getSubscriptionsForUser
} from '$lib/server/marketing/audience-service';
import {
	listCampaigns,
	getCampaign,
	createCampaign,
	updateCampaign,
	deleteCampaign as deleteCampaignService,
	sendNow,
	scheduleCampaign as scheduleCampaignService,
	unscheduleCampaign as unscheduleCampaignService,
	renderCampaignPreview,
	type CampaignStatus
} from '$lib/server/marketing/campaign-service';
import {
	findOrCreateByEmail,
	findByUserId as findSubscriberByUserId,
	suppressSelfService,
	clearSelfServiceSuppression
} from '$lib/server/marketing/subscriber-service';
import { verifyUnsubscribeToken } from '$lib/server/marketing/unsubscribe';
import { generateSlug, ensureUniqueSlug } from '$lib/server/utils/slug';
import { audience } from '$lib/server/db/schema/marketing';

// ---------------------------------------------------------------------------
// Public queries
// ---------------------------------------------------------------------------

export const getPublicAudienceBySlug = query(z.string(), async (slug) => {
	await requireFeature('emailMarketing');
	const aud = await getAudienceBySlug(slug);
	if (!aud || !aud.allowOptIn) throw error(404, 'List not found');
	return {
		audience: {
			id: aud.id,
			name: aud.name,
			slug: aud.slug,
			description: aud.description
		}
	};
});

export const subscribeToAudience = form(
	z.object({
		slug: z.string(),
		email: z.string().email(),
		name: z.string().optional(),
		turnstileToken: z.string().min(1)
	}),
	async (data, issue) => {
		await requireFeature('emailMarketing');
		const ip = getRequestEvent().request.headers.get('CF-Connecting-IP');
		if (!(await verifyTurnstile(data.turnstileToken, ip))) {
			invalid(issue.turnstileToken('Verification failed. Please try again.'));
		}
		const aud = await getAudienceBySlug(data.slug);
		if (!aud || !aud.allowOptIn) throw error(404, 'List not found');
		const sub = await findOrCreateByEmail(data.email.trim().toLowerCase(), data.name?.trim());
		// Signing up again is an explicit request for mail, so it lifts a previous
		// "unsubscribe from all" — otherwise this form would report success while
		// suppression silently kept every campaign away.
		await clearSelfServiceSuppression(sub.id);
		await addSubscriberService(aud.id, sub.id);
		return { success: true };
	}
);

/**
 * Resolve an unsubscribe token for display. **Read-only.**
 *
 * This is a `query`, so it answers a GET. It used to call `unsubscribe()` here,
 * which meant anything that fetches a URL without a person deciding to —
 * link-prefetching mail clients, corporate URL-rewriting security scanners,
 * chat unfurlers — silently unsubscribed the recipient just for receiving or
 * forwarding the email. The write now lives in `confirmUnsubscribe` below and
 * only happens on an explicit POST.
 */
export const getUnsubscribeInfo = query(z.string(), async (token) => {
	await requireFeature('emailMarketing');
	const decoded = verifyUnsubscribeToken(token);
	if (!decoded) return { valid: false as const, audienceName: null };

	const aud = await getAudience(decoded.audienceId);
	if (!aud) return { valid: false as const, audienceName: null };

	return { valid: true as const, audienceName: aud.name };
});

/**
 * Perform the unsubscribe. POST-only, from the confirm button on the
 * unsubscribe page.
 *
 * Separate from the RFC 8058 one-click handler in
 * `src/routes/(public)/unsubscribe/[token]/+page.server.ts`: that one serves
 * mail clients that POST the URL with no UI at all, and is deliberately not
 * feature-gated. This one is the human-facing path.
 */
export const confirmUnsubscribe = form(
	z.object({ token: z.string().min(1) }),
	async ({ token }) => {
		await requireFeature('emailMarketing');
		const decoded = verifyUnsubscribeToken(token);
		if (!decoded) return { valid: false as const, audienceName: null };

		const aud = await getAudience(decoded.audienceId);
		if (!aud) return { valid: false as const, audienceName: null };

		await unsubscribe(decoded.subscriberId, decoded.audienceId);
		return { valid: true as const, audienceName: aud.name };
	}
);

/**
 * Global opt-out — "unsubscribe from all", offered after the single-audience
 * unsubscribe on the same page.
 *
 * This exists because the one-list-only flow is what drives spam complaints:
 * someone leaves one list, keeps receiving mail from another, and concludes
 * unsubscribing is broken. A complaint costs far more than a lost subscriber.
 *
 * Not offered to the RFC 8058 one-click handler, which must do exactly what it
 * says and leave only the audience its token names.
 */
export const confirmUnsubscribeAll = form(
	z.object({ token: z.string().min(1) }),
	async ({ token }) => {
		await requireFeature('emailMarketing');
		const decoded = verifyUnsubscribeToken(token);
		if (!decoded) return { valid: false as const };

		await suppressSelfService(decoded.subscriberId);
		return { valid: true as const };
	}
);

// ---------------------------------------------------------------------------
// Staff queries
// ---------------------------------------------------------------------------

/** List all audiences (staff). Used on audiences index and as audience options. */
export const getAudiences = query(z.void(), async () => {
	await requireStaff();
	const rows = await listAudiences();
	return rows.map((a) => ({
		...a,
		ref: toGenericRef('audience', { id: a.id, title: a.name, subtitle: a.description })
	}));
});

/** Alias for getAudiences, used in campaign editor audience pickers. */
export const getAudienceOptions = getAudiences;

/** Public: opt-in audiences (no auth required). */
export const getPublicAudiences = query(z.void(), async () => {
	await requireFeature('emailMarketing');
	return getOptInAudiences();
});

/** Single audience detail (staff). */
export const getAudienceDetail = query(z.string(), async (id) => {
	await requireStaff();
	return getAudience(id);
});

/** List subscribers for an audience. */
export const getAudienceSubscribers = query(z.string(), async (audienceId) => {
	await requireStaff();
	return listSubscribers(audienceId);
});

/** List campaigns with optional status filter. */
export const getCampaigns = query(z.object({ status: z.string().optional() }), async (filters) => {
	await requireStaff();
	const statusFilter = ['draft', 'scheduled', 'sending', 'sent'].includes(filters.status ?? '')
		? (filters.status as CampaignStatus)
		: undefined;
	const rows = await listCampaigns(statusFilter);
	return rows.map((c) => ({
		...c,
		// The campaign's own status has its column, so the ref carries none. The
		// audiences it sends to are the subline, as they were before they were a
		// column of their own.
		ref: toGenericRef('campaign', {
			id: c.id,
			title: c.subject,
			subtitle: c.audienceNames.length > 0 ? c.audienceNames.join(', ') : '—'
		})
	}));
});

/** Single campaign detail (staff). */
export const getCampaignDetail = query(z.string(), async (id) => {
	await requireStaff();
	return getCampaign(id);
});

/** Render markdown to campaign HTML preview. */
export const getPreview = query(z.string(), async (markdown) => {
	await requireStaff();
	if (!markdown.trim()) return '';
	return renderCampaignPreview(markdown);
});

// ---------------------------------------------------------------------------
// Forms — Audiences
// ---------------------------------------------------------------------------

export const createAudience = form(
	z.object({
		name: z.string().min(1).max(SHORT_TEXT_MAX),
		slug: z.string().max(100).optional(),
		description: z.string().max(LONG_TEXT_MAX).optional(),
		allowOptIn: z.boolean().default(false)
	}),
	async (data, issue) => {
		await requireStaff();

		const name = (data.name as string).trim();
		if (!name) {
			invalid(issue.name('Name is required'));
		}

		const baseSlug = (data.slug as string)?.trim() || generateSlug(name);
		const slug = await ensureUniqueSlug(baseSlug, audience, audience.slug);

		const created = await createAudienceService({
			name,
			slug,
			description: (data.description as string)?.trim() || undefined,
			allowOptIn: data.allowOptIn
		});

		void getAudiences().refresh();
		return { audienceId: created.id };
	}
);

export const updateAudience = form(
	z.object({
		id: z.string(),
		name: z.string().max(SHORT_TEXT_MAX).optional(),
		description: z.string().max(LONG_TEXT_MAX).optional(),
		allowOptIn: z.boolean().default(false)
	}),
	async (data) => {
		await requireStaff();

		const id = data.id as string;
		await updateAudienceService(id, {
			name: data.name ? (data.name as string).trim() : undefined,
			description: data.description !== undefined ? (data.description as string).trim() : undefined,
			allowOptIn: data.allowOptIn
		});

		void getAudienceDetail(id).refresh();
		return { success: true };
	}
);

export const deleteAudience = form(
	z.object({
		id: z.string()
	}),
	async (data) => {
		await requireStaff();
		await deleteAudienceService(data.id as string);
		void getAudiences().refresh();
		return { success: true };
	}
);

export const bulkAddMembers = form(
	z.object({
		audienceId: z.string()
	}),
	async (data) => {
		await requireStaff();
		const count = await bulkAddMembersService(data.audienceId as string);
		void getAudienceSubscribers(data.audienceId as string).refresh();
		void getAudienceDetail(data.audienceId as string).refresh();
		return { added: count };
	}
);

export const addSubscriber = form(
	z.object({
		audienceId: z.string(),
		email: z.string().email(),
		name: z.string().max(SHORT_TEXT_MAX).optional()
	}),
	async (data, issue) => {
		await requireStaff();

		const email = (data.email as string).trim();
		if (!email) {
			invalid(issue.email('Email is required'));
		}

		const sub = await findOrCreateByEmail(email, (data.name as string)?.trim() || undefined);
		await addSubscriberService(data.audienceId as string, sub.id);

		void getAudienceSubscribers(data.audienceId as string).refresh();
		void getAudienceDetail(data.audienceId as string).refresh();
		return { success: true };
	}
);

export const removeSubscriber = form(
	z.object({
		audienceId: z.string(),
		subscriberId: z.string()
	}),
	async (data) => {
		await requireStaff();
		await removeSubscriberService(data.audienceId as string, data.subscriberId as string);
		void getAudienceSubscribers(data.audienceId as string).refresh();
		void getAudienceDetail(data.audienceId as string).refresh();
		return { success: true };
	}
);

// ---------------------------------------------------------------------------
// Forms — Campaigns
// ---------------------------------------------------------------------------

export const createDraft = command(
	z.object({
		subject: z.string().trim().min(1).max(500),
		markdownBody: z.string().min(1),
		audienceIds: z.array(z.string()).min(1).max(20)
	}),
	async (data) => {
		const user = await requireStaff();
		const campaign = await createCampaign({
			...data,
			sentById: user.id
		});
		return { campaignId: campaign.id };
	}
);

export const createAndSend = command(
	z.object({
		subject: z.string().trim().min(1).max(500),
		markdownBody: z.string().min(1),
		audienceIds: z.array(z.string()).min(1).max(20)
	}),
	async (data) => {
		const user = await requireStaff();
		const campaign = await createCampaign({
			...data,
			sentById: user.id
		});
		await sendNow(campaign.id);
		return { campaignId: campaign.id };
	}
);

export const createAndSchedule = command(
	z.object({
		subject: z.string().trim().min(1).max(500),
		markdownBody: z.string().min(1),
		audienceIds: z.array(z.string()).min(1).max(20),
		scheduledFor: z.string().transform((s) => new Date(s))
	}),
	async (data) => {
		const user = await requireStaff();
		const campaign = await createCampaign({
			subject: data.subject,
			markdownBody: data.markdownBody,
			audienceIds: data.audienceIds,
			sentById: user.id
		});
		await scheduleCampaignService(campaign.id, data.scheduledFor);
		return { campaignId: campaign.id };
	}
);

export const saveDraft = command(
	z.object({
		subject: z.string().trim().min(1).max(500),
		markdownBody: z.string().min(1),
		audienceIds: z.array(z.string()).min(1).max(20)
	}),
	async (data) => {
		await requireStaff();
		const { params } = getRequestEvent();
		const id = params.id!;
		await updateCampaign(id, data);
		void getCampaignDetail(id).refresh();
		return { success: true };
	}
);

export const sendCampaignNow = command(z.object({}), async () => {
	await requireStaff();
	const { params } = getRequestEvent();
	await sendNow(params.id!);
	return { success: true };
});

export const scheduleCampaign = command(
	z.object({
		scheduledFor: z.string().transform((s) => new Date(s))
	}),
	async (data) => {
		await requireStaff();
		const { params } = getRequestEvent();
		await scheduleCampaignService(params.id!, data.scheduledFor);
		return { success: true };
	}
);

export const deleteCampaign = command(z.object({}), async () => {
	await requireStaff();
	const { params } = getRequestEvent();
	await deleteCampaignService(params.id!);
	return { success: true };
});

export const unscheduleCampaign = form(
	z.object({
		campaignId: z.string()
	}),
	async (data) => {
		await requireStaff();
		await unscheduleCampaignService(data.campaignId as string);
		void getCampaignDetail(data.campaignId as string).refresh();
		return { success: true };
	}
);

// ---------------------------------------------------------------------------
// Staff user record (/staff/users/[id])
// ---------------------------------------------------------------------------
// Read-only, staff-guarded, and scoped by an explicit userId argument rather
// than `params.id`, which on a remote call comes from a caller-supplied header.
// ---------------------------------------------------------------------------

export const getUserMarketing = query(z.string(), async (userId) => {
	await requireStaff();
	const subscriber = await findSubscriberByUserId(userId);
	const audiences = subscriber ? await getSubscriptionsForUser(userId) : [];
	return {
		subscriber: subscriber
			? {
					id: subscriber.id,
					email: subscriber.email,
					suppressedAt: subscriber.suppressedAt,
					suppressionReason: subscriber.suppressionReason
				}
			: null,
		audiences
	};
});
