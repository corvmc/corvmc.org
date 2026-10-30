import { describe, it, expect } from 'vitest';
import { reservationNeedsYouItems, type ReservationNeedingYou } from './reservation-needs-you';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-02T12:00:00Z');

function row(over: Partial<ReservationNeedingYou> = {}): ReservationNeedingYou {
	return {
		id: 'res-1',
		startsAt: new Date(now.getTime() + 2 * DAY),
		status: 'scheduled',
		paidAt: null,
		cashDueCents: null,
		bandName: null,
		coveredByFreeHours: false,
		...over
	};
}

describe('reservationNeedsYouItems', () => {
	it('asks nothing before the confirmation window opens (#2107)', () => {
		const items = reservationNeedsYouItems(
			[row({ startsAt: new Date(now.getTime() + 5 * DAY) })],
			now
		);
		expect(items).toEqual([]);
	});

	it('asks for payment inside the window, linking to the pay page', () => {
		const [item] = reservationNeedsYouItems([row()], now);
		expect(item).toMatchObject({ label: 'Pay', dueAt: row().startsAt, rank: 0 });
		expect(item.href).toContain('/member/reservations/res-1/pay');
	});

	it('asks to confirm when free hours cover it', () => {
		const [item] = reservationNeedsYouItems([row({ coveredByFreeHours: true })], now);
		expect(item).toMatchObject({ label: 'Confirm', title: 'Confirm your practice room booking' });
	});

	it('asks a confirmed booking with cash owing to pay, old-model rows included', () => {
		const owed = reservationNeedsYouItems(
			[
				row({ id: 'a', status: 'confirmed', cashDueCents: 1500 }),
				row({ id: 'b', status: 'confirmed', cashDueCents: null })
			],
			now
		);
		expect(owed.map((i) => [i.id, i.label])).toEqual([
			['reservation-unpaid:a', 'Pay'],
			['reservation-unpaid:b', 'Pay']
		]);
	});

	it('asks nothing of a settled, paid or out-of-window confirmed booking', () => {
		const items = reservationNeedsYouItems(
			[
				row({ id: 'settled', status: 'confirmed', cashDueCents: 0 }),
				row({ id: 'paid', status: 'confirmed', cashDueCents: 0, paidAt: now }),
				row({
					id: 'later',
					status: 'confirmed',
					cashDueCents: 1500,
					startsAt: new Date(now.getTime() + 6 * DAY)
				})
			],
			now
		);
		expect(items).toEqual([]);
	});

	it('names the band in a band booking', () => {
		const [item] = reservationNeedsYouItems([row({ bandName: 'The Owls' })], now);
		expect(item.detail).toMatch(/^The Owls: /);
	});
});
