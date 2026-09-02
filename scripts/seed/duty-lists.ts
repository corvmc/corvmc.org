import {
	dutyList,
	dutyListItem,
	volunteerShift,
	workTask
} from '../../src/lib/server/db/schema/volunteer';
import { batchInsert } from './db';

/**
 * A duty list, and one show it has been stamped onto.
 *
 * Renders the whole shape in one place: a list whose items are described
 * relative to doors, the work orders an apply produces from it — four with
 * windows and one with only a deadline — and a checklist on the ones that carry
 * tasks, partly ticked. Without this the difference between a scheduled shift
 * and an unscheduled work order is invisible locally, which is the difference
 * the feature is about.
 */
export async function seedDutyLists(volunteerRoles: any[], events: any[]) {
	console.log('Seeding duty lists...');
	const byName = new Map(volunteerRoles.map((r: any) => [r.name, r]));
	const bookingLead = byName.get('Booking Lead');
	const setup = byName.get('Event Setup');
	const sound = byName.get('Sound Engineering');
	const desk = byName.get('Front Desk');
	const teardown = byName.get('Load-Out & Teardown');
	if (!bookingLead || !setup || !sound || !desk || !teardown) return { lists: 0, workOrders: 0 };

	await batchInsert(dutyList, [
		{
			id: 'seed-duty-standard-show',
			name: 'Standard Show',
			description:
				'What it takes to run an ordinary night: someone to advance it, someone to set the room, someone on the desk, someone on the board, and enough hands to put it all away.',
			anchor: 'doors' as const,
			createdByUserId: 'seed-vol-coordinator'
		}
	]);

	const items = [
		{
			id: 'seed-duty-item-booking',
			volunteerRoleId: bookingLead.id,
			// A week before doors, and no window: the Booking Lead does this when
			// they can, not between two times.
			dueOffsetMinutes: -10_080,
			capacity: 1,
			notes: 'Everything that has to be true before the day of.',
			sortOrder: 10,
			tasks: [
				'Confirm the lineup and set times with every act',
				'Collect tech riders and stage plots',
				'Confirm backline — what we supply, what they bring',
				'Send load-in details and the door split',
				'Poster to social and the mailing list',
				'Ticket link live and tested'
			]
		},
		{
			id: 'seed-duty-item-setup',
			volunteerRoleId: setup.id,
			offsetMinutes: -180,
			durationMinutes: 120,
			capacity: 2,
			sortOrder: 20,
			tasks: ['Chairs and tables out', 'Merch table set', 'Bathrooms checked and stocked']
		},
		{
			id: 'seed-duty-item-sound',
			volunteerRoleId: sound.id,
			offsetMinutes: -120,
			durationMinutes: 300,
			capacity: 1,
			sortOrder: 30,
			tasks: ['Line check every input', 'Monitor mixes with each act']
		},
		{
			id: 'seed-duty-item-desk',
			volunteerRoleId: desk.id,
			offsetMinutes: 0,
			durationMinutes: 180,
			capacity: 2,
			sortOrder: 40,
			tasks: ['Float counted before doors', 'Wristbands and stamps out']
		},
		{
			id: 'seed-duty-item-teardown',
			volunteerRoleId: teardown.id,
			offsetMinutes: 240,
			durationMinutes: 90,
			capacity: 3,
			sortOrder: 50,
			tasks: [
				'Gear back to storage',
				'Room reset — chairs and tables away',
				'Trash and recycling out',
				'Lock up'
			]
		}
	].map((i) => ({ ...i, dutyListId: 'seed-duty-standard-show' }));

	await batchInsert(dutyListItem, items, 6);

	// Apply it to a show that has not happened yet, so its work orders are live.
	const show = events.find(
		(e: any) => e.status === 'published' && e.kind === 'show' && e.endsAt && e.startsAt > new Date()
	);
	if (!show) return { lists: 1, workOrders: 0 };

	const anchor: Date = show.doorsAt ?? show.startsAt;
	const at = (minutes: number) => new Date(anchor.getTime() + minutes * 60_000);

	const workOrders = items.map((item, n) => ({
		id: `seed-duty-wo-${n}`,
		volunteerRoleId: item.volunteerRoleId,
		eventId: show.id,
		startsAt: item.offsetMinutes !== undefined ? at(item.offsetMinutes) : null,
		endsAt:
			item.offsetMinutes !== undefined
				? at(item.offsetMinutes + (item.durationMinutes ?? 0))
				: null,
		dueAt: item.dueOffsetMinutes !== undefined ? at(item.dueOffsetMinutes) : null,
		capacity: item.capacity,
		notes: item.notes ?? null,
		dutyListId: 'seed-duty-standard-show',
		createdByUserId: 'seed-vol-coordinator'
	}));
	await batchInsert(volunteerShift, workOrders, 8);

	// Half of the Booking Lead's advance list already done, so the partly-worked
	// state is rendered rather than only the empty and finished ones.
	const tasks = items.flatMap((item, n) =>
		item.tasks.map((label, i) => ({
			id: `seed-duty-task-${n}-${i}`,
			workOrderId: `seed-duty-wo-${n}`,
			label,
			sortOrder: i,
			...(n === 0 && i < 3
				? {
						done: true,
						doneAt: new Date(Date.now() - (3 - i) * 86_400_000),
						doneByUserId: 'seed-vol-coordinator'
					}
				: {})
		}))
	);
	await batchInsert(workTask, tasks, 12);

	return { lists: 1, workOrders: workOrders.length };
}
