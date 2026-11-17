import { describe, expect, it } from 'vitest';
import { LOCK_GRACE_MINUTES, doorCodeWindow } from './door-code-window';

const startsAt = new Date('2026-07-01T18:00:00-07:00');
const endsAt = new Date('2026-07-01T20:00:00-07:00');
const at = (offsetMinutes: number, from = startsAt) =>
	new Date(from.getTime() + offsetMinutes * 60_000);

describe('doorCodeWindow', () => {
	it('opens a reservation code at the start and closes it after the grace', () => {
		const win = doorCodeWindow({ startsAt, endsAt });
		expect(win.opensAt).toEqual(startsAt);
		expect(win.closesAt).toEqual(at(LOCK_GRACE_MINUTES, endsAt));
	});

	it('opens the break-glass code the grace period before the start', () => {
		expect(doorCodeWindow({ startsAt, endsAt }, 'fallback').opensAt).toEqual(
			at(-LOCK_GRACE_MINUTES)
		);
	});

	it.each([
		[-1, 'before'],
		[0, 'open'],
		[120 + LOCK_GRACE_MINUTES, 'open'],
		[120 + LOCK_GRACE_MINUTES + 1, 'over']
	] as const)('at start %+d minutes the code is %s', (offset, phase) => {
		expect(doorCodeWindow({ startsAt, endsAt }, 'own', at(offset)).phase).toBe(phase);
	});
});
