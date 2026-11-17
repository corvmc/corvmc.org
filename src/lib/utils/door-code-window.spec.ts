import { describe, expect, it } from 'vitest';
import {
	EARLY_OPEN_MINUTES,
	LOCK_GRACE_MINUTES,
	bookedUntilBefore,
	doorCodeWindow
} from './door-code-window';

const startsAt = new Date('2026-07-01T18:00:00-07:00');
const endsAt = new Date('2026-07-01T20:00:00-07:00');
const at = (offsetMinutes: number, from = startsAt) =>
	new Date(from.getTime() + offsetMinutes * 60_000);

describe('doorCodeWindow', () => {
	it('opens a reservation code early for load-in and closes it after the grace', () => {
		const win = doorCodeWindow({ startsAt, endsAt });
		expect(EARLY_OPEN_MINUTES).toBe(10);
		expect(win.opensAt).toEqual(at(-EARLY_OPEN_MINUTES));
		expect(win.closesAt).toEqual(at(LOCK_GRACE_MINUTES, endsAt));
	});

	it('opens the break-glass code the grace period before the start', () => {
		expect(doorCodeWindow({ startsAt, endsAt }, 'fallback').opensAt).toEqual(
			at(-LOCK_GRACE_MINUTES)
		);
	});

	it.each([
		[-EARLY_OPEN_MINUTES - 1, 'before'],
		[-EARLY_OPEN_MINUTES, 'open'],
		[0, 'open'],
		[120 + LOCK_GRACE_MINUTES, 'open'],
		[120 + LOCK_GRACE_MINUTES + 1, 'over']
	] as const)('at start %+d minutes the code is %s', (offset, phase) => {
		expect(doorCodeWindow({ startsAt, endsAt }, 'own', at(offset)).phase).toBe(phase);
	});
});

describe('bookedUntilBefore', () => {
	const own = { id: 'own', startsAt };
	const before = (endOffset: number, id = 'other') => ({
		id,
		startsAt: at(-120),
		endsAt: at(endOffset)
	});

	it('names the end of a booking that runs into the early-open minutes', () => {
		expect(bookedUntilBefore(own, [before(-2)])).toEqual(at(-2));
	});

	it('takes the latest end when several overlap', () => {
		expect(bookedUntilBefore(own, [before(-8, 'a'), before(-3, 'b')])).toEqual(at(-3));
	});

	it.each([
		['ends as the code opens', [before(-EARLY_OPEN_MINUTES)]],
		['ends earlier', [before(-60)]],
		['is the reservation itself', [{ id: 'own', startsAt, endsAt }]],
		['starts after it', [{ id: 'later', startsAt: endsAt, endsAt: at(60, endsAt) }]],
		['is absent', []]
	])('is null when the other booking %s', (_, others) => {
		expect(bookedUntilBefore(own, others)).toBeNull();
	});
});
