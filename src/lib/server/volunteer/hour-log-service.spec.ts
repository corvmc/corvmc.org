import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — the chainable db proxy from equipment-service.spec.ts
// ---------------------------------------------------------------------------

let selectResult: unknown[] = [];
let selectResultQueue: unknown[][] = [];
let insertResult: unknown[] = [];
let updateResult: unknown[] = [];
let deleteResult: unknown[] = [];

function chainable(result?: unknown[]) {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => {
					if (result !== undefined) return resolve(result);
					if (selectResultQueue.length > 0) return resolve(selectResultQueue.shift()!);
					return resolve(selectResult);
				};
			}
			return () => proxy;
		}
	});
	return proxy;
}

const insertValues = vi.fn();

vi.mock('#lib/server/db/index.js', () => ({
	db: {
		select: vi.fn(() => chainable()),
		insert: vi.fn(() => ({
			values: vi.fn((v: unknown) => {
				insertValues(v);
				return { returning: vi.fn(() => Promise.resolve(insertResult)) };
			})
		})),
		update: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(() => ({
					returning: vi.fn(() => Promise.resolve(updateResult))
				}))
			}))
		})),
		delete: vi.fn(() => ({
			where: vi.fn(() => ({
				returning: vi.fn(() => Promise.resolve(deleteResult))
			}))
		}))
	}
}));

const emit = vi.fn(() => Promise.resolve());
vi.mock('#lib/server/event-bus/event-bus.js', () => ({
	domainEvents: {
		emit: (...args: unknown[]) => emit(...(args as [])),
		on: vi.fn()
	}
}));

const deductCredits = vi.fn();
const addCredits = vi.fn();
vi.mock('#lib/server/finance/credit-service.js', () => ({
	deductCredits: (...args: unknown[]) => deductCredits(...(args as [])),
	addCredits: (...args: unknown[]) => addCredits(...(args as [])),
	getBalance: vi.fn(() => Promise.resolve(0))
}));

const getActiveVolunteerRoleById = vi.fn();
vi.mock('./volunteer-role-service', async () => {
	const { DomainError } = await import('#lib/server/errors.js');
	class VolunteerRoleNotFoundError extends DomainError {
		readonly httpStatus = 404;
		constructor() {
			super('Volunteer role not found');
		}
	}
	return {
		getActiveVolunteerRoleById: (...args: unknown[]) => getActiveVolunteerRoleById(...(args as [])),
		VolunteerRoleNotFoundError
	};
});

/**
 * The onboarding gate `submitHours` and `updateHourLog` now run first. Stubbed to a cleared
 * volunteer by default so the guards under test stay the subject; the blocked
 * cases drive it explicitly. Real error classes come from the original module.
 */
const requireActiveVolunteer = vi.fn(async () => ({ id: 'vp-1', status: 'active' }));
vi.mock('./volunteer-profile-service', async (importOriginal) => ({
	...(await importOriginal<object>()),
	requireActiveVolunteer: (...args: unknown[]) => requireActiveVolunteer(...(args as []))
}));

/** Ids of logs missing a clearance; empty by default, so a log counts on entry. */
let unclearedIds = new Set<string>();
vi.mock('./member-certification-service', () => ({
	flagUnclearedLogs: async () => unclearedIds
}));

vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));
const recordAuditEntry = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock('#lib/server/audit/audit-service.js', () => ({
	recordAuditEntry: (...args: unknown[]) => recordAuditEntry(...args)
}));
vi.mock('#lib/server/authorization.js', () => ({ topPositionFor: vi.fn(() => 'member') }));

import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import {
	submitHours,
	updateHourLog,
	withdrawHourLog,
	approveHourLog,
	approveHourLogs,
	rejectHourLog,
	getUserHourSummary,
	HourLogNotFoundError,
	HourLogAlreadyReviewedError,
	HourLogNotEditableError,
	HourLogValidationError,
	TooManyHourLogsError
} from './hour-log-service';
import { VolunteerRoleNotFoundError } from './volunteer-role-service';
import {
	DEFAULT_TIMEZONE,
	VOLUNTEER_BACKDATE_LIMIT_DAYS,
	VOLUNTEER_MAX_MINUTES_PER_LOG,
	VOLUNTEER_REVIEW_MINUTES_OVER
} from '#lib/config.js';

