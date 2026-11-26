import { describe, expect } from 'vitest';
import { forEachClockEdge, viewerTimeZones } from '#lib/test/clock-edges.js';
import { addIsoDays } from '#lib/utils/deadline.js';
import { formatDateInTz, formatTimeInTz } from '#lib/server/reservation/timezone.js';
import { DEFAULT_TIMEZONE } from '#lib/config.js';
import { showClockTime } from './show-clock';

const clubDate = (d: Date) => formatDateInTz(d, DEFAULT_TIMEZONE);
const clubTime = (d: Date) => formatTimeInTz(d, DEFAULT_TIMEZONE);

describe('showClockTime', () => {
	forEachClockEdge(
		'puts an evening time on the show date',
		(edge) => {
			const at = showClockTime(edge.at, '20:15');
			expect(clubDate(at)).toBe(edge.clubDate);
			expect(clubTime(at)).toBe('20:15');
		},
		{ zones: viewerTimeZones }
	);

	forEachClockEdge(
		'puts a time before 06:00 on the day after the show date',
		(edge) => {
			const at = showClockTime(edge.at, '00:30');
			expect(clubDate(at)).toBe(addIsoDays(edge.clubDate, 1));
			expect(clubTime(at)).toBe('00:30');
		},
		{ zones: viewerTimeZones }
	);
});
