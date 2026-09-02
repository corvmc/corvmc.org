import {
	inboxChannelConfig,
	inboxMessage,
	inboxNote,
	inboxParticipant,
	inboxSavedView,
	inboxThread,
	inboxThreadTag
} from '../../src/lib/server/db/schema/inbox';
import { batchInsert } from './db';
import { type SeedUser } from './types';
import { randomUUID } from 'crypto';

export async function seedInbox(adminUser: SeedUser, memberUser: SeedUser) {
	const now = new Date();
	const hour = 3600_000;
	const day = 24 * hour;

	const threads = await batchInsert(
		inboxThread,
		[
			{
				id: randomUUID(),
				channel: 'web' as const,
				status: 'open' as const,
				subject: 'General Inquiry',
				preview:
					'Hi, I was wondering about your membership options and pricing. Do you offer student discounts?',
				contactName: 'Sarah Chen',
				contactEmail: 'sarah.chen@example.com',
				messageCount: 2,
				// Staff answered and nobody has written back: still open, but waiting
				// on her rather than on us, so it carries the awaiting-reply marker and
				// drops out of the nav badge. Matches the outbound message below.
				awaitingReplySince: new Date(now.getTime() - 2 * hour),
				lastMessageAt: new Date(now.getTime() - 2 * hour),
				lastOutboundAt: new Date(now.getTime() - 2 * hour),
				createdAt: new Date(now.getTime() - day),
				updatedAt: new Date(now.getTime() - 2 * hour)
			},
			{
				id: randomUUID(),
				channel: 'web' as const,
				status: 'open' as const,
				subject: 'Performance Inquiry',
				preview:
					'We are a 5-piece indie rock band looking to book a show at your venue. We have a press kit available.',
				contactName: 'Marcus Rivera',
				contactEmail: 'marcus@thelateshift.band',
				messageCount: 1,
				lastMessageAt: new Date(now.getTime() - 6 * hour),
				createdAt: new Date(now.getTime() - 6 * hour),
				updatedAt: new Date(now.getTime() - 6 * hour)
			},
			{
				id: randomUUID(),
				channel: 'email' as const,
				status: 'open' as const,
				subject: 'Broken mic stand in Room B',
				preview:
					"Hey, just a heads up that the mic stand in Room B has a stripped threading and won't tighten.",
				contactName: 'Jordan Lee',
				contactEmail: 'jordan.lee@gmail.com',
				messageCount: 3,
				lastMessageAt: new Date(now.getTime() - 12 * hour),
				// We answered and he came back: openReason() reads "Replied".
				lastOutboundAt: new Date(now.getTime() - day),
				createdAt: new Date(now.getTime() - 2 * day),
				updatedAt: new Date(now.getTime() - 12 * hour)
			},
			{
				id: randomUUID(),
				channel: 'web' as const,
				status: 'resolved' as const,
				subject: 'Volunteer Opportunities',
				preview: "Thanks for the info! I'll sign up for the next orientation session.",
				contactName: 'Priya Patel',
				contactEmail: 'priya.p@outlook.com',
				messageCount: 4,
				lastMessageAt: new Date(now.getTime() - 3 * day),
				createdAt: new Date(now.getTime() - 5 * day),
				updatedAt: new Date(now.getTime() - 3 * day)
			},
			{
				id: randomUUID(),
				channel: 'sms' as const,
				status: 'open' as const,
				preview: "Is the studio open tomorrow? Google says you're closed on Mondays.",
				contactName: null,
				contactPhone: '+15415551234',
				messageCount: 1,
				lastMessageAt: new Date(now.getTime() - hour),
				createdAt: new Date(now.getTime() - hour),
				updatedAt: new Date(now.getTime() - hour)
			},

			// Portal threads. Unlike every channel above, these belong to a real
			// account — the member reads and answers them at /member/messages, and
			// the participant rows below are what make them theirs.
			{
				id: randomUUID(),
				channel: 'portal' as const,
				status: 'open' as const,
				subject: 'Question about after-hours access',
				preview:
					"You're all set — your fob works until 11pm on weeknights. Let us know if it gives you trouble.",
				contactName: memberUser.name,
				contactEmail: memberUser.email,
				messageCount: 2,
				// Same again on the portal channel, where the member replying from
				// /member/messages is what clears it.
				awaitingReplySince: new Date(now.getTime() - 4 * hour),
				lastMessageAt: new Date(now.getTime() - 4 * hour),
				lastOutboundAt: new Date(now.getTime() - 4 * hour),
				createdAt: new Date(now.getTime() - day),
				updatedAt: new Date(now.getTime() - 4 * hour)
			},
			{
				id: randomUUID(),
				channel: 'portal' as const,
				status: 'resolved' as const,
				subject: 'Amp buzzing in Room A',
				preview: 'Swapped the cable — no buzz now. Thanks for flagging it.',
				contactName: memberUser.name,
				contactEmail: memberUser.email,
				messageCount: 2,
				lastMessageAt: new Date(now.getTime() - 6 * day),
				lastOutboundAt: new Date(now.getTime() - 6 * day),
				createdAt: new Date(now.getTime() - 7 * day),
				updatedAt: new Date(now.getTime() - 6 * day)
			},

			// The last two open reasons, which nothing above produced. Kept at the
			// end because the participant rows below index into this array.
			{
				// Snoozed, the date came and went, and `wakeSnoozedThreads` flipped
				// it back to open leaving the date behind — which is the only thing
				// that makes openReason() say "Snooze expired" rather than
				// "Unanswered". Nothing has arrived since, or the newer story wins.
				id: randomUUID(),
				channel: 'web' as const,
				status: 'open' as const,
				subject: 'Practice Space',
				preview: 'Does the monthly rate include weekend access?',
				contactName: 'Priya Nadkarni',
				contactEmail: 'priya.nadkarni@example.com',
				messageCount: 1,
				snoozedUntil: new Date(now.getTime() - 2 * day),
				lastMessageAt: new Date(now.getTime() - 5 * day),
				createdAt: new Date(now.getTime() - 5 * day),
				updatedAt: new Date(now.getTime() - 2 * day)
			},
			{
				// The oldest thing in the queue, and the reason the Open view sorts
				// by longest waiting rather than newest first: at nine days it would
				// otherwise sit below everything and never be seen again.
				id: randomUUID(),
				channel: 'web' as const,
				status: 'open' as const,
				subject: 'Practice Space',
				preview:
					'Hi Devon, nice to hear from you! I JUST moved to the neighborhood and need somewhere to practice a few evenings a week.',
				contactName: 'Sarah Mbeki',
				contactEmail: 'sarah.mbeki@example.com',
				messageCount: 1,
				lastMessageAt: new Date(now.getTime() - 9 * day),
				createdAt: new Date(now.getTime() - 9 * day),
				updatedAt: new Date(now.getTime() - 9 * day)
			}
		],
		4
	);

	// Read cursors. The open thread is left unread so the member portal opens
	// with a badge on the Messages nav item; the resolved one is caught up, which
	// is what exercises the closed-conversation view.
	await batchInsert(
		inboxParticipant,
		[
			{
				id: randomUUID(),
				threadId: threads[5].id,
				userId: memberUser.id,
				role: 'member' as const,
				lastReadAt: null,
				createdAt: new Date(now.getTime() - day)
			},
			{
				id: randomUUID(),
				threadId: threads[6].id,
				userId: memberUser.id,
				role: 'member' as const,
				lastReadAt: new Date(now.getTime() - 5 * day),
				createdAt: new Date(now.getTime() - 7 * day)
			}
		],
		2
	);

	const messages = await batchInsert(
		inboxMessage,
		[
			// Thread 1: Sarah Chen contact form
			{
				id: randomUUID(),
				threadId: threads[0].id,
				direction: 'inbound' as const,
				body: 'Hi, I was wondering about your membership options and pricing. Do you offer student discounts?',
				authorName: 'Sarah Chen',
				createdAt: new Date(now.getTime() - day)
			},
			{
				id: randomUUID(),
				threadId: threads[0].id,
				direction: 'outbound' as const,
				body: 'Hi Sarah! Yes, we offer a free membership tier and discounted rates for students with a valid .edu email. Check out our membership page for details!',
				authorName: adminUser.name,
				authorUserId: adminUser.id,
				createdAt: new Date(now.getTime() - 2 * hour)
			},

			// Thread 2: Marcus performance inquiry
			{
				id: randomUUID(),
				threadId: threads[1].id,
				direction: 'inbound' as const,
				body: "We are a 5-piece indie rock band looking to book a show at your venue. We have a press kit available. Our EPK is at thelateshift.band/press. We're free most weekends in June and July.",
				authorName: 'Marcus Rivera',
				createdAt: new Date(now.getTime() - 6 * hour)
			},

			// Thread 3: Jordan equipment report
			{
				id: randomUUID(),
				threadId: threads[2].id,
				direction: 'inbound' as const,
				body: "Hey, just a heads up that the mic stand in Room B has a stripped threading and won't tighten. It was like that when I arrived for my 2pm session.",
				authorName: 'Jordan Lee',
				createdAt: new Date(now.getTime() - 2 * day)
			},
			{
				id: randomUUID(),
				threadId: threads[2].id,
				direction: 'outbound' as const,
				body: "Thanks for letting us know, Jordan. We'll get that replaced. Sorry for the inconvenience!",
				authorName: adminUser.name,
				authorUserId: adminUser.id,
				createdAt: new Date(now.getTime() - day)
			},
			{
				id: randomUUID(),
				threadId: threads[2].id,
				direction: 'inbound' as const,
				body: 'No worries, I just used Room A instead. Thanks for the quick response!',
				authorName: 'Jordan Lee',
				createdAt: new Date(now.getTime() - 12 * hour)
			},

			// Thread 4: Priya volunteer (resolved)
			{
				id: randomUUID(),
				threadId: threads[3].id,
				direction: 'inbound' as const,
				body: "Hi! I'm interested in volunteering at CorvMC. What opportunities do you have available?",
				authorName: 'Priya Patel',
				createdAt: new Date(now.getTime() - 5 * day)
			},
			{
				id: randomUUID(),
				threadId: threads[3].id,
				direction: 'outbound' as const,
				body: "Hey Priya! We'd love to have you. We have sound engineer, event setup, and front desk volunteer roles. Would any of those interest you?",
				authorName: adminUser.name,
				authorUserId: adminUser.id,
				createdAt: new Date(now.getTime() - 4 * day)
			},
			{
				id: randomUUID(),
				threadId: threads[3].id,
				direction: 'inbound' as const,
				body: 'Sound engineering sounds amazing! How do I get started?',
				authorName: 'Priya Patel',
				createdAt: new Date(now.getTime() - 4 * day + hour)
			},
			{
				id: randomUUID(),
				threadId: threads[3].id,
				direction: 'outbound' as const,
				body: 'Great choice! We run orientation sessions on the first Saturday of each month. Sign up at our events page. See you there!',
				authorName: adminUser.name,
				authorUserId: adminUser.id,
				createdAt: new Date(now.getTime() - 3 * day)
			},

			// Thread 5: SMS about hours
			{
				id: randomUUID(),
				threadId: threads[4].id,
				direction: 'inbound' as const,
				body: "Is the studio open tomorrow? Google says you're closed on Mondays.",
				createdAt: new Date(now.getTime() - hour)
			},

			// Thread 6: portal, still open. authorUserId is what puts the member's
			// own message on their side of the timeline.
			{
				id: randomUUID(),
				threadId: threads[5].id,
				direction: 'inbound' as const,
				body: 'Hi! Does my fob still work after 9pm? I got locked out last Tuesday around 9:30.',
				authorName: memberUser.name,
				authorUserId: memberUser.id,
				createdAt: new Date(now.getTime() - day)
			},
			{
				id: randomUUID(),
				threadId: threads[5].id,
				direction: 'outbound' as const,
				body: "You're all set — your fob works until 11pm on weeknights. Let us know if it gives you trouble.",
				authorName: adminUser.name,
				authorUserId: adminUser.id,
				createdAt: new Date(now.getTime() - 4 * hour)
			},

			// Thread 7: portal, resolved — the member can read it but not reply.
			{
				id: randomUUID(),
				threadId: threads[6].id,
				direction: 'inbound' as const,
				body: 'The amp in Room A is buzzing pretty badly on the clean channel.',
				authorName: memberUser.name,
				authorUserId: memberUser.id,
				createdAt: new Date(now.getTime() - 7 * day)
			},
			{
				id: randomUUID(),
				threadId: threads[6].id,
				direction: 'outbound' as const,
				body: 'Swapped the cable — no buzz now. Thanks for flagging it.',
				authorName: adminUser.name,
				authorUserId: adminUser.id,
				createdAt: new Date(now.getTime() - 6 * day)
			},

			// Thread 8: snoozed, woken by the cron, still unanswered.
			{
				id: randomUUID(),
				threadId: threads[7].id,
				direction: 'inbound' as const,
				body: 'Does the monthly rate include weekend access? And is there a discount if two of us split a block?',
				authorName: 'Priya Nadkarni',
				createdAt: new Date(now.getTime() - 5 * day)
			},

			// Thread 9: the oldest unanswered thread in the queue.
			{
				id: randomUUID(),
				threadId: threads[8].id,
				direction: 'inbound' as const,
				body: 'Hi Devon, nice to hear from you! I JUST moved to the neighborhood and need somewhere to practice a few evenings a week. What does a monthly block run?',
				authorName: 'Sarah Mbeki',
				createdAt: new Date(now.getTime() - 9 * day)
			}
		],
		8
	);

	// Add a staff note to thread 3
	const notes = await batchInsert(
		inboxNote,
		[
			{
				id: randomUUID(),
				threadId: threads[2].id,
				authorUserId: adminUser.id,
				body: 'Ordered replacement mic stand from Sweetwater — should arrive Thursday.',
				createdAt: new Date(now.getTime() - 18 * hour)
			}
		],
		1
	);

	// Tags on the two threads whose details strip is worth opening. Distinct from
	// the inquiry type: this is what staff decided the thread is, after reading.
	await batchInsert(
		inboxThreadTag,
		[
			{ id: randomUUID(), threadId: threads[8].id, tag: 'band' },
			{ id: randomUUID(), threadId: threads[8].id, tag: 'weeknights' },
			{ id: randomUUID(), threadId: threads[2].id, tag: 'maintenance' }
		],
		3
	);

	// One saved view, so the tab row under the system views is not empty on a
	// fresh database and the shape of a stored filter set is visible.
	await batchInsert(
		inboxSavedView,
		[
			{
				id: randomUUID(),
				userId: adminUser.id,
				name: 'Practice space, unanswered',
				filters: { view: 'open', subject: 'Practice Space' },
				createdAt: new Date(now.getTime() - day)
			}
		],
		1
	);

	// Channels default to disabled, so without these rows the seeded SMS thread
	// opens with a "channel is disabled" banner and a composer that refuses to
	// send — a dead end on a fresh local database.
	await batchInsert(
		inboxChannelConfig,
		[
			{ id: randomUUID(), channel: 'web' as const, enabled: true, config: {} },
			{ id: randomUUID(), channel: 'email' as const, enabled: true, config: {} },
			{ id: randomUUID(), channel: 'sms' as const, enabled: true, config: {} }
		],
		3
	);

	return { threads: threads.length, messages: messages.length, notes: notes.length };
}
