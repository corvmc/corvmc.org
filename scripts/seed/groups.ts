import { announcement } from '../../src/lib/server/db/schema/announcement';
import { groupMember } from '../../src/lib/server/db/schema/group';
import { insertBandWithOwner } from './bands';
import { db } from './db';
import { type SeedUser } from './types';
import { pick, pickN } from './util';

/**
 * Clubs and committees — the staff-run half of the groups module.
 *
 * Kept out of the `bands` array on purpose. That array feeds `seedBandSites`,
 * `seedBandEvents` and the lineup seeds, and a program has no microsite, no gig
 * and no place on a bill. Keeping them apart here is the seed's version of the
 * `kind` filter every band-facing read now carries.
 *
 * Each of the three join policies gets a group, because the roster tab and the
 * member index lead with a different action under each and none of that can be
 * looked at locally without one of each. The Real Book Club is `open` because it
 * is the spec's driving case: a drop-in jazz jam anyone may join unaided.
 */
export async function seedGroups(users: SeedUser[]) {
	console.log('Seeding groups...');
	const groups = [];

	const definitions = [
		{
			kind: 'club' as const,
			name: 'Real Book Club',
			slug: 'real-book-club',
			bio: 'A monthly jazz jam out of the Real Book. Every level welcome — we read the head, take turns on solos, and nobody keeps score.',
			joinPolicy: 'open' as const,
			joinInstructions: 'Third Thursday, 7pm. Bring a horn; charts provided.',
			positions: ['Host', 'Chart librarian', 'Piano'],
			memberCount: 5,
			announcements: [
				{
					title: 'August jam moved to the 27th',
					body: 'The room is booked for a production on our usual Thursday, so **August only** we meet on the 27th. Same time, same charts.\n\nIf you were bringing someone new, bring them anyway — we always have a spare Real Book.',
					pinned: true,
					published: true
				},
				{
					title: 'New charts in the folder',
					body: 'Added *Blue Bossa*, *Autumn Leaves* and *Song for My Father* to the shared folder. Print your own or read off a tablet, either is fine.',
					pinned: false,
					published: true
				},
				// A draft, so the composer's unpublished state renders somewhere.
				{
					title: 'Thinking about a second monthly session',
					body: 'Nothing decided. Would a weekday afternoon slot get any takers?',
					pinned: false,
					published: false
				}
			]
		},
		{
			kind: 'committee' as const,
			name: 'Programming Committee',
			slug: 'programming-committee',
			bio: 'Decides what the Collective books, and when. Meets fortnightly.',
			joinPolicy: 'by_application' as const,
			joinInstructions:
				'Tell us what you want to see programmed and roughly how much time you can give.',
			positions: ['Chair', 'Secretary', 'Member'],
			memberCount: 3,
			announcements: [
				{
					title: 'Minutes from the 12 August meeting',
					body: 'Booked through October. Two holds pending on November — details at the next meeting.\n\n- Approved the fall showcase\n- Deferred the all-ages policy question\n- Asked Facilities about the side room',
					pinned: false,
					published: true
				}
			]
		},
		{
			kind: 'committee' as const,
			name: 'Facilities Committee',
			slug: 'facilities-committee',
			bio: 'Keeps the room standing: repairs, gear, and the long list of things nobody notices until they break.',
			joinPolicy: 'invite_only' as const,
			joinInstructions: null,
			positions: ['Chair', 'Member'],
			memberCount: 2,
			// Deliberately none: a group with nothing posted is the empty state,
			// and it has to be reachable locally.
			announcements: []
		}
	];

	for (let i = 0; i < definitions.length; i++) {
		const d = definitions[i];
		// Offset from the band owners so a leader is not also fronting a band —
		// the two roles look identical on a roster otherwise.
		const leader = users[(i + 7) % users.length];

		const g = await insertBandWithOwner(
			{
				kind: d.kind,
				name: d.name,
				slug: d.slug,
				bio: d.bio,
				joinPolicy: d.joinPolicy,
				joinInstructions: d.joinInstructions
			},
			leader.id,
			d.positions[0]
		);
		groups.push(g);

		const candidates = users.filter((u) => u.id !== leader.id);
		// Tracked, because the waiting rows below draw from the same pool. Picking
		// them independently collided with a member already seeded here and failed
		// the whole seed on `group_member.group_id, user_id` — intermittently,
		// since both picks are random.
		const taken = new Set<string>([leader.id]);
		for (const m of pickN(candidates, d.memberCount)) {
			taken.add(m.id);
			await db.insert(groupMember).values({
				groupId: g.id,
				userId: m.id,
				role: 'member',
				position: pick(d.positions.slice(1)),
				status: 'active'
			});
		}

		// One waiting row of each direction on the `by_application` committee: an
		// application it received and an invitation it sent. They are the same
		// shape and opposite meanings, which is the whole reason `'requested'` is
		// a distinct status — and the only way to see the roster render them
		// apart is to have both.
		if (d.joinPolicy === 'by_application') {
			const [applicant, invitee] = pickN(
				users.filter((u) => !taken.has(u.id)),
				2
			);
			await db.insert(groupMember).values([
				{ groupId: g.id, userId: applicant.id, role: 'member', status: 'requested' },
				{
					groupId: g.id,
					userId: invitee.id,
					role: 'member',
					status: 'pending',
					invitedById: leader.id
				}
			]);
		}

		// The admin persona gets a manager seat on the first club, deterministically.
		// Every other roster row here is a random pick from the bulk users, and
		// those have no `account` row — so without this, nothing anyone can log in
		// as can reach the announcement composer or the Documents uploader, and
		// two manager-only surfaces are unreviewable locally.
		if (i === 0) {
			const admin = users.find((u) => u.email === 'admin@corvallismusic.org');
			if (admin && admin.id !== leader.id) {
				await db
					.insert(groupMember)
					.values({
						groupId: g.id,
						userId: admin.id,
						role: 'admin',
						position: d.positions[1] ?? null,
						status: 'active'
					})
					.onConflictDoUpdate({
						// It may already be on the roster as a plain member: `pickN`
						// above draws from every user, personas included.
						target: [groupMember.groupId, groupMember.userId],
						set: { role: 'admin' }
					});
			}
		}

		// `notifiedAt` stays null on every one of these. It is the fan-out latch,
		// written only by the notification listener — seeding it would claim these
		// posts were sent, and seeding it *unset* is what leaves the listener a
		// backlog to work through locally.
		for (let j = 0; j < d.announcements.length; j++) {
			const a = d.announcements[j];
			await db.insert(announcement).values({
				groupId: g.id,
				authorId: leader.id,
				title: a.title,
				body: a.body,
				pinned: a.pinned,
				publishedAt: a.published ? new Date(Date.now() - (j + 1) * 5 * 86400000) : null
			});
		}
	}

	return groups;
}
