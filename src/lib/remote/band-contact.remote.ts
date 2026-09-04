/**
 * The one way a stranger reaches an act.
 *
 * Public pages publish no address of any kind — not the booking email, not a
 * phone number — so this form is the only route in, and there is nothing on the
 * page for a scraper to take. Where the message actually lands is the band's
 * own booking contact, which lives in the press kit and is never rendered.
 *
 * It was premium once, sitting on the microsite behind a `tier !== 'premium'`
 * 404 and a feature flag. Both are gone. Turnstile plus the KV rate limit were
 * always what made it safe to expose, and neither of those is a tier.
 */
import { z } from 'zod';
import { error, invalid } from '@sveltejs/kit';
import { form, getRequestEvent } from '$app/server';
import { eq, and, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db } from '$lib/server/db';
import { group, groupMember } from '$lib/server/db/schema/group';
import { bandSite } from '$lib/server/db/schema/band-site';
import { directoryEntry } from '$lib/server/db/schema/directory';
import { user } from '$lib/server/db/schema/authentication';
import { verifyTurnstile } from '$lib/server/turnstile';
import { allowRateLimited } from '$lib/server/rate-limit';
import { dispatchEmailOnly } from '$lib/server/notification/dispatcher';
import type { NotificationEmailModel } from '$lib/types/notification-email';
import type { BandEpk } from '$lib/types/band-page';

/** The address a band put on its profile, back when that field was published. */
function profileEmail(contact: unknown): string | undefined {
	const email = (contact as { email?: unknown } | null)?.email;
	return typeof email === 'string' && email ? email : undefined;
}

/** The roster row that defines ownership — see `band-service.ts`. */
const ownerMember = alias(groupMember, 'owner_member');

// ---------------------------------------------------------------------------
// Band Site Contact Form — public, delivers to the band's booking contact
// ---------------------------------------------------------------------------

const contactFormSchema = z.object({
	slug: z.string().min(1).max(200),
	name: z.string().trim().min(1).max(200),
	email: z.string().trim().email().max(254),
	message: z.string().trim().min(1).max(5000),
	turnstileToken: z.string()
});

export const submitBandContactForm = form(contactFormSchema, async (data, issue) => {
	const ip = getRequestEvent().request.headers.get('CF-Connecting-IP');
	if (!(await verifyTurnstile(data.turnstileToken, ip))) {
		invalid(issue.turnstileToken('Verification failed. Please try again.'));
	}

	const [bandRow] = await db
		.select({
			id: group.id,
			name: group.name,
			// The owner is the roster row since phase 3c, and the seat can be
			// empty — the fallback below already handles a missing address.
			ownerId: ownerMember.userId,
			contact: directoryEntry.contact
		})
		.from(group)
		.leftJoin(directoryEntry, eq(directoryEntry.groupId, group.id))
		.leftJoin(
			ownerMember,
			and(
				eq(ownerMember.groupId, group.id),
				eq(ownerMember.role, 'owner'),
				eq(ownerMember.status, 'active')
			)
		)
		.where(and(eq(group.slug, data.slug), isNull(group.deletedAt)))
		.limit(1);

	if (!bandRow) throw error(404, 'Band not found');

	// Soft throttle on top of Turnstile (KV is eventually consistent)
	if (!(await allowRateLimited(`band-contact:${bandRow.id}:${ip ?? 'unknown'}`, 5, 3600))) {
		throw error(429, 'Too many messages — please try again later');
	}

	// Deliver to the EPK booking contact, falling back to the band owner
	const [config] = await db
		.select({ epk: bandSite.epk })
		.from(bandSite)
		.where(eq(bandSite.groupId, bandRow.id))
		.limit(1);
	const epk = config?.epk as BandEpk | null | undefined;

	// Three places, in order of how deliberately the band chose them: the press
	// kit's booking contact, the address on their profile, then whoever owns the
	// act. The middle one exists because that field used to be *published* as the
	// band's booking address — a band that filled it in and never opened the press
	// kit still gets its enquiries.
	let toEmail = epk?.bookingContact?.email || profileEmail(bandRow.contact);
	if (!toEmail && bandRow.ownerId) {
		const [owner] = await db
			.select({ email: user.email })
			.from(user)
			.where(eq(user.id, bandRow.ownerId))
			.limit(1);
		toEmail = owner?.email;
	}
	if (!toEmail) throw error(500, 'This band has no contact email configured');

	const model: NotificationEmailModel = {
		subject: `New booking enquiry — ${bandRow.name}`,
		heading: 'New enquiry',
		preview_text: `${data.name}: ${data.message.slice(0, 100)}`,
		paragraphs: [{ text: `Someone used the contact form on ${bandRow.name}'s public page.` }],
		details: [
			{ label: 'From', value: data.name },
			{ label: 'Email', value: data.email }
		],
		// Raw — the dispatcher escapes it and preserves the line breaks.
		quote: data.message,
		footnote: 'Reply directly to the sender at the email address above.'
	};

	await dispatchEmailOnly({
		type: 'band_site_contact',
		toEmail,
		templateAlias: 'notification',
		model: model as unknown as Record<string, unknown>
	});

	return { success: true };
});
