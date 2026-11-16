import { describe, expect, it } from 'vitest';
import { DEFAULT_TIMEZONE } from '#lib/config.js';
import { buildDateInTz } from '#lib/server/reservation/timezone.js';
import {
	addCalendarDays,
	clockEdgeNames,
	clockEdges,
	forEachClockEdge,
	forEachTimeZone,
	viewerTimeZones,
	withTimeZone
} from './clock-edges';

const clubParts = new Intl.DateTimeFormat('en-CA', {
	timeZone: DEFAULT_TIMEZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	hourCycle: 'h23'
});

function club(d: Date) {
	const p = Object.fromEntries(clubParts.formatToParts(d).map((x) => [x.type, x.value]));
	return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

describe('clockEdges', () => {
	it.each(clockEdgeNames)('%s states its own club date and time', (name) => {
		const e = clockEdges[name];
		expect(club(e.at)).toEqual({ date: e.clubDate, time: e.clubTime });
	});

	it('puts every edge but the control on a different UTC day or a DST changeover', () => {
		const noonUtcDay = clockEdges.noon.iso.slice(0, 10);
		expect(noonUtcDay).toBe(clockEdges.noon.clubDate);
		expect(clockEdges.pacificEveningAfterUtcMidnight.iso.slice(0, 10)).not.toBe(
			clockEdges.pacificEveningAfterUtcMidnight.clubDate
		);
		expect(clockEdges.monthEnd.iso.slice(0, 7)).not.toBe(clockEdges.monthEnd.clubDate.slice(0, 7));
		expect(clockEdges.yearEnd.iso.slice(0, 4)).not.toBe(clockEdges.yearEnd.clubDate.slice(0, 4));
	});

	it('brackets each changeover: one real hour apart, two wall-clock hours on spring forward', () => {
		const ms = (a: Date, b: Date) => b.getTime() - a.getTime();
		expect(ms(clockEdges.springForwardBefore.at, clockEdges.springForwardAfter.at)).toBe(3_600_000);
		expect(ms(clockEdges.fallBackBefore.at, clockEdges.fallBack.at)).toBe(7_200_000);
		expect(clockEdges.fallBack.clubTime).toBe('01:30');
	});

	it('hands out a fresh Date on every read', () => {
		const first = clockEdges.noon.at;
		first.setUTCFullYear(1999);
		expect(clockEdges.noon.at.toISOString()).toBe('2026-06-15T19:00:00.000Z');
	});
});

describe('withTimeZone', () => {
	it('switches the process zone and puts it back', async () => {
		const before = process.env.TZ;
		const seen = await withTimeZone('Pacific/Kiritimati', () => ({
			intl: Intl.DateTimeFormat().resolvedOptions().timeZone,
			// 19:00Z is 09:00 the next day at UTC+14.
			hour: clockEdges.noon.at.getHours()
		}));
		expect(seen).toEqual({ intl: 'Pacific/Kiritimati', hour: 9 });
		expect(process.env.TZ).toBe(before);
	});

	// @internationalized/date caches the zone it first saw; a stale cache built
	// 09:00 PDT as 09:00 in whatever zone the process had switched to.
	it('builds the same club-time instant in every zone', async () => {
		const nineAm = () => buildDateInTz('2026-06-15', '09:00', DEFAULT_TIMEZONE).toISOString();
		const seen = [nineAm()];
		for (const zone of viewerTimeZones) seen.push(await withTimeZone(zone, nineAm));
		seen.push(nineAm());
		expect(new Set(seen)).toEqual(new Set(['2026-06-15T16:00:00.000Z']));
	});

	it('restores the zone when the body throws', async () => {
		const before = process.env.TZ;
		await expect(
			withTimeZone('Pacific/Pago_Pago', () => {
				throw new Error('boom');
			})
		).rejects.toThrow('boom');
		expect(process.env.TZ).toBe(before);
	});
});

describe('forEachTimeZone', () => {
	forEachTimeZone('sets the zone it names', (zone) => {
		expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
	});
});

describe('forEachClockEdge', () => {
	forEachClockEdge(
		'fakes the system time',
		({ at }) => {
			expect(Date.now()).toBe(at.getTime());
		},
		{ fakeTimers: true }
	);

	forEachClockEdge(
		'crosses edges with zones',
		({ zone }) => {
			expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone);
		},
		{ only: ['noon'], zones: viewerTimeZones }
	);
});

describe('addCalendarDays', () => {
	it('rolls months and years without a zone', () => {
		expect(addCalendarDays('2026-02-28', 1)).toBe('2026-03-01');
		expect(addCalendarDays('2026-12-31', 7)).toBe('2027-01-07');
		expect(addCalendarDays('2026-03-08', 1)).toBe('2026-03-09');
	});
});
