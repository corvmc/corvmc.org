import { auditLog } from '../../src/lib/server/db/schema/audit';
import type { AuditEntryInput } from '../../src/lib/server/audit/audit-service';
import { db } from './db';
import type { SeedUser } from './types';

const DAY = 86_400_000;

/**
 * Staff history on a handful of members, so the History card on
 * /staff/users/[id] has something to show. Covers every action key, a
 * self-closed account, a bulk pair sharing a batch id, a "System" row, and a
 * purge whose subject no longer exists.
 */
export async function seedAuditLog(users: SeedUser[], admin: SeedUser) {
	console.log('Seeding audit log...');
	const [a, b, c, d] = users;
	const staff = { id: admin.id, name: admin.name, email: admin.email };
	const system = { id: null, name: 'System', email: '' };
	const batchId = '00000000-0000-4000-8000-00000000a0d1';
	const subject = (u: SeedUser) => ({ type: 'user' as const, id: u.id, label: u.name });

	const rows: (AuditEntryInput & { daysAgo: number })[] = [
		{
			daysAgo: 58,
			action: 'user.roles_changed',
			subject: subject(a),
			details: { added: ['staff'], removed: [] }
		},
		{
			daysAgo: 40,
			action: 'user.profile_updated',
			subject: subject(a),
			details: { fields: ['phone', 'pronouns'] }
		},
		{
			daysAgo: 21,
			action: 'credits.adjusted',
			subject: subject(a),
			details: {
				creditType: 'free_hours',
				delta: 2,
				balanceAfter: 6,
				description: 'Room was double-booked on the 4th'
			}
		},
		{
			daysAgo: 3,
			action: 'user.roles_changed',
			subject: subject(a),
			details: { added: [], removed: ['staff'] }
		},
		{
			daysAgo: 30,
			action: 'credits.adjusted',
			subject: subject(b),
			details: {
				creditType: 'equipment_credits',
				delta: -1,
				balanceAfter: 0,
				description: 'Broken cable, agreed with member'
			}
		},
		{
			daysAgo: 14,
			action: 'user.deactivated',
			subject: subject(c),
			actor: { id: c.id, name: c.name, email: c.email },
			details: { reservationsCancelled: 1, subscriptionCancelled: true, bulk: false }
		},
		{
			daysAgo: 9,
			action: 'user.reactivated',
			subject: subject(c),
			details: { subscription: 'lapsed' }
		},
		{
			daysAgo: 12,
			action: 'user.deactivated',
			subject: subject(d),
			details: { reservationsCancelled: 0, subscriptionCancelled: false, bulk: true, batchId }
		},
		{
			daysAgo: 12,
			action: 'user.reactivated',
			subject: subject(d),
			actor: system,
			details: { subscription: 'none' }
		},
		{
			daysAgo: 7,
			action: 'user.purged',
			subject: { type: 'user', id: 'purged-seed-account', label: 'Casey Former' },
			details: { name: 'Casey Former', email: 'casey.former@example.com' }
		}
	];

	for (const { daysAgo, actor = staff, ...row } of rows) {
		await db.insert(auditLog).values({
			action: row.action,
			actorUserId: actor.id,
			actorName: actor.name,
			actorEmail: actor.email,
			subjectType: row.subject.type,
			subjectId: row.subject.id,
			subjectLabel: row.subject.label ?? null,
			details: row.details as Record<string, unknown>,
			createdAt: new Date(Date.now() - daysAgo * DAY)
		});
	}

	return { entries: rows.length };
}
