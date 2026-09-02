import { contentFlag } from '../../src/lib/server/db/schema/flag';
import { memberStanding } from '../../src/lib/server/db/schema/standing';
import {
	suggestion,
	suggestionEdit,
	suggestionVote
} from '../../src/lib/server/db/schema/suggestion';
import { batchInsert, db } from './db';
import { ptDate, randomInt } from './util';

export const SUGGESTION_SEEDS = [
	{
		title: 'Gear checkout calendar',
		body: "Right now you have to ask in the group chat whether the good SM58s are free. A shared calendar showing what's out and when it's back would save a lot of back-and-forth.",
		category: 'gear_equipment'
	},
	{
		title: 'Sunday afternoon open mic',
		body: 'Evenings are hard for anyone with a kid or an early shift. A 2pm Sunday slot would open the room up to a different crowd.',
		category: 'events_programming'
	},
	{
		title: 'Dark mode on the member portal',
		body: 'Booking a room at 11pm is currently a flashbang. The rest of the site could follow the system theme.',
		category: 'website_tools'
	},
	{
		title: 'Better soundproofing in room B',
		body: "You can hear room A's kick drum through the wall, which makes room B hard to use for anything quiet.",
		category: 'the_space'
	},
	{
		title: 'Publish the board meeting minutes',
		body: 'Members should be able to read what was decided without having to ask. A page with the last year of minutes would do it.',
		category: 'policy'
	},
	{
		title: 'Coffee that is not instant',
		body: 'A french press and a bag of beans from a local roaster. That is the whole suggestion.',
		category: 'other'
	},
	{
		title: 'Repair night once a month',
		body: 'Somebody who can solder, a soldering iron, and a couple of hours. Half the broken cables in the bin are a five-minute fix.',
		category: 'gear_equipment'
	},
	{
		title: 'Loop the sign-up sheet into the website',
		body: 'The paper sheet by the door and the online calendar disagree constantly. Pick one.',
		category: 'website_tools'
	}
] as const;