const ROLE = { id: 'role-1', name: 'Front Desk', isActive: true, isSpecializedSkill: false };
const USER_ID = 'user-1';
const STAFF_ID = 'staff-1';

/** A YYYY-MM-DD string N days before today. */
/**
 * A YYYY-MM-DD string N days before today **in club time** — the same clock the
 * service validates against. Using the UTC date here would make `daysAgo(0)`
 * mean tomorrow for the seven hours after UTC midnight, and the boundary cases
 * below would flake once a day.
 */
function daysAgo(n: number): string {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() - n);
	return new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE }).format(d);
}

function pendingLog(overrides: Record<string, unknown> = {}) {
	return {
		id: 'log-1',
		userId: USER_ID,
		volunteerRoleId: ROLE.id,
		status: 'pending',
		minutes: 120,
		workedOn: new Date(),
		description: 'Covered the door',
		reviewedAt: null,
		...overrides
	};
}

function validSubmission(overrides: Record<string, unknown> = {}) {
	return {
		volunteerRoleId: ROLE.id,
		workedOn: daysAgo(2),
		minutes: 120,
		description: 'Covered the door',
		...overrides
	};
}

describe('HourLogService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		selectResult = [];
		selectResultQueue = [];
		insertResult = [pendingLog()];
		updateResult = [pendingLog({ status: 'approved' })];
		deleteResult = [pendingLog()];
		getActiveVolunteerRoleById.mockResolvedValue(ROLE);
		unclearedIds = new Set();
	});

	describe('submitHours', () => {
		// Trust-first (#1943): a routine log counts on entry, with no reviewer named.
		it('lands a routine log approved, reviewed by nobody', async () => {
			await submitHours(USER_ID, validSubmission());
			expect(insertValues).toHaveBeenCalledWith(
				expect.objectContaining({ status: 'approved', reviewedByUserId: null, reviewedAt: null })
			);
		});

		it('announces nothing for a routine log', async () => {
			await submitHours(USER_ID, validSubmission());
			await new Promise((r) => setTimeout(r, 0));
			expect(emit).not.toHaveBeenCalled();
		});

		it.each([
			['a missing clearance', () => (unclearedIds = new Set(['candidate'])), {}, 'uncleared'],
			[
				'a specialized-skill role',
				() => getActiveVolunteerRoleById.mockResolvedValue({ ...ROLE, isSpecializedSkill: true }),
				{},
				'specialized'
			],
			['a long entry', () => {}, { minutes: VOLUNTEER_REVIEW_MINUTES_OVER + 15 }, 'long']
		])('holds %s for review and says why', async (_label, arrange, overrides, reason) => {
			arrange();
			await submitHours(USER_ID, validSubmission(overrides));
			await new Promise((r) => setTimeout(r, 0));

			expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
			expect(emit).toHaveBeenCalledWith(
				'volunteer.hours_submitted',
				expect.objectContaining({ reasons: [reason] })
			);
		});

		it('counts an entry of exactly the review threshold on entry', async () => {
			await submitHours(USER_ID, validSubmission({ minutes: VOLUNTEER_REVIEW_MINUTES_OVER }));
			expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ status: 'approved' }));
		});

		it('files against the submitted role with no shift (Phase 2 is not built)', async () => {
			await submitHours(USER_ID, validSubmission());
			expect(insertValues).toHaveBeenCalledWith(
				expect.objectContaining({ volunteerRoleId: ROLE.id, shiftId: null })
			);
		});

		/**
		 * The report buckets months with a UTC `strftime`, so the stored instant
		 * has to sit mid-day UTC for the bucket to match the local date. Midnight
		 * local would pass today (00:00 PT is 07:00 UTC, same day) and silently
		 * break if the club timezone ever moved UTC-ahead. This pins the anchor.
		 */
		it('anchors workedOn at 12:00 club time, not at a local midnight', async () => {
			await submitHours(USER_ID, validSubmission({ workedOn: daysAgo(3) }));

			const stored = insertValues.mock.calls[0][0].workedOn as Date;
			const clubHour = new Intl.DateTimeFormat('en-US', {
				timeZone: DEFAULT_TIMEZONE,
				hour: 'numeric',
				hour12: false
			}).format(stored);

			expect(Number(clubHour)).toBe(12);
		});

		it('keeps the UTC month equal to the submitted local date month', async () => {
			const submitted = daysAgo(3);
			await submitHours(USER_ID, validSubmission({ workedOn: submitted }));

			const stored = insertValues.mock.calls[0][0].workedOn as Date;
			expect(stored.toISOString().slice(0, 7)).toBe(submitted.slice(0, 7));
		});

		it('trims the description before storing it', async () => {
			await submitHours(USER_ID, validSubmission({ description: '  Covered the door  ' }));
			expect(insertValues).toHaveBeenCalledWith(
				expect.objectContaining({ description: 'Covered the door' })
			);
		});

		it('emits volunteer.hours_submitted with display hours, not minutes', async () => {
			unclearedIds = new Set(['candidate']);
			insertResult = [pendingLog({ minutes: 90 })];
			await submitHours(USER_ID, validSubmission({ minutes: 90 }));
			await new Promise((r) => setTimeout(r, 0));
			expect(emit).toHaveBeenCalledWith(
				'volunteer.hours_submitted',
				expect.objectContaining({ hours: 1.5, roleName: ROLE.name })
			);
		});

		it.each([
			['zero minutes', { minutes: 0 }],
			['negative minutes', { minutes: -30 }],
			['a fractional minute count', { minutes: 90.5 }],
			['more than the per-log cap', { minutes: VOLUNTEER_MAX_MINUTES_PER_LOG + 1 }],
			['a blank description', { description: '   ' }],
			['an over-long description', { description: 'x'.repeat(1001) }]
		])('rejects %s', async (_label, overrides) => {
			await expect(submitHours(USER_ID, validSubmission(overrides))).rejects.toThrow(
				HourLogValidationError
			);
		});

		/**
		 * Regression: `workedOn` is pinned to noon club time, and the future check
		 * originally compared that instant against `now`. Every morning, noon
		 * today was still ahead — so a member could not log hours for the day they
		 * worked until after 12pm. The check compares calendar dates now. Every
		 * other case here uses a past date, which is why it went unnoticed.
		 */
		it('accepts today, at any hour of the day', async () => {
			await expect(
				submitHours(USER_ID, validSubmission({ workedOn: daysAgo(0) }))
			).resolves.toBeDefined();
		});

		it('accepts the oldest date still inside the backdate window', async () => {
			await expect(
				submitHours(USER_ID, validSubmission({ workedOn: daysAgo(VOLUNTEER_BACKDATE_LIMIT_DAYS) }))
			).resolves.toBeDefined();
		});

		it('rejects a future date', async () => {
			const tomorrow = new Date();
			tomorrow.setDate(tomorrow.getDate() + 1);
			await expect(
				submitHours(USER_ID, validSubmission({ workedOn: tomorrow.toISOString().slice(0, 10) }))
			).rejects.toThrow(HourLogValidationError);
		});

		it('rejects a date older than the backdate limit', async () => {
			await expect(
				submitHours(
					USER_ID,
					validSubmission({ workedOn: daysAgo(VOLUNTEER_BACKDATE_LIMIT_DAYS + 5) })
				)
			).rejects.toThrow(HourLogValidationError);
		});

		/**
		 * The staff door, and the sentence it exists to make true. Both the help article
		 * and this service's own backdate error tell a member to "ask staff to add
		 * anything older" — and until `enteredByUserId` existed, staff could not add
		 * anything at all (docs/reports/volunteer-workflow-findings.md#b1).
		 */
		describe('entered by staff', () => {
			const STAFF_ID = 'staff-1';

			it('accepts a date well outside the member backdate window', async () => {
				await expect(
					submitHours(
						USER_ID,
						validSubmission({ workedOn: daysAgo(VOLUNTEER_BACKDATE_LIMIT_DAYS * 2) }),
						{ enteredByUserId: STAFF_ID }
					)
				).resolves.toBeDefined();
			});

			it('lands approved and attributed to the staffer, even as an exception', async () => {
				getActiveVolunteerRoleById.mockResolvedValue({ ...ROLE, isSpecializedSkill: true });
				await submitHours(USER_ID, validSubmission(), { enteredByUserId: STAFF_ID });

				expect(insertValues).toHaveBeenCalledWith(
					expect.objectContaining({
						status: 'approved',
						reviewedByUserId: STAFF_ID
					})
				);
			});

			it('emits nothing — there is no log waiting for anybody to look at', async () => {
				await submitHours(USER_ID, validSubmission(), { enteredByUserId: STAFF_ID });
				expect(emit).not.toHaveBeenCalled();
			});

			it('still refuses a future date, whoever is typing', async () => {
				const tomorrow = new Date();
				tomorrow.setDate(tomorrow.getDate() + 1);
				await expect(
					submitHours(USER_ID, validSubmission({ workedOn: tomorrow.toISOString().slice(0, 10) }), {
						enteredByUserId: STAFF_ID
					})
				).rejects.toThrow(HourLogValidationError);
			});

			it('leaves the member path exactly as it was', async () => {
				await expect(
					submitHours(
						USER_ID,
						validSubmission({ workedOn: daysAgo(VOLUNTEER_BACKDATE_LIMIT_DAYS * 2) })
					)
				).rejects.toThrow(HourLogValidationError);
			});
		});

		it('rejects a malformed date', async () => {
			await expect(
				submitHours(USER_ID, validSubmission({ workedOn: 'last Tuesday' }))
			).rejects.toThrow(HourLogValidationError);
		});

		// getActiveVolunteerRoleById filters on isActive, so an archived role and a
		// nonexistent one are the same 404 to a member composing a new log.
		it('rejects an unknown or archived role', async () => {
			getActiveVolunteerRoleById.mockResolvedValue(null);
			await expect(submitHours(USER_ID, validSubmission())).rejects.toThrow(
				VolunteerRoleNotFoundError
			);
		});
	});

	describe('updateHourLog', () => {
		it('updates a pending log owned by the member', async () => {
			selectResult = [pendingLog()];
			updateResult = [pendingLog({ minutes: 180 })];
			const row = await updateHourLog('log-1', USER_ID, { minutes: 180 });
			expect(row.minutes).toBe(180);
		});

		it('refuses a log owned by someone else', async () => {
			selectResult = [pendingLog({ userId: 'someone-else' })];
			await expect(updateHourLog('log-1', USER_ID, { minutes: 180 })).rejects.toThrow(
				HourLogNotEditableError
			);
		});

		it('refuses a log staff have approved', async () => {
			selectResult = [pendingLog({ status: 'approved', reviewedAt: new Date() })];
			await expect(updateHourLog('log-1', USER_ID, { minutes: 180 })).rejects.toThrow(
				HourLogNotEditableError
			);
		});

		it('lets the member fix a log that counted on entry', async () => {
			selectResult = [pendingLog({ status: 'approved' })];
			updateResult = [pendingLog({ status: 'approved', minutes: 180 })];
			const row = await updateHourLog('log-1', USER_ID, { minutes: 180 });
			expect(row.minutes).toBe(180);
		});

		// The returned log's "Fix it" used to throw: only pending logs were editable.
		it('classifies a corrected returned log again and clears the review', async () => {
			selectResult = [pendingLog({ status: 'rejected', reviewedAt: new Date() })];
			updateResult = [pendingLog({ status: 'approved' })];
			const set = vi.fn(() => ({
				where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve(updateResult)) }))
			}));
			vi.mocked(db.update).mockReturnValueOnce({ set } as never);

			await updateHourLog('log-1', USER_ID, { minutes: 90 });

			expect(set).toHaveBeenCalledWith(
				expect.objectContaining({
					status: 'approved',
					minutes: 90,
					reviewedByUserId: null,
					reviewNotes: null
				})
			);
		});

		it('throws when the log is gone', async () => {
			selectResult = [];
			await expect(updateHourLog('missing', USER_ID, { minutes: 180 })).rejects.toThrow(
				HourLogNotFoundError
			);
		});
	});

	describe('withdrawHourLog', () => {
		// Withdrawal is a hard delete rather than a fourth status: nothing
		// references an hour log, and a `withdrawn` status is a value no report
		// would ever select.
		it('deletes a pending log owned by the member', async () => {
			selectResult = [pendingLog()];
			deleteResult = [pendingLog()];
			await expect(withdrawHourLog('log-1', USER_ID)).resolves.toBeUndefined();
		});

		it('refuses a log owned by someone else', async () => {
			selectResult = [pendingLog({ userId: 'someone-else' })];
			await expect(withdrawHourLog('log-1', USER_ID)).rejects.toThrow(HourLogNotEditableError);
		});

		it('refuses a log staff have approved', async () => {
			selectResult = [pendingLog({ status: 'approved', reviewedAt: new Date() })];
			await expect(withdrawHourLog('log-1', USER_ID)).rejects.toThrow(HourLogNotEditableError);
		});

		it('withdraws a log that counted on entry', async () => {
			selectResult = [pendingLog({ status: 'approved' })];
			await expect(withdrawHourLog('log-1', USER_ID)).resolves.toBeUndefined();
		});
	});

	describe('approveHourLog', () => {
		beforeEach(() => {
			// getRawLog, then the post-update context join, then the reviewer lookup.
			selectResultQueue = [
				[pendingLog()],
				[{ logId: 'log-1', userName: 'Ada', userEmail: 'ada@example.com', roleName: ROLE.name }],
				[{ name: 'Staffer' }]
			];
			updateResult = [pendingLog({ status: 'approved', minutes: 120 })];
		});

		it('marks the log approved', async () => {
			const row = await approveHourLog('log-1', STAFF_ID);
			expect(row.status).toBe('approved');
		});

		it('emits volunteer.hours_approved', async () => {
			await approveHourLog('log-1', STAFF_ID);
			await new Promise((r) => setTimeout(r, 0));
			expect(emit).toHaveBeenCalledWith(
				'volunteer.hours_approved',
				expect.objectContaining({ hours: 2, roleName: ROLE.name, reviewedByName: 'Staffer' })
			);
		});

		/**
		 * The load-bearing test for the no-credit-tie-in decision. Volunteer hours
		 * are a record, not a currency — sweat-equity-for-practice-time is a
		 * plausible future feature and a deliberate non-goal today. Without this,
		 * the next person to touch this file will wire it up.
		 */
		it('grants no practice credits', async () => {
			await approveHourLog('log-1', STAFF_ID);
			await new Promise((r) => setTimeout(r, 0));
			expect(addCredits).not.toHaveBeenCalled();
			expect(deductCredits).not.toHaveBeenCalled();
		});

		// Archiving a role while logs sit in the queue must not strand them: the
		// active-role check applies on submit, not on review.
		it('approves a log whose role was archived after submission', async () => {
			getActiveVolunteerRoleById.mockResolvedValue(null);
			const row = await approveHourLog('log-1', STAFF_ID);
			expect(row.status).toBe('approved');
		});

		it('refuses a log that was already reviewed', async () => {
			selectResultQueue = [[pendingLog({ status: 'approved' })]];
			await expect(approveHourLog('log-1', STAFF_ID)).rejects.toThrow(HourLogAlreadyReviewedError);
		});

		it('throws when the log is gone', async () => {
			selectResultQueue = [[]];
			await expect(approveHourLog('missing', STAFF_ID)).rejects.toThrow(HourLogNotFoundError);
		});

		// Warn, record, allow (#2233): a returned log is not terminal, so staff may
		// approve it over the warning, and the reason is what the audit log keeps.
		it('refuses a returned log when no reason is given', async () => {
			selectResultQueue = [[pendingLog({ status: 'rejected' })]];
			await expect(approveHourLog('log-1', STAFF_ID, undefined, { reason: '  ' })).rejects.toThrow(
				HourLogAlreadyReviewedError
			);
			expect(db.update).not.toHaveBeenCalled();
			expect(recordAuditEntry).not.toHaveBeenCalled();
		});

		it('approves a returned log over a reason and records the override', async () => {
			const workedOn = new Date('2026-03-10T19:00:00Z');
			selectResultQueue[0] = [pendingLog({ status: 'rejected', workedOn })];
			updateResult = [pendingLog({ status: 'approved', workedOn })];

			const row = await approveHourLog('log-1', STAFF_ID, undefined, {
				reason: 'Returned by mistake'
			});

			expect(row.status).toBe('approved');
			expect(recordAuditEntry).toHaveBeenCalledWith({
				action: 'volunteer_hours.approved_over_return',
				subject: { type: 'user', id: USER_ID },
				details: {
					logId: 'log-1',
					workedOn: '2026-03-10',
					minutes: 120,
					warnings: [expect.any(String)],
					reason: 'Returned by mistake'
				}
			});
		});

		it('records nothing for an ordinary approval', async () => {
			await approveHourLog('log-1', STAFF_ID, undefined, { reason: 'unneeded' });
			expect(recordAuditEntry).not.toHaveBeenCalled();
		});

		// Two staff clicking approve at once: the UPDATE re-asserts 'pending', so
		// the loser gets the conflict rather than overwriting the winner's review.
		it('reports a conflict when the row was reviewed between read and write', async () => {
			selectResultQueue = [[pendingLog()]];
			updateResult = [];
			await expect(approveHourLog('log-1', STAFF_ID)).rejects.toThrow(HourLogAlreadyReviewedError);
		});
	});

	describe('approveHourLogs', () => {
		beforeEach(() => {
			// The bulk path reads no log first — the conditional UPDATE is the check.
			// Its selects are the context join and the reviewer lookup.
			selectResultQueue = [
				[
					{ logId: 'log-1', userName: 'Ada', userEmail: 'ada@example.com', roleName: ROLE.name },
					{ logId: 'log-2', userName: 'Bo', userEmail: 'bo@example.com', roleName: ROLE.name }
				],
				[{ name: 'Staffer' }]
			];
			updateResult = [
				pendingLog({ id: 'log-1', status: 'approved', minutes: 120 }),
				pendingLog({ id: 'log-2', status: 'approved', minutes: 60 })
			];
		});

		it('approves the whole selection in one statement', async () => {
			const result = await approveHourLogs(['log-1', 'log-2'], STAFF_ID);

			expect(result).toEqual({ approved: 2, skipped: 0 });
			expect(db.update).toHaveBeenCalledTimes(1);
		});

		// A row somebody else reviewed between the page load and the click is
		// skipped by the `status = 'pending'` predicate, not a failure of the batch.
		it('counts the rows that were no longer pending as skipped', async () => {
			updateResult = [pendingLog({ id: 'log-1', status: 'approved', minutes: 120 })];

			const result = await approveHourLogs(['log-1', 'log-2'], STAFF_ID);

			expect(result).toEqual({ approved: 1, skipped: 1 });
		});

		it('notifies every member it approved', async () => {
			await approveHourLogs(['log-1', 'log-2'], STAFF_ID);
			await new Promise((r) => setTimeout(r, 0));

			expect(emit).toHaveBeenCalledTimes(2);
			expect(emit).toHaveBeenCalledWith(
				'volunteer.hours_approved',
				expect.objectContaining({ logId: 'log-2', userName: 'Bo', hours: 1 })
			);
		});

		it('writes nothing for an empty selection', async () => {
			const result = await approveHourLogs([], STAFF_ID);

			expect(result).toEqual({ approved: 0, skipped: 0 });
			expect(db.update).not.toHaveBeenCalled();
		});

		it('collapses a duplicated id rather than counting it twice', async () => {
			updateResult = [pendingLog({ id: 'log-1', status: 'approved', minutes: 120 })];

			const result = await approveHourLogs(['log-1', 'log-1'], STAFF_ID);

			expect(result).toEqual({ approved: 1, skipped: 0 });
		});

		it('refuses a selection past the cap', async () => {
			const ids = Array.from({ length: 201 }, (_, i) => `log-${i}`);

			await expect(approveHourLogs(ids, STAFF_ID)).rejects.toThrow(TooManyHourLogsError);
		});
	});

	describe('rejectHourLog', () => {
		beforeEach(() => {
			selectResultQueue = [
				[pendingLog()],
				[{ logId: 'log-1', userName: 'Ada', userEmail: 'ada@example.com', roleName: ROLE.name }],
				[{ name: 'Staffer' }]
			];
			updateResult = [pendingLog({ status: 'rejected' })];
		});

		// A rejection with no reason is unactionable — the member can't correct
		// and resubmit without one.
		it('requires a non-empty reason', async () => {
			await expect(rejectHourLog('log-1', STAFF_ID, '   ')).rejects.toThrow(HourLogValidationError);
		});

		it('rejects an over-long reason', async () => {
			await expect(rejectHourLog('log-1', STAFF_ID, 'x'.repeat(1001))).rejects.toThrow(
				HourLogValidationError
			);
		});

		it('emits volunteer.hours_rejected carrying the reason', async () => {
			await rejectHourLog('log-1', STAFF_ID, 'Looks like a duplicate');
			await new Promise((r) => setTimeout(r, 0));
			expect(emit).toHaveBeenCalledWith(
				'volunteer.hours_rejected',
				expect.objectContaining({ reviewNotes: 'Looks like a duplicate' })
			);
		});

		it('grants no practice credits either', async () => {
			await rejectHourLog('log-1', STAFF_ID, 'Duplicate');
			await new Promise((r) => setTimeout(r, 0));
			expect(addCredits).not.toHaveBeenCalled();
		});

		// Most logs count on entry, so a return has to reach an approved one.
		it('returns a log that was already approved', async () => {
			selectResultQueue[0] = [pendingLog({ status: 'approved' })];
			const row = await rejectHourLog('log-1', STAFF_ID, 'Not volunteer time');
			expect(row.status).toBe('rejected');
		});

		it('refuses a log that was already returned', async () => {
			selectResultQueue[0] = [pendingLog({ status: 'rejected' })];
			await expect(rejectHourLog('log-1', STAFF_ID, 'Again')).rejects.toThrow(
				HourLogAlreadyReviewedError
			);
		});
	});
});

