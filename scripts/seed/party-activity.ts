import { sql } from 'drizzle-orm';
import { activity } from '../../src/lib/server/db/schema/activity';
import { workOrder } from '../../src/lib/server/db/schema/volunteer';
import { workOrderLink } from '../../src/lib/server/db/schema/work-order-link';
import { batchInsert, db } from './db';

const ARTS = 'seed-org-arts-center';

/**
 * The Corvallis Arts Center's timeline (#2622): one note of each kind, a note
 * on its programs director, an open follow-up due next week and one done last
 * month, so the organization page, the person page and the Contacts list's last
 * activity and next task all render something. Needs `seedContacts`.
 */
export async function seedPartyActivity(staffId: string) {
	console.log('Seeding contact activity...');
	const now = Date.now();
	const day = 86_400_000;
	// Days as club dates, taken at midday UTC so none lands on the day before.
	const on = (offset: number) => new Date(now + offset * day).toISOString().slice(0, 10);

	const notes = [
		{ kind: 'meeting' as const, occurredOn: on(-40), body: 'Planned the winter showcase dates.' },
		{ kind: 'email' as const, occurredOn: on(-21), body: 'Sent the draft lineup.' },
		{ kind: 'call' as const, occurredOn: on(-9), body: 'Confirmed the hall for two nights.' },
		{ kind: 'note' as const, occurredOn: on(-2), body: 'They want posters by the 1st.' }
	];
	await batchInsert(
		activity,
		notes.map((n) => ({ ...n, organizationId: ARTS, authorUserId: staffId }))
	);
	// The person row is read back by address: this file never names the contact table.
	await db.run(sql`
		insert into activity (id, contact_id, kind, occurred_on, body, author_user_id)
		select lower(hex(randomblob(16))), id, 'call', ${on(-9)}, 'Prefers a call to email.', ${staffId}
		from contact where email = 'lena@example.org'
	`);

	const open = 'seed-task-arts-posters';
	const done = 'seed-task-arts-contract';
	await batchInsert(workOrder, [
		{
			id: open,
			title: 'Send showcase posters to the Arts Center',
			dueAt: new Date(now + 6 * day),
			createdByUserId: staffId
		},
		{
			id: done,
			title: 'Sign the hall agreement',
			resolvedAt: new Date(now - 30 * day),
			resolvedByUserId: staffId,
			createdByUserId: staffId
		}
	]);
	await batchInsert(workOrderLink, [
		{ workOrderId: open, organizationId: ARTS },
		{ workOrderId: done, organizationId: ARTS }
	]);
	return { notes: notes.length + 1, tasks: 2 };
}