export async function seedSuggestions(users: any[], adminUser: any) {
	console.log('Seeding suggestions...');
	if (users.length < 4) return { total: 0, votes: 0 };

	const voters = users.slice(0, Math.min(users.length, 12));
	const rows: any[] = [];
	const voteRows: { suggestionId: string; userId: string }[] = [];

	/** Give a suggestion `n` distinct voters, deterministically. */
	function addVotes(suggestionId: string, n: number, offset = 0) {
		for (let i = 0; i < Math.min(n, voters.length); i++) {
			voteRows.push({ suggestionId, userId: voters[(i + offset) % voters.length].id });
		}
	}

	// --- On the board, one per lifecycle status so every branch is reachable ---
	const onBoard: Array<{ status: string; response: string | null; votes: number }> = [
		// Paired with SUGGESTION_SEEDS by index, so each reply has to read as an
		// answer to *that* suggestion.
		// 0: gear checkout calendar   1: Sunday open mic
		{ status: 'open', response: null, votes: 11 },
		{ status: 'open', response: null, votes: 6 },
		{
			status: 'planned',
			response: "Good idea. It's on the list for the next round of portal work.",
			votes: 9
		},
		{
			status: 'in_progress',
			response: 'Acoustic panels are ordered. Should be up by the end of the month.',
			votes: 7
		},
		{ status: 'done', response: 'Done as of last week. Thanks for the nudge.', votes: 4 },
		{
			status: 'declined',
			response:
				'We tried this in 2024 and the press went unwashed for a month. Happy to revisit if somebody wants to own keeping it clean.',
			votes: 3
		}
	];

	for (let i = 0; i < onBoard.length; i++) {
		const seed = SUGGESTION_SEEDS[i];
		const spec = onBoard[i];
		// A couple from the admin so a familiar name shows up on the board.
		const author = i % 3 === 0 ? adminUser : users[(i + 1) % users.length];
		const [row] = await db
			.insert(suggestion)
			.values({
				authorUserId: author.id,
				title: seed.title,
				body: seed.body,
				category: seed.category,
				status: spec.status as any,
				visibility: 'visible',
				responseBody: spec.response,
				responseByUserId: spec.response ? adminUser.id : null,
				responseAt: spec.response ? ptDate(-randomInt(2, 20), 10) : null,
				createdAt: ptDate(-randomInt(5, 60), randomInt(9, 20))
			})
			.returning();
		rows.push(row);
		addVotes(row.id, spec.votes, i);
	}

	// --- A merged pair whose voter sets OVERLAP ---
	//
	// This is the row that makes dedup visible in the UI: the target's count is
	// the union of both voter sets, not the sum. Without an overlap you can't
	// tell a correct merge from a broken one by looking.
	const [mergeTarget] = await db
		.insert(suggestion)
		.values({
			authorUserId: users[1].id,
			title: 'Fix the cable situation',
			body: 'A labelled cable rack by the door, and a bin for the dead ones.',
			category: 'gear_equipment',
			visibility: 'visible',
			createdAt: ptDate(-30, 14)
		})
		.returning();
	rows.push(mergeTarget);
	addVotes(mergeTarget.id, 5, 0); // voters 0-4

	const [mergeSource] = await db
		.insert(suggestion)
		.values({
			authorUserId: users[2].id,
			title: 'Cable rack please',
			body: 'Same as the other one — the cable pile has become a hazard.',
			category: 'gear_equipment',
			visibility: 'visible',
			mergedIntoId: mergeTarget.id,
			mergedByUserId: adminUser.id,
			mergedAt: ptDate(-3, 11),
			createdAt: ptDate(-25, 16)
		})
		.returning();
	rows.push(mergeSource);
	// Voters 3-7: three of them (3, 4) already voted on the target above, so the
	// union is 8 and the naive sum would be 10.
	addVotes(mergeSource.id, 5, 3);
	for (let i = 3; i < 8; i++) {
		voteRows.push({ suggestionId: mergeTarget.id, userId: voters[i % voters.length].id });
	}

	// --- Reported, pulled from the board, with the report still open ---
	const reporter = users[3];
	const reportedAuthor = users[4] ?? users[1];
	const [reported] = await db
		.insert(suggestion)
		.values({
			authorUserId: reportedAuthor.id,
			title: "Buy my friend's PA system",
			body: "He is selling it cheap and I get a finder's fee. DM me.",
			category: 'gear_equipment',
			visibility: 'under_review',
			visibilityChangedAt: ptDate(-1, 9),
			createdAt: ptDate(-2, 19)
		})
		.returning();
	rows.push(reported);
	addVotes(reported.id, 1, 6);

	await db.insert(contentFlag).values({
		entityType: 'suggestion',
		entityId: reported.id,
		reportedByUserId: reporter.id,
		reason: 'Self-dealing / advertising',
		description: 'Reads like an ad, and they say outright they get a cut.',
		status: 'pending',
		createdAt: ptDate(-1, 9)
	});

	// --- A member on probation, with a post waiting on staff ---
	//
	// Seeded with an already-upheld flag so "why am I in review?" resolves to a
	// real report rather than a dangling id.
	const probationUser = users[5] ?? users[2];
	const [upheldFlag] = await db
		.insert(contentFlag)
		.values({
			entityType: 'suggestion',
			entityId: rows[0].id,
			reportedByUserId: reporter.id,
			reason: 'Abusive language',
			status: 'resolved',
			resolvedByUserId: adminUser.id,
			resolutionNotes: 'Upheld — please keep it civil.',
			resolvedAt: ptDate(-14, 15),
			createdAt: ptDate(-15, 12)
		})
		.returning();

	await db.insert(memberStanding).values({
		userId: probationUser.id,
		scope: 'suggestion',
		status: 'restricted',
		reason: 'Upheld — please keep it civil.',
		triggeringFlagId: upheldFlag.id,
		updatedByUserId: adminUser.id,
		updatedAt: ptDate(-14, 15)
	});

	const [pending] = await db
		.insert(suggestion)
		.values({
			authorUserId: probationUser.id,
			title: SUGGESTION_SEEDS[6].title,
			body: SUGGESTION_SEEDS[6].body,
			category: SUGGESTION_SEEDS[6].category,
			visibility: 'pending_review',
			visibilityChangedAt: ptDate(-1, 13),
			createdAt: ptDate(-1, 13)
		})
		.returning();
	rows.push(pending);

	// --- A pending edit on a suggestion that already has votes ---
	//
	// The most-voted suggestion, so the staff diff card shows a real "11 members
	// already voted for this" and the before/after has something at stake.
	await db.insert(suggestionEdit).values({
		suggestionId: rows[0].id,
		requestedByUserId: rows[0].authorUserId,
		proposedTitle: 'Gear checkout calendar (and a sign-out sheet)',
		proposedBody:
			"Right now you have to ask in the group chat whether the good SM58s are free. A shared calendar showing what's out and when it's back would save a lot of back-and-forth — plus a paper sheet by the cage for anyone who grabs something on the way in.",
		proposedCategory: 'gear_equipment',
		originalTitle: SUGGESTION_SEEDS[0].title,
		originalBody: SUGGESTION_SEEDS[0].body,
		originalCategory: SUGGESTION_SEEDS[0].category,
		status: 'pending',
		createdAt: ptDate(-1, 15)
	});

	// --- Hidden by staff, with the reason on it ---
	const [hidden] = await db
		.insert(suggestion)
		.values({
			authorUserId: users[2].id,
			title: SUGGESTION_SEEDS[7].title,
			body: SUGGESTION_SEEDS[7].body,
			category: SUGGESTION_SEEDS[7].category,
			visibility: 'hidden',
			visibilityNote: 'Duplicate of an older thread, and the tone got personal.',
			visibilityChangedAt: ptDate(-8, 10),
			visibilityChangedByUserId: adminUser.id,
			createdAt: ptDate(-10, 17)
		})
		.returning();
	rows.push(hidden);

	// Dedupe before insert: the unique index would reject a repeat anyway, and a
	// seed that relies on the DB rejecting its own rows is a seed nobody trusts.
	const seen = new Set<string>();
	const uniqueVotes = voteRows.filter((v) => {
		const key = `${v.suggestionId}:${v.userId}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	await batchInsert(suggestionVote, uniqueVotes);

	return { total: rows.length, votes: uniqueVotes.length, pendingEdits: 1 };
}
