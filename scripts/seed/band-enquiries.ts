import { inboxMessage, inboxThread } from '../../src/lib/server/db/schema/inbox';
import { BAND_ENQUIRY_SUBJECT } from '../../src/lib/config';
import { batchInsert } from './db';
import { type SeedUser } from './types';
import { randomUUID } from 'crypto';

/**
 * Booking enquiries in the first two bands' inboxes.
 *
 * Every state the list distinguishes, so `/band/{slug}/messages` is never
 * looked at empty and every branch of the row is reachable in dev: unread and
 * unanswered, answered and waiting on them, a back-and-forth the booker has
 * replied to, and one the band has closed.
 *
 * Note what is deliberately absent — **no `inbox_participant` rows**. A band
 * thread has none: who may read it is the roster, resolved live. Adding one
 * here would put these in `/member/messages` for the band's admins and quietly
 * disprove the thing `band-service.spec.ts` asserts. The read cursor lives in
 * `inbox_group_read`, and every thread below is left unread so the nav badge
 * has something to show on a fresh seed.
 */
export async function seedBandEnquiries(
	bands: Array<{ id: string; name: string; ownerId: string }>,
	users: SeedUser[]
) {
	if (bands.length === 0) return { threads: 0, messages: 0 };

	console.log('Seeding band booking enquiries...');

	// Outbound messages are signed by the bandmate who wrote them — that is what
	// `authorName` is for, and the timeline reads the band's side from
	// `direction` rather than from who is looking. Signing them with the band's
	// own name would make a reply look like it came from nobody.
	const nameOf = (userId: string) => users.find((u) => u.id === userId)?.name ?? 'The band';

	const now = Date.now();
	const hour = 3600_000;
	const day = 24 * hour;

	const [first, second] = bands;

	const unanswered = randomUUID();
	const awaiting = randomUUID();
	const cameBack = randomUUID();
	const closed = randomUUID();

	const threads = [
		{
			id: unanswered,
			channel: 'band' as const,
			groupId: first.id,
			status: 'open' as const,
			subject: BAND_ENQUIRY_SUBJECT,
			preview:
				"We're putting together a Friday bill at the Whiteside in March and would love to have you on it.",
			contactName: 'Dana Whitlock',
			contactEmail: 'dana@whitesidetheatre.example',
			messageCount: 1,
			lastMessageAt: new Date(now - 3 * hour),
			createdAt: new Date(now - 3 * hour),
			updatedAt: new Date(now - 3 * hour)
		},
		{
			id: awaiting,
			channel: 'band' as const,
			groupId: first.id,
			status: 'open' as const,
			subject: BAND_ENQUIRY_SUBJECT,
			// Answered, nobody has written back: the row reads "Waiting on them"
			// and the marker is what says so. Same column the staff queue uses.
			preview: "Yes — the 14th works for us. What's the load-in time?",
			contactName: 'Ruben Ortiz',
			contactEmail: 'ruben@cloudandcellar.example',
			messageCount: 2,
			awaitingReplySince: new Date(now - 5 * hour),
			lastMessageAt: new Date(now - 5 * hour),
			lastOutboundAt: new Date(now - 5 * hour),
			createdAt: new Date(now - 2 * day),
			updatedAt: new Date(now - 5 * hour)
		},
		{
			id: cameBack,
			channel: 'band' as const,
			groupId: first.id,
			status: 'open' as const,
			// The band answered and the booker came back — the reply arrived through
			// the Postmark relay, which is why the thread has no awaiting marker.
			preview: 'Perfect. Doors at 7, you go on at 9. Anything you need on the backline?',
			subject: BAND_ENQUIRY_SUBJECT,
			contactName: 'Marisol Vega',
			contactEmail: 'booking@theoldworldcafe.example',
			messageCount: 3,
			lastMessageAt: new Date(now - 20 * hour),
			lastOutboundAt: new Date(now - day),
			createdAt: new Date(now - 4 * day),
			updatedAt: new Date(now - 20 * hour)
		},
		{
			id: closed,
			channel: 'band' as const,
			groupId: (second ?? first).id,
			status: 'resolved' as const,
			subject: BAND_ENQUIRY_SUBJECT,
			preview: "No worries — we'll try you again for the summer series.",
			contactName: 'Theo Brand',
			contactEmail: 'theo@majesticoregon.example',
			messageCount: 3,
			lastMessageAt: new Date(now - 9 * day),
			lastOutboundAt: new Date(now - 10 * day),
			createdAt: new Date(now - 12 * day),
			updatedAt: new Date(now - 9 * day)
		}
	];

	await batchInsert(inboxThread, threads);

	const messages = [
		{
			id: randomUUID(),
			threadId: unanswered,
			direction: 'inbound' as const,
			body: "We're putting together a Friday bill at the Whiteside in March and would love to have you on it. Three acts, doors at 7. Are you around the weekend of the 21st?",
			authorName: 'Dana Whitlock',
			createdAt: new Date(now - 3 * hour)
		},
		{
			id: randomUUID(),
			threadId: awaiting,
			direction: 'inbound' as const,
			body: "Hi! We run a monthly showcase at Cloud & Cellar and I caught your set at the Common last month. Any chance you're free on the 14th?",
			authorName: 'Ruben Ortiz',
			createdAt: new Date(now - 2 * day)
		},
		{
			id: randomUUID(),
			threadId: awaiting,
			direction: 'outbound' as const,
			body: "Yes — the 14th works for us. What's the load-in time?",
			authorName: nameOf(first.ownerId),
			createdAt: new Date(now - 5 * hour)
		},
		{
			id: randomUUID(),
			threadId: cameBack,
			direction: 'inbound' as const,
			body: 'Hello — booking for the Old World Cafe. We have a Saturday open on the 8th and thought of you. 45 minute set, door split.',
			authorName: 'Marisol Vega',
			createdAt: new Date(now - 4 * day)
		},
		{
			id: randomUUID(),
			threadId: cameBack,
			direction: 'outbound' as const,
			body: "We'd be into that. What time would you want us there?",
			authorName: nameOf(first.ownerId),
			createdAt: new Date(now - day)
		},
		{
			id: randomUUID(),
			threadId: cameBack,
			direction: 'inbound' as const,
			body: 'Perfect. Doors at 7, you go on at 9. Anything you need on the backline?',
			authorName: 'Marisol Vega',
			createdAt: new Date(now - 20 * hour)
		},
		{
			id: randomUUID(),
			threadId: closed,
			direction: 'inbound' as const,
			body: 'Booking for the Majestic — are you taking dates in April?',
			authorName: 'Theo Brand',
			createdAt: new Date(now - 12 * day)
		},
		{
			id: randomUUID(),
			threadId: closed,
			direction: 'outbound' as const,
			body: "Thanks for thinking of us! We're off the road until June, unfortunately.",
			authorName: nameOf((second ?? first).ownerId),
			createdAt: new Date(now - 10 * day)
		},
		{
			id: randomUUID(),
			threadId: closed,
			direction: 'inbound' as const,
			body: "No worries — we'll try you again for the summer series.",
			authorName: 'Theo Brand',
			createdAt: new Date(now - 9 * day)
		}
	];

	await batchInsert(inboxMessage, messages);

	return { threads: threads.length, messages: messages.length };
}
