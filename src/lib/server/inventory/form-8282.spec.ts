import { describe, it, expect } from 'vitest';
import { FORM_8282_DUE_DAYS, form8282Status, isWithinLookback, needsAttention } from './form-8282';

/**
 * The date arithmetic is the whole risk in this rule: an off-by-one on either
 * window turns a real filing deadline into silence. `now` is injected rather
 * than read, so every case here is deterministic.
 */

const at = (iso: string) => new Date(iso);

const gift = (acquired: string, disposed: string | null, resolved: string | null = null) => ({
	acquiredAt: at(acquired),
	wasDonated: true,
	disposedAt: disposed ? at(disposed) : null,
	resolvedAt: resolved ? at(resolved) : null
});

describe('isWithinLookback', () => {
	it('counts a disposal the day before the third anniversary', () => {
		expect(isWithinLookback(at('2023-06-01'), at('2026-05-31'))).toBe(true);
	});

	/** "Within three years" excludes the anniversary itself. */
	it('excludes the third anniversary exactly', () => {
		expect(isWithinLookback(at('2023-06-01'), at('2026-06-01'))).toBe(false);
	});

	it('excludes a disposal after the window', () => {
		expect(isWithinLookback(at('2023-06-01'), at('2026-06-02'))).toBe(false);
	});

	/**
	 * Calendar years, not `3 * 365` days. Across a leap year the day count is
	 * 1096, so a fixed-day window would move the boundary and let a reportable
	 * disposal slip out of it.
	 */
	it('is not shifted by a leap day', () => {
		// 2024 is a leap year; the third anniversary is still 2027-01-01.
		expect(isWithinLookback(at('2024-01-01'), at('2026-12-31'))).toBe(true);
		expect(isWithinLookback(at('2024-01-01'), at('2027-01-01'))).toBe(false);
	});
});

describe('form8282Status', () => {
	const NOW = at('2026-08-01');

	it('says nothing about an asset that was bought, not given', () => {
		const status = form8282Status(
			{
				acquiredAt: at('2025-01-01'),
				wasDonated: false,
				disposedAt: at('2026-01-01'),
				resolvedAt: null
			},
			NOW
		);
		expect(status.state).toBe('not_applicable');
		expect(needsAttention(status)).toBe(false);
	});

	it('says nothing about a gift still in service', () => {
		expect(form8282Status(gift('2025-01-01', null), NOW).state).toBe('not_applicable');
	});

	it('says nothing about a gift disposed of after three years', () => {
		const status = form8282Status(gift('2020-01-01', '2026-07-01'), NOW);
		expect(status.state).toBe('outside_window');
		expect(status.dueBy).toBeNull();
		expect(needsAttention(status)).toBe(false);
	});

	it('raises a gift disposed of inside the window, and dates the deadline', () => {
		const status = form8282Status(gift('2025-01-01', '2026-07-20'), NOW);
		expect(status.state).toBe('due');
		expect(needsAttention(status)).toBe(true);
		// 125 days after 2026-07-20.
		expect(status.dueBy?.toISOString().slice(0, 10)).toBe('2026-11-22');
	});

	it('counts the days left', () => {
		// Disposed today: the full window remains.
		const status = form8282Status(gift('2025-01-01', '2026-08-01'), NOW);
		expect(status.daysRemaining).toBe(FORM_8282_DUE_DAYS);
	});

	it('goes overdue once the 125 days have run out', () => {
		// Disposed well over 125 days before `now`.
		const status = form8282Status(gift('2025-01-01', '2026-01-01'), NOW);
		expect(status.state).toBe('overdue');
		expect(needsAttention(status)).toBe(true);
		expect(status.daysRemaining).toBeLessThan(0);
	});

	/** The boundary itself: still due on the last day, overdue the day after. */
	it('is due on the deadline and overdue the day after', () => {
		const disposed = '2026-04-01';
		const dueBy = form8282Status(gift('2025-01-01', disposed), NOW).dueBy!;

		expect(form8282Status(gift('2025-01-01', disposed), dueBy).state).toBe('due');
		expect(
			form8282Status(gift('2025-01-01', disposed), new Date(dueBy.getTime() + 24 * 3600 * 1000))
				.state
		).toBe('overdue');
	});

	it('stops asking once somebody has recorded what happened', () => {
		const status = form8282Status(gift('2025-01-01', '2026-01-01', '2026-02-01'), NOW);
		expect(status.state).toBe('resolved');
		expect(needsAttention(status)).toBe(false);
		// The deadline is kept even so — worth knowing what it was.
		expect(status.dueBy).not.toBeNull();
	});

	it('resolves an overdue one too, rather than nagging forever', () => {
		const status = form8282Status(gift('2025-01-01', '2025-02-01', '2026-07-01'), NOW);
		expect(needsAttention(status)).toBe(false);
	});
});
