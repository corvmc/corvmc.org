import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { auditActionGroups, auditActionLabel, summarizeAuditEntry } from './audit-display';
import { auditActions, type AuditEntry } from '#lib/types/audit.js';
import { retiredTerms } from '#lib/config.js';

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
	it('dates a staff cancellation as the app does, and quotes its reason', () => {
		const d = { reservationId: 'r1', date: '2026-11-17', startTime: '13:30', endTime: '15:30' };
		expect(
			summarizeAuditEntry(entry('reservation.cancelled_by_staff', { ...d, reason: 'Flooded' }))
		).toBe('Cancelled the Tue, Nov 17, 1:30 PM–3:30 PM reservation: “Flooded”');
		expect(
			summarizeAuditEntry(entry('reservation.cancelled_by_staff', { ...d, reason: null }))
		).toBe('Cancelled the Tue, Nov 17, 1:30 PM–3:30 PM reservation');
	});

	it('passes through a slot an older row stored as display text', () => {
		const d = {
			reservationId: 'r1',
			date: 'Nov 3, 2026',
			startTime: '6:00 PM',
			endTime: '8:00 PM'
		};
		expect(summarizeAuditEntry(entry('reservation.comped', { ...d, waivedCents: 3000 }))).toBe(
			'Comped the Nov 3, 2026 6:00 PM–8:00 PM reservation, waiving $30.00'
		);
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

	it('names positions granted and removed by their titles', () => {
		expect(
			summarizeAuditEntry(
				entry('user.roles_changed', { added: ['treasurer'], removed: ['member'] })
			)
		).toBe('Granted Treasurer; removed member');
		expect(
			summarizeAuditEntry(entry('user.roles_changed', { added: [], removed: ['staff'] }))
		).toBe('Removed Staff');
	});

	it('quotes the reason a ban was given, and names an unban plainly', () => {
		expect(summarizeAuditEntry(entry('user.banned', { reason: 'Threatened another member' }))).toBe(
			'Banned the account: “Threatened another member”'
		);
		expect(summarizeAuditEntry(entry('user.unbanned', {}))).toBe('Lifted the ban');
	});

	it('names both addresses of an email change', () => {
		expect(
			summarizeAuditEntry(entry('user.email_change_requested', { email: 'j@example.com' }))
		).toBe('Asked to change the login email to j@example.com');
		expect(
			summarizeAuditEntry(
				entry('user.email_changed', { previousEmail: 'j@exmaple.com', newEmail: 'j@example.com' })
			)
		).toBe('Changed the login email from j@exmaple.com to j@example.com');
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

	// The retention sweep strips both after 24 months (#1376); the row stays.
	it('still says an account was purged once its name and email are stripped', () => {
		expect(summarizeAuditEntry(entry('user.purged', {}))).toBe(
			'Permanently deleted an account (name and email removed after 24 months)'
		);
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
		).toBe('Deducted 3 credits (balance 5): “Double booking”');
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

describe('the action filter', () => {
	it('offers every action once, in an area', () => {
		const offered = auditActionGroups.flatMap((g) => g.options.map((o) => o.value));
		expect([...offered].sort()).toEqual([...auditActions].sort());
	});

	it('lists each area alphabetically', () => {
		for (const { options } of auditActionGroups) {
			const labels = options.map((o) => o.label);
			expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
		}
	});

	it('gives each action its own label', () => {
		const labels = auditActions.map(auditActionLabel);
		expect(labels.filter((l, i) => labels.indexOf(l) !== i)).toEqual([]);
	});
});

/**
 * Every literal in audit-display.ts, labels and summary templates alike, held
 * to the vocabulary the message catalog is (#2831). Read from the source, so a
 * summary no fixture reaches is checked too.
 */
describe('audit wording', () => {
	const file = join(import.meta.dirname, 'audit-display.ts');
	const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
	const texts: string[] = [];
	const visit = (n: ts.Node): void => {
		if (ts.isStringLiteralLike(n) || ts.isTemplateLiteralToken(n)) texts.push(n.text);
		ts.forEachChild(n, visit);
	};
	visit(source);
	if (source.statements.length === 0) throw new Error(`could not parse ${file}`);

	it('uses no retired term (retiredTerms in src/lib/config.ts)', () => {
		const terms = retiredTerms.filter(({ keys }) => !keys || keys.test('audit'));
		const found = texts.flatMap((text) =>
			terms.filter(({ word }) => word.test(text)).map(({ use }) => `"${text}" (use ${use})`)
		);
		expect(texts.length).toBeGreaterThan(100);
		expect(found).toEqual([]);
	});
});

describe('project activity lines', () => {
	const move = (from: string | null, to: string) =>
		summarizeAuditEntry(
			entry('contractor_job.status_changed', {
				engagementId: 'j1',
				contractorName: 'Valve Doctor',
				from,
				to
			} as never)
		);

	it("tells an engagement's steps by where it came from", () => {
		expect(move(null, 'asked')).toBe('Asked Valve Doctor to do it');
		expect(move('asked', 'booked')).toBe('Booked Valve Doctor');
		expect(move('booked', 'booked')).toBe('Rebooked Valve Doctor');
		expect(move('booked', 'no_show')).toBe('Valve Doctor did not show');
	});

	it('names fields, never values, and says when the suggestion moved too', () => {
		expect(summarizeAuditEntry(entry('work_order.edited', { fields: ['capacity', 'notes'] }))).toBe(
			'Edited its places, briefing'
		);
		expect(
			summarizeAuditEntry(
				entry('project.status_changed', { from: 'planned', to: 'done', suggestionMoved: true })
			)
		).toBe('Moved the project from planned to done, and its suggestion with it');
		expect(
			summarizeAuditEntry(
				entry('project.section_deleted', { sectionId: 's1', name: 'Prep', tasks: 2 })
			)
		).toBe('Deleted the section “Prep”, keeping its 2 tasks');
	});
});
