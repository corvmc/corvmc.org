/**
 * The one way a stranger reaches an act.
 *
 * Public pages publish no address of any kind — not the booking email, not a
 * phone number — so this form is the only route in, and there is nothing on the
 * page for a scraper to take.
 *
 * It was premium once, sitting on the microsite behind two gates. Both are gone:
 * a `requireFeature('bandPremium')` that would keep it dark in production, and a
 * `tier !== 'premium'` 404. Turnstile plus the KV rate limit were always what
 * made it safe to expose, and neither of those is a tier.
 *
 * **Where it lands changed.** It used to be one email to whichever address the
 * press kit named, and then nothing: no record, no status, no way to tell
 * whether anyone had answered, and no way to answer that did not put the act's
 * own address in a stranger's inbox. Now it opens a thread the band reads and
 * replies to at `/band/{slug}/messages`, and the band's admins are notified.
 *
 * The old email survives in exactly one case, below: a booking address that
 * belongs to nobody on the roster. That is a manager or an agent outside CorvMC,
 * and switching to an on-site inbox would otherwise cut them off silently.
 */
import { z } from 'zod';
import { error, invalid } from '@sveltejs/kit';
import { form, getRequestEvent } from '$app/server';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { group } from '$lib/server/db/schema/group';
import { bandSite } from '$lib/server/db/schema/band-site';
import { directoryEntry } from '$lib/server/db/schema/directory';
import { verifyTurnstile } from '$lib/server/turnstile';
import { allowRateLimited } from '$lib/server/rate-limit';
import { dispatchEmailOnly } from '$lib/server/notification/dispatcher';
import { handleBandEnquiry } from '$lib/server/inbox/band-service';
import { listBandAdmins } from '$lib/server/band/band-service';
import type { NotificationEmailModel } from '$lib/types/notification-email';
import type { BandEpk } from '$lib/types/band-page';

/** The address a band put on its profile, back when that field was published. */
function profileEmail(contact: unknown): string | undefined {
	const email = (contact as { email?: unknown } | null)?.email;
	return typeof email === 'string' && email ? email : undefined;
}

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
			contact: directoryEntry.contact
		})
		.from(group)
		.leftJoin(directoryEntry, eq(directoryEntry.groupId, group.id))
		.where(and(eq(group.slug, data.slug), isNull(group.deletedAt)))
		.limit(1);

	if (!bandRow) throw error(404, 'Band not found');

	// Soft throttle on top of Turnstile (KV is eventually consistent)
	if (!(await allowRateLimited(`band-contact:${bandRow.id}:${ip ?? 'unknown'}`, 5, 3600))) {
		throw error(429, 'Too many messages — please try again later');
	}

	// The enquiry itself. `addInboundMessage` emits `inbox.message_received`, and
	// the band branch of that listener is what notifies the roster — so the act
	// finds out through the same path whether this is a first enquiry or the
	// booker's third reply.
	await handleBandEnquiry({
		groupId: bandRow.id,
		name: data.name,
		email: data.email,
		message: data.message
	});

	// ---------------------------------------------------------------------
	// The off-platform booking contact
	// ---------------------------------------------------------------------
	// Everything above this line is the feature. What follows is the one case
	// the thread does not cover: a booking address the band chose that belongs
	// to nobody on its roster — a manager, an agent, a shared band mailbox.
	//
	// Those people have no account, so no notification reaches them, and silently
	// dropping them would break booking for exactly the acts organised enough to
	// have named someone. They keep the email they have always had, unchanged,
	// with the sender's own address as the Reply-To.
	//
	// An address that *does* belong to an owner or admin gets nothing extra: they
	// are already being notified, and sending both would deliver every enquiry
	// twice.
	const [config] = await db
		.select({ epk: bandSite.epk })
		.from(bandSite)
		.where(eq(bandSite.groupId, bandRow.id))
		.limit(1);
	const epk = config?.epk as BandEpk | null | undefined;

	// Two places, in the order the band chose them: the press kit's booking
	// contact, then the address on their profile. The second exists because that
	// field used to be *published* as the band's booking address — a band that
	// filled it in and never opened the press kit still gets its enquiries. The
	// owner is no longer a fallback: they are on the roster, so they are notified.
	const bookingEmail = epk?.bookingContact?.email || profileEmail(bandRow.contact);
	if (!bookingEmail) return { success: true };

	const admins = await listBandAdmins(bandRow.id);
	const onRoster = admins.some(
		(a) => a.userEmail.trim().toLowerCase() === bookingEmail.trim().toLowerCase()
	);
	if (onRoster) return { success: true };

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
		toEmail: bookingEmail,
		templateAlias: 'notification',
		model: model as unknown as Record<string, unknown>
	});

	return { success: true };
});
