import { incident, incidentNote } from '../../src/lib/server/db/schema/incident';
import { auditLog } from '../../src/lib/server/db/schema/audit';
import { batchInsert } from './db';
import { randomUUID } from 'crypto';

/**
 * The incident log. Every category, both statuses, one incident with a member
 * linked, and one that was reopened and one held — each with the audit entry
 * the detail page's History card renders.
 */
export async function seedIncidents(
	staff: { id: string; name: string; email: string },
	member: { id: string; name: string }
) {
	const day = 24 * 3600_000;
	const ago = (d: number, hour = 22) => {
		const t = new Date(Date.now() - d * day);
		t.setHours(hour, 30, 0, 0);
		return t;
	};
	const by = { reportedByUserId: staff.id, reportedByName: staff.name };
	const resolved = (d: number, resolution: string) => ({
		status: 'resolved' as const,
		resolution,
		resolvedByUserId: staff.id,
		resolvedAt: ago(d, 12)
	});

	const ids = {
		noise: randomUUID(),
		reopened: randomUUID(),
		conduct: randomUUID(),
		retained: randomUUID()
	};

	const incidents = await batchInsert(incident, [
		{
			id: ids.noise,
			occurredAt: ago(3),
			category: 'noise_complaint',
			location: 'Main room',
			summary: 'Neighbour on 4th St called about the bass during the late set',
			description:
				'Call came in to the house phone at 10:40pm. Sound tech brought the subs down 6dB; no second call.',
			...by
		},
		{
			id: ids.reopened,
			occurredAt: ago(40),
			category: 'noise_complaint',
			location: 'Alley door',
			summary: 'Same neighbour — load-out noise after midnight',
			description: 'Load-out ran to 12:20am with the alley door propped open.',
			...by
		},
		{
			occurredAt: ago(12, 20),
			category: 'injury',
			location: 'Stage stairs',
			summary: 'Drummer rolled an ankle on the stage-left stairs',
			description:
				'Missed the bottom step carrying a floor tom. Ice from the bar; declined an ambulance. Stair edge is unlit.',
			...by,
			...resolved(10, 'Added glow tape to the stair nosing and a clip light.')
		},
		{
			occurredAt: ago(20),
			category: 'safety_hazard',
			location: 'Green room',
			summary: 'Extension cord run across the green-room doorway',
			description: 'Trip hazard during changeover; taped down for the night.',
			...by
		},
		{
			id: ids.conduct,
			occurredAt: ago(6, 23),
			category: 'conduct',
			location: 'Front door',
			summary: 'Argument at the door over re-entry',
			description:
				'Member insisted on re-entry without a stamp and raised their voice at the door volunteer. Left after ten minutes.',
			involvedUserId: member.id,
			...by
		},
		{
			occurredAt: ago(30, 1),
			category: 'property_damage',
			location: 'Lobby',
			summary: 'Lobby window cracked overnight',
			description: 'Found at opening. Police report filed; glass company booked.',
			...by,
			...resolved(25, 'Pane replaced; insurance claim filed.')
		},
		{
			id: ids.retained,
			occurredAt: ago(50),
			category: 'theft',
			location: 'Merch table',
			summary: 'Cash box short $40 after close',
			description: 'Counted twice at close. No sign of forced entry.',
			// The one retention hold, so the detail page renders both states.
			retain: true,
			...by
		},
		{
			occurredAt: ago(8, 15),
			category: 'other',
			summary: 'Fire alarm tripped by a fog machine',
			description:
				'Band brought their own fog machine. Alarm company called back within five minutes.',
			...by,
			...resolved(7, 'Fog machines added to the band rider as not permitted.')
		}
	]);

	const notes = await batchInsert(incidentNote, [
		{
			incidentId: ids.noise,
			authorUserId: staff.id,
			authorName: staff.name,
			body: 'Dropped a note through their door with the house phone number.',
			createdAt: new Date(Date.now() - 2 * day)
		},
		{
			incidentId: ids.conduct,
			authorUserId: staff.id,
			authorName: staff.name,
			body: 'Spoke with them the next day; they apologised to the volunteer.',
			createdAt: new Date(Date.now() - 5 * day)
		}
	]);

	const actor = { actorUserId: staff.id, actorName: staff.name, actorEmail: staff.email };
	await batchInsert(auditLog, [
		{
			...actor,
			action: 'incident.reopened',
			subjectType: 'incident',
			subjectId: ids.reopened,
			subjectLabel: 'Same neighbour — load-out noise after midnight',
			details: { previousResolution: 'Asked bands to keep the alley door shut after 11.' },
			createdAt: new Date(Date.now() - 3 * day)
		},
		{
			...actor,
			action: 'incident.retention_changed',
			subjectType: 'incident',
			subjectId: ids.retained,
			subjectLabel: 'Cash box short $40 after close',
			details: { retain: true, reason: 'Open insurance claim.' },
			createdAt: new Date(Date.now() - 45 * day)
		}
	]);

	return { incidents: incidents.length, notes: notes.length };
}

/**
 * A crew member's filing from a show they worked, still awaiting staff review,
 * so the staff log and the volunteer's shift page both have one to show.
 */
export async function seedCrewIncidentFiling(
	completions: { userId: string; eventId: string | null; endsAt: Date }[],
	names: Map<string, string>
) {
	const worked = completions.find((c) => c.eventId && names.has(c.userId));
	if (!worked?.eventId) return { filings: 0 };
	await batchInsert(incident, [
		{
			occurredAt: new Date(worked.endsAt.getTime() - 3_600_000),
			category: 'safety_hazard',
			location: 'Side stage',
			summary: 'Cable run across the side-stage steps',
			description: 'Taped it down during the changeover. Worth a proper cable ramp.',
			eventId: worked.eventId,
			reportedByUserId: worked.userId,
			reportedByName: names.get(worked.userId)!,
			status: 'reported' as const
		}
	]);
	return { filings: 1 };
}
