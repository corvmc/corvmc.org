import { describe, it, expect } from 'vitest';
import { summarizeAuditEntry } from './audit-display';
import type { AuditEntry } from '$lib/types/audit';

function entry<E extends AuditEntry>(action: E['action'], details: E['details']): AuditEntry {
	return {
		id: 'a1',
		action,
		actorUserId: 'staff-1',
		actorName: 'Sam Staff',
		actorEmail: 'sam@example.com',
		subjectType: 'user',
		subjectId: 'm1',
		subjectLabel: 'Jordan',
		details,
		createdAt: new Date('2026-09-01T12:00:00Z')
	} as AuditEntry;
}

describe('summarizeAuditEntry', () => {
	it('dates a staff cancellation and quotes its reason', () => {
		const d = {
			reservationId: 'r1',
			date: 'Thu, May 21',
			startTime: '10:00 AM',
			endTime: '11:00 AM'
		};
		expect(
			summarizeAuditEntry(entry('reservation.cancelled_by_staff', { ...d, reason: 'Flooded' }))
		).toBe('Cancelled the Thu, May 21 10:00 AM–11:00 AM reservation: “Flooded”');
		expect(
			summarizeAuditEntry(entry('reservation.cancelled_by_staff', { ...d, reason: null }))
		).toBe('Cancelled the Thu, May 21 10:00 AM–11:00 AM reservation');
	});

	it('names the band deactivated or reactivated', () => {
		const d = { bandId: 'b1', bandName: 'The Velvet Underground' };
		expect(summarizeAuditEntry(entry('band.deactivated', d))).toBe(
			'Deactivated The Velvet Underground'
		);
		expect(summarizeAuditEntry(entry('band.reactivated', d))).toBe(
			'Reactivated The Velvet Underground'
		);
	});

	it('names roles granted and removed', () => {
		expect(
			summarizeAuditEntry(entry('user.roles_changed', { added: ['admin'], removed: ['member'] }))
		).toBe('Granted admin; removed member');
		expect(
			summarizeAuditEntry(entry('user.roles_changed', { added: [], removed: ['staff'] }))
		).toBe('Removed staff');
	});

	it('names the edited profile fields in words, not column names', () => {
		expect(
			summarizeAuditEntry(entry('user.profile_updated', { fields: ['phone', 'dateOfBirth'] }))
		).toBe('Edited phone, date of birth');
	});

	it('says what a deactivation took with it', () => {
		expect(
			summarizeAuditEntry(
				entry('user.deactivated', {
					reservationsCancelled: 2,
					subscriptionCancelled: true,
					bulk: false
				})
			)
		).toBe('Deactivated the account — cancelled 2 reservations and the membership');
		expect(
			summarizeAuditEntry(
				entry('user.deactivated', {
					reservationsCancelled: 1,
					subscriptionCancelled: false,
					bulk: true,
					batchId: 'b1'
				})
			)
		).toBe('Deactivated the account (bulk) — cancelled 1 reservation');
		expect(
			summarizeAuditEntry(
				entry('user.deactivated', {
					reservationsCancelled: 0,
					subscriptionCancelled: false,
					bulk: false
				})
			)
		).toBe('Deactivated the account');
	});

	it('flags a lapsed membership on reactivation', () => {
		expect(summarizeAuditEntry(entry('user.reactivated', { subscription: 'lapsed' }))).toBe(
			'Reactivated the account — membership had lapsed'
		);
		expect(summarizeAuditEntry(entry('user.reactivated', { subscription: 'none' }))).toBe(
			'Reactivated the account'
		);
	});

	it('names who was purged, since the row is all that is left of them', () => {
		expect(
			summarizeAuditEntry(entry('user.purged', { name: 'Jordan', email: 'j@example.com' }))
		).toBe('Permanently deleted Jordan (j@example.com)');
	});

	it('signs a credit adjustment and quotes the reason', () => {
		expect(
			summarizeAuditEntry(
				entry('credits.adjusted', {
					creditType: 'free_hours',
					delta: -3,
					balanceAfter: 5,
					description: 'Double booking'
				})
			)
		).toBe('Deducted 3 free hours (balance 5): “Double booking”');
		expect(
			summarizeAuditEntry(
				entry('credits.adjusted', {
					creditType: 'equipment_credits',
					delta: 2,
					balanceAfter: 2,
					description: 'Goodwill'
				})
			)
		).toBe('Added 2 equipment credits (balance 2): “Goodwill”');
	});
});
