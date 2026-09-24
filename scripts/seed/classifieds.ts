import { classifiedPost, classifiedPostTag } from '../../src/lib/server/db/schema/classified';
import { contentFlag } from '../../src/lib/server/db/schema/flag';
import { memberStanding } from '../../src/lib/server/db/schema/standing';
import { batchInsert, db } from './db';

const DAY = 86_400_000;

type Tag = { kind: 'instrument' | 'genre' | 'skill'; value: string };

interface Seed {
	kind: 'wanted' | 'offered';
	category: 'musician' | 'jam' | 'service' | 'other';
	title: string;
	body: string;
	tags: Tag[];
	/** Days ago it was posted. Expiry is 30 days after that unless overridden. */
	ageDays: number;
	status?: 'open' | 'closed';
	visibility?: 'visible' | 'pending_review' | 'under_review' | 'hidden';
	note?: string;
}

/** One post per author, so no seeded member is near the open-post cap. */
const SEEDS: Seed[] = [
	{
		kind: 'wanted',
		category: 'musician',
		title: 'Drummer wanted for a surf-rock trio',
		body: 'We rehearse Tuesdays at 7 in room A. Reverb-heavy, mostly instrumental, a few gigs a month.',
		tags: [
			{ kind: 'instrument', value: 'drums' },
			{ kind: 'genre', value: 'surf' }
		],
		ageDays: 2
	},
	{
		kind: 'offered',
		category: 'musician',
		title: 'Keys player free for fill-ins and sessions',
		body: 'Rhodes, organ and synth. Happy to sub for a gig or sit in on a recording.',
		tags: [
			{ kind: 'instrument', value: 'keys' },
			{ kind: 'genre', value: 'soul' }
		],
		ageDays: 5
	},
	{
		kind: 'offered',
		category: 'jam',
		title: 'Open blues jam, Thursday nights',
		body: 'Room B, 8 to 10. Bring an instrument or just come and listen. Beginners welcome.',
		tags: [{ kind: 'genre', value: 'blues' }],
		ageDays: 9
	},
	{
		kind: 'offered',
		category: 'service',
		title: 'I can mix and master your EP',
		body: 'Ten years of live sound, the last few mostly mixing. Send me a rough and I will tell you honestly what it needs.',
		tags: [
			{ kind: 'skill', value: 'mixing' },
			{ kind: 'skill', value: 'mastering' }
		],
		ageDays: 12
	},
	{
		kind: 'wanted',
		category: 'other',
		title: 'Carpool to rehearsals from Albany',
		body: 'I am in Albany most evenings and happy to split gas with anyone heading to the space.',
		tags: [],
		ageDays: 1
	},
	{
		kind: 'wanted',
		category: 'musician',
		title: 'Singer wanted for a folk duo',
		body: 'Posted a while ago and never renewed, so it has expired.',
		tags: [{ kind: 'genre', value: 'folk' }],
		ageDays: 45
	},
	{
		kind: 'wanted',
		category: 'musician',
		title: 'Found a guitarist, thanks all',
		body: 'Filled. Closed by its author, and still in their own list.',
		tags: [{ kind: 'instrument', value: 'guitar' }],
		ageDays: 20,
		status: 'closed'
	},
	{
		kind: 'offered',
		category: 'service',
		title: 'Cheap lessons, DM for rates',
		body: 'Lessons.',
		tags: [{ kind: 'skill', value: 'lessons' }],
		ageDays: 6,
		visibility: 'hidden',
		note: 'Say what you teach, to whom, and roughly what it costs. Edit it and we will look again.'
	},
	{
		kind: 'offered',
		category: 'jam',
		title: 'Noise improv session, all levels',
		body: 'Waiting on staff review because this member is posting under review.',
		tags: [{ kind: 'genre', value: 'experimental' }],
		ageDays: 1,
		visibility: 'pending_review'
	},
	{
		kind: 'offered',
		category: 'other',
		title: 'Selling concert tickets at face value',
		body: 'Reported by another member, so it is off the board until staff decide.',
		tags: [],
		ageDays: 3,
		visibility: 'under_review'
	}
];

export async function seedClassifieds(
	users: { id: string }[],
	bands: { id: string; ownerId: string | null }[],
	adminUser: { id: string }
) {
	console.log('Seeding classifieds...');
	const authors = users.slice(3, 3 + SEEDS.length);
	if (authors.length < SEEDS.length) return { posts: 0 };
	const now = Date.now();

	const posts = SEEDS.map((s, i) => {
		const created = new Date(now - s.ageDays * DAY);
		const hidden = s.visibility === 'hidden';
		return {
			id: crypto.randomUUID(),
			authorUserId: authors[i].id,
			kind: s.kind,
			category: s.category,
			title: s.title,
			body: s.body,
			status: s.status ?? 'open',
			visibility: s.visibility ?? 'visible',
			visibilityNote: s.note ?? null,
			visibilityChangedAt: s.visibility ? created : null,
			visibilityChangedByUserId: hidden ? adminUser.id : null,
			expiresAt: new Date(created.getTime() + 30 * DAY),
			closedAt: s.status === 'closed' ? new Date(now - DAY) : null,
			createdAt: created,
			updatedAt: created
		};
	});

	// A band posting as itself, from the member who owns it.
	const band = bands.find((b) => b.ownerId);
	if (band?.ownerId) {
		posts.push({
			...posts[0],
			id: crypto.randomUUID(),
			authorUserId: band.ownerId,
			title: 'Bassist wanted',
			body: 'We have a record half-finished and nobody to play bass on it. Rehearsals twice a week.',
			createdAt: new Date(now - 4 * DAY),
			updatedAt: new Date(now - 4 * DAY),
			expiresAt: new Date(now + 26 * DAY)
		});
	}

	const rows = await batchInsert(
		classifiedPost,
		posts.map((p, i) => ({ ...p, groupId: i === SEEDS.length ? (band?.id ?? null) : null }))
	);

	const tags = rows.flatMap((r, i) =>
		(i < SEEDS.length ? SEEDS[i].tags : [{ kind: 'instrument' as const, value: 'bass' }]).map(
			(t) => ({ postId: r.id, kind: t.kind, value: t.value })
		)
	);
	if (tags.length) await batchInsert(classifiedPostTag, tags);

	const restricted = SEEDS.findIndex((s) => s.visibility === 'pending_review');
	await db.insert(memberStanding).values({
		userId: authors[restricted].id,
		scope: 'classified',
		status: 'restricted',
		reason: 'An earlier post was taken down.',
		updatedByUserId: adminUser.id
	});

	const reported = SEEDS.findIndex((s) => s.visibility === 'under_review');
	await db.insert(contentFlag).values({
		entityType: 'classified_post',
		entityId: rows[reported].id,
		reportedByUserId: authors[0].id,
		reason: 'Looks like ticket resale'
	});

	return { posts: rows.length };
}
