import { describe, it, expect } from 'vitest';
import { shiftNeedsYouItems, type ShiftNeedingYou } from './shift-needs-you';

const HOUR = 60 * 60 * 1000;
const now = new Date('2026-11-02T20:00:00Z');

function row(over: Partial<ShiftNeedingYou> = {}): ShiftNeedingYou {
	return {
		signupId: 'su-1',
		roleName: 'Door',
		startsAt: new Date(now.getTime() + 24 * HOUR),
		endsAt: new Date(now.getTime() + 27 * HOUR),
		status: 'confirmed',
		shiftCancelledAt: null,
		eventTitle: 'Door Night',
		...over
	};
}

describe('shiftNeedsYouItems', () => {
	it('lists a booked shift before it starts, due at its start', () => {
		const [item] = shiftNeedsYouItems([row()], now);
		expect(item).toMatchObject({ dueAt: row().startsAt });
		expect(item.href).toContain('/member/volunteer/shifts/su-1');
	});

	// The class: a member's own shift windowed on its start, so it vanished the
	// moment it began — the one time the door volunteer opens the app (#2803).
	it('keeps a shift that has started until it ends, due at its end', () => {
		const running = row({
			startsAt: new Date(now.getTime() - HOUR),
			endsAt: new Date(now.getTime() + 2 * HOUR)
		});
		const [item] = shiftNeedsYouItems([running], now);
		expect(item).toMatchObject({ id: 'volunteer-shift-soon:su-1', dueAt: running.endsAt });
		expect(item.detail).not.toEqual(row().eventTitle);
	});

	it('drops a shift once it has ended', () => {
		const ended = row({
			startsAt: new Date(now.getTime() - 3 * HOUR),
			endsAt: new Date(now.getTime() - HOUR)
		});
		expect(shiftNeedsYouItems([ended], now)).toEqual([]);
	});

	it('skips cancelled shifts and signups no longer held', () => {
		expect(shiftNeedsYouItems([row({ shiftCancelledAt: now })], now)).toEqual([]);
		expect(shiftNeedsYouItems([row({ status: 'cancelled' })], now)).toEqual([]);
	});
});
