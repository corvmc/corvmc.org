import { and, eq, ne } from 'drizzle-orm';
import { contentFlag } from '../../src/lib/server/db/schema/flag';
import { memberStanding } from '../../src/lib/server/db/schema/standing';
import { moderationAppeal } from '../../src/lib/server/db/schema/moderation';
import { suggestion } from '../../src/lib/server/db/schema/suggestion';
import { db } from './db';
import { type SeedUser } from './types';
import { ptDate } from './util';

/**
 * Every appeal state, so `/staff/flags/[id]` and the member notices render
 * something on a fresh seed: pending (one of them against a staff action, whose
 * resolver cannot deny it), denied, and partly granted — the outcome a naive
 * implementation collapses. Runs after the suggestion and listing seeders,
 * whose upheld reports it appeals.
 */
export async function seedModerationAppeals(allUsers: SeedUser[], adminUser: SeedUser) {
	console.log('Seeding moderation appeals...');
	// A second staffer, so a decision is never ruled on by the one who made it.
	const otherStaff = allUsers[2] ?? adminUser;
	let pending = 0;

	// --- Pending: every standing still in force whose report was upheld ---
	const appealable = await db
		.select({
			userId: memberStanding.userId,
			scope: memberStanding.scope,
			flagId: contentFlag.id
		})
		.from(memberStanding)
		.innerJoin(contentFlag, eq(contentFlag.id, memberStanding.triggeringFlagId))
		.where(and(ne(memberStanding.status, 'none'), eq(contentFlag.status, 'resolved')));

	const BODIES: Record<string, string> = {
		suggestion:
			'I was frustrated and it came out wrong, but I have posted plenty of useful ideas since. Having everything go to review feels like a lot for one comment.',
		community_event:
			'That was a real show at a friend’s place and people who asked got the address. I did not mean to mislead anyone.',
		messaging: 'I only replied to a conversation they started.'
	};
	const seen = new Set<string>();
	for (const row of appealable) {
		if (seen.has(row.flagId)) continue;
		seen.add(row.flagId);
		await db.insert(moderationAppeal).values({
			flagId: row.flagId,
			appellantUserId: row.userId,
			body: BODIES[row.scope],
			createdAt: ptDate(-1, 11)
		});
		pending++;
	}

	// --- Denied, and partly granted: two taken-down suggestions ---
	const decided = [
		{
			author: allUsers[7] ?? allUsers[1],
			title: 'Kick out the metal bands on Tuesdays',
			note: 'Targets other members by name. Please raise scheduling concerns without the insults.',
			appeal: 'I was venting about the noise. I never named anyone.',
			standingRestored: false,
			decisionNotes: 'The post named two bands and called them out personally. The takedown stands.'
		},
		{
			author: allUsers[8] ?? allUsers[1],
			title: 'Selling my old amp — cheap',
			note: 'The board is for suggestions to the collective, not classifieds.',
			appeal: 'I did not know the board had that rule. I will not post sales again.',
			standingRestored: true,
			decisionNotes:
				'The post stays down — it was an ad — but a first mistake does not need your posts reviewed.'
		}
	];

	for (const d of decided) {
		const [post] = await db
			.insert(suggestion)
			.values({
				authorUserId: d.author.id,
				title: d.title,
				body: 'Seeded to show a decided appeal.',
				category: 'other',
				visibility: 'hidden',
				visibilityNote: d.note,
				visibilityChangedAt: ptDate(-9, 10),
				visibilityChangedByUserId: adminUser.id,
				createdAt: ptDate(-10, 18)
			})
			.returning();

		const [flag] = await db
			.insert(contentFlag)
			.values({
				entityType: 'suggestion',
				entityId: post.id,
				reportedByUserId: allUsers[3]?.id ?? adminUser.id,
				reason: 'Breaks the board rules',
				status: 'resolved',
				resolvedByUserId: adminUser.id,
				resolutionNotes: d.note,
				resolvedAt: ptDate(-9, 10),
				createdAt: ptDate(-9, 9)
			})
			.returning();

		// Restored standing keeps its row and its report, flipped to `none`.
		await db
			.insert(memberStanding)
			.values({
				userId: d.author.id,
				scope: 'suggestion',
				status: d.standingRestored ? 'none' : 'restricted',
				reason: d.note,
				triggeringFlagId: flag.id,
				updatedByUserId: d.standingRestored ? otherStaff.id : adminUser.id,
				updatedAt: ptDate(d.standingRestored ? -3 : -9, 10)
			})
			.onConflictDoNothing();

		await db.insert(moderationAppeal).values({
			flagId: flag.id,
			appellantUserId: d.author.id,
			body: d.appeal,
			contentOutcome: 'upheld',
			standingOutcome: d.standingRestored ? 'restored' : 'upheld',
			decisionNotes: d.decisionNotes,
			decidedByUserId: otherStaff.id,
			decidedAt: ptDate(-3, 10),
			createdAt: ptDate(-8, 20)
		});
	}

	return { pending, decided: decided.length };
}