// ---------------------------------------------------------------------------
// Regression — D1 bound parameter types
// ---------------------------------------------------------------------------

describe('getUserHourSummary', () => {
	// The year-start boundary is interpolated into a raw `sql` fragment. Inside a
	// raw fragment drizzle binds the JS value as-is — there is no column for it to
	// read `mode: 'timestamp'` off — so a Date reaches the driver as an object and
	// D1 rejects the statement outright:
	//   D1_TYPE_ERROR: Type 'object' not supported for value 'Thu Jan 01 2026...'
	// That 500s the whole member volunteering page, stat cards and all. The
	// boundary has to be bound as the unix seconds the column actually stores.
	it('binds the year-start boundary as a number, not a Date', async () => {
		selectResult = [
			{ approvedMinutes: 0, pendingMinutes: 0, approvedMinutesThisYear: 0, logCount: 0 }
		];

		await getUserHourSummary(USER_ID);

		// Search the calls rather than indexing: other tests in this file call
		// `select` too, and which one lands at index 0 depends on run order.
		const selection = vi
			.mocked(db.select)
			.mock.calls.map(([arg]) => arg as Record<string, SQL> | undefined)
			.find((arg) => arg && 'approvedMinutesThisYear' in arg);

		expect(selection).toBeDefined();
		const { params } = new SQLiteSyncDialect().sqlToQuery(selection!.approvedMinutesThisYear);

		expect(params).not.toHaveLength(0);
		expect(params.map((p) => typeof p)).not.toContain('object');
	});
});
