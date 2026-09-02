import { contentFlag } from '../../src/lib/server/db/schema/flag';
import { db } from './db';
import { pick } from './util';

export async function seedContentFlags(users: any[], bands: any[], bandEvents: any[] = []) {
	console.log('Seeding content flags...');
	const REASONS = [
		'Inappropriate language in bio',
		'Possible impersonation',
		'Spam links in profile',
		'Offensive band name',
		'Outdated / misleading info'
	];
	const STATUSES = ['pending', 'pending', 'pending', 'resolved', 'dismissed'] as const;
	const rows = [];

	for (let i = 0; i < 5; i++) {
		const reporter = users[i % users.length];
		const flagBand = i % 2 === 0 && bands.length > 0;
		const target = flagBand ? pick(bands) : pick(users.filter((u) => u.id !== reporter.id));
		const status = STATUSES[i];
		const resolved = status !== 'pending';

		const [row] = await db
			.insert(contentFlag)
			.values({
				entityType: flagBand ? 'band_profile' : 'member_profile',
				entityId: target.id,
				reportedByUserId: reporter.id,
				reason: REASONS[i],
				description: i % 3 === 0 ? 'Flagged via the directory report button.' : null,
				status,
				resolvedByUserId: resolved ? users[0].id : null,
				resolutionNotes: resolved
					? status === 'resolved'
						? 'Content edited.'
						: 'No action needed.'
					: null,
				resolvedAt: resolved ? new Date() : null
			})
			.returning();
		rows.push(row);
	}

	// Event listing flags: reportable by anyone (Turnstile-gated), so include an
	// anonymous report alongside a member report and a resolved-with-note row.
	const published = bandEvents.filter((e) => e.status === 'published');
	const EVENT_FLAGS = [
		{
			reporter: users[1] ?? users[0],
			reason: 'Event is not real',
			description: null,
			status: 'pending' as const
		},
		{
			reporter: users[2] ?? users[0],
			reason: 'Offensive poster art',
			description: null,
			status: 'resolved' as const
		},
		// Anonymous report — requires the nullable reported_by_user_id migration.
		{
			reporter: null,
			reason: 'Misleading ticket link',
			description: 'The tickets button goes to an unrelated site.',
			status: 'pending' as const
		}
	];

	for (let i = 0; i < EVENT_FLAGS.length && i < published.length; i++) {
		const f = EVENT_FLAGS[i];
		const resolved = f.status !== 'pending';
		const [row] = await db
			.insert(contentFlag)
			.values({
				entityType: 'event',
				entityId: published[i].id,
				reportedByUserId: f.reporter?.id ?? null,
				reason: f.reason,
				description: f.description,
				status: f.status,
				resolvedByUserId: resolved ? users[0].id : null,
				resolutionNotes: resolved ? 'Event unpublished; band notified.' : null,
				resolvedAt: resolved ? new Date() : null
			})
			.returning();
		rows.push(row);
	}

	return rows;
}
