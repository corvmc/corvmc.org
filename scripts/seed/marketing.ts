import {
	audience,
	audienceMember,
	campaign,
	campaignAudience,
	subscriber
} from '../../src/lib/server/db/schema/marketing';
import { SYSTEM_AUDIENCES } from '../../src/lib/server/marketing/system-audience-defs';
import { batchInsert, db } from './db';
import { type SeedUser } from './types';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

export async function seedMarketing(users: SeedUser[]) {
	console.log('Seeding marketing...');

	const audienceRows = await db
		.insert(audience)
		.values([
			{
				id: randomUUID(),
				name: 'Newsletter',
				slug: 'newsletter',
				description: 'Monthly updates from CorvMC.',
				allowOptIn: true
			},
			{
				id: randomUUID(),
				name: 'Event Updates',
				slug: 'event-updates',
				description: 'Get notified about upcoming shows.',
				allowOptIn: true
			},
			{
				id: randomUUID(),
				name: 'Member Announcements',
				slug: 'member-announcements',
				description: 'Important announcements for members.',
				allowOptIn: false
			},
			{
				id: randomUUID(),
				name: 'Public Updates',
				slug: 'public-updates',
				description: 'General updates and news.',
				allowOptIn: true
			}
		])
		.returning();

	// Built-in audiences. Membership is a SQL predicate resolved at send time,
	// so these get no audience_member rows — see marketing/system-audiences.ts.
	const systemAudienceRows = await db
		.insert(audience)
		.values(
			(Object.keys(SYSTEM_AUDIENCES) as (keyof typeof SYSTEM_AUDIENCES)[]).map((key) => ({
				id: randomUUID(),
				name: SYSTEM_AUDIENCES[key].name,
				slug: key,
				description: SYSTEM_AUDIENCES[key].description,
				allowOptIn: false,
				systemKey: key
			}))
		)
		.returning();
	const allMembersAudience = systemAudienceRows.find((a) => a.systemKey === 'all-members')!;
	const sustainingAudience = systemAudienceRows.find((a) => a.systemKey === 'sustaining-members')!;

	const subscriberRows = await db
		.insert(subscriber)
		.values(users.map((u) => ({ id: randomUUID(), email: u.email, name: u.name, userId: u.id })))
		.returning();

	const externalEmails = [
		'fan1@example.com',
		'fan2@example.com',
		'localpress@example.com',
		'musicblog@example.com',
		'concertgoer@example.com',
		'neighbor@example.com',
		'sponsor@example.com'
	];
	const externalSubs = await db
		.insert(subscriber)
		.values(
			externalEmails.map((email) => ({
				id: randomUUID(),
				email,
				name: email.split('@')[0].replace(/\d+/g, ''),
				userId: null
			}))
		)
		.returning();

	const allSubs = [...subscriberRows, ...externalSubs];

	const membershipRows: {
		id: string;
		subscriberId: string;
		audienceId: string;
		unsubscribedAt: Date | null;
	}[] = [];
	for (const sub of allSubs) {
		for (const aud of audienceRows) {
			if (Math.random() < 0.7) {
				membershipRows.push({
					id: randomUUID(),
					subscriberId: sub.id,
					audienceId: aud.id,
					unsubscribedAt:
						Math.random() < 0.1 ? new Date(Date.now() - Math.random() * 30 * 86400000) : null
				});
			}
		}
	}

	// One opt-out tombstone against a built-in audience: the only kind of
	// audience_member row a system audience ever has, and the thing that keeps
	// one-click unsubscribe working when there is no membership row to flip.
	membershipRows.push({
		id: randomUUID(),
		subscriberId: subscriberRows[1].id,
		audienceId: allMembersAudience.id,
		unsubscribedAt: new Date(Date.now() - 5 * 86400000)
	});

	if (membershipRows.length > 0) {
		await batchInsert(audienceMember, membershipRows);
	}

	// Globally suppressed by a bounce — excluded from every audience regardless
	// of opt-in. Previously unexercised in dev data.
	await db
		.update(subscriber)
		.set({ suppressedAt: new Date(Date.now() - 3 * 86400000), suppressionReason: 'bounce' })
		.where(eq(subscriber.id, externalSubs[0].id));

	const adminUser = users[0];

	const sentCampaigns = [
		{
			subject: 'Welcome to the CorvMC Newsletter!',
			markdownBody: '# Welcome!\n\nThanks for subscribing.',
			sentAt: new Date(Date.now() - 14 * 86400000),
			recipientCount: 18
		},
		{
			subject: 'February Events Roundup',
			markdownBody: "# February Events\n\nHere's what happened this month.",
			sentAt: new Date(Date.now() - 7 * 86400000),
			recipientCount: 15
		}
	];

	for (const c of sentCampaigns) {
		const [row] = await db
			.insert(campaign)
			.values({
				id: randomUUID(),
				subject: c.subject,
				markdownBody: c.markdownBody,
				htmlBody: `<p>${c.markdownBody.replace(/\n/g, '</p><p>')}</p>`,
				scheduledFor: c.sentAt,
				sentAt: c.sentAt,
				sentById: adminUser.id,
				recipientCount: c.recipientCount
			})
			.returning();
		await db.insert(campaignAudience).values([
			{ campaignId: row.id, audienceId: audienceRows[0].id },
			{ campaignId: row.id, audienceId: audienceRows[1].id }
		]);
	}

	const [scheduled] = await db
		.insert(campaign)
		.values({
			id: randomUUID(),
			subject: 'Upcoming: Spring Concert Series',
			markdownBody: '# Spring Concert Series\n\nMore details coming soon.',
			htmlBody: '<p>Spring Concert Series preview</p>',
			scheduledFor: new Date(Date.now() + 3 * 86400000),
			sentAt: null,
			sentById: adminUser.id,
			recipientCount: null
		})
		.returning();
	await db.insert(campaignAudience).values([
		{ campaignId: scheduled.id, audienceId: audienceRows[0].id },
		{ campaignId: scheduled.id, audienceId: audienceRows[3].id }
	]);

	const [draft1] = await db
		.insert(campaign)
		.values({
			id: randomUUID(),
			subject: 'New Practice Room Hours',
			markdownBody: '# Updated Hours\n\nPractice rooms available until 11pm on weekends.',
			htmlBody: '<p>Draft</p>',
			scheduledFor: null,
			sentAt: null,
			sentById: adminUser.id,
			recipientCount: null
		})
		.returning();
	await db
		.insert(campaignAudience)
		.values({ campaignId: draft1.id, audienceId: audienceRows[2].id });

	const [draft2] = await db
		.insert(campaign)
		.values({
			id: randomUUID(),
			subject: 'Volunteer Opportunities',
			markdownBody: "# Help Out at CorvMC\n\nWe're looking for volunteers.",
			htmlBody: '<p>Draft</p>',
			scheduledFor: null,
			sentAt: null,
			sentById: adminUser.id,
			recipientCount: null
		})
		.returning();
	await db
		.insert(campaignAudience)
		.values({ campaignId: draft2.id, audienceId: audienceRows[0].id });

	// Campaigns targeting built-in audiences. The sent one also overlaps the
	// Newsletter list, which is the case the recipient dedupe exists for.
	const [sentToAll] = await db
		.insert(campaign)
		.values({
			id: randomUUID(),
			subject: 'Studio Closed for Maintenance This Weekend',
			markdownBody: '# Heads up\n\nThe practice rooms are closed Saturday and Sunday.',
			htmlBody: '<p>The practice rooms are closed Saturday and Sunday.</p>',
			scheduledFor: new Date(Date.now() - 2 * 86400000),
			sentAt: new Date(Date.now() - 2 * 86400000),
			sentById: adminUser.id,
			recipientCount: users.length
		})
		.returning();
	await db.insert(campaignAudience).values([
		{ campaignId: sentToAll.id, audienceId: allMembersAudience.id },
		{ campaignId: sentToAll.id, audienceId: audienceRows[0].id }
	]);

	const [sustainingDraft] = await db
		.insert(campaign)
		.values({
			id: randomUUID(),
			subject: 'Thank You for Sustaining CorvMC',
			markdownBody: '# Thank you\n\nYour membership keeps the doors open.',
			htmlBody: '<p>Your membership keeps the doors open.</p>',
			scheduledFor: null,
			sentAt: null,
			sentById: adminUser.id,
			recipientCount: null
		})
		.returning();
	await db
		.insert(campaignAudience)
		.values({ campaignId: sustainingDraft.id, audienceId: sustainingAudience.id });

	return {
		audiences: audienceRows.length + systemAudienceRows.length,
		subscribers: allSubs.length,
		memberships: membershipRows.length,
		campaigns: sentCampaigns.length + 5
	};
}
