import { describe, it, expect } from 'vitest';
import { CALENDAR_HEIGHT, CALENDAR_WIDTH, layOut, renderCalendar } from './calendar';
import type { CalendarBlock } from './calendar-service';

/** How a month fits the poster, and that it rasterizes at the flyer's size. */

const events = (n: number, prefix: string) =>
	Array.from({ length: n }, (_, i) => ({
		id: `${prefix}${i}`,
		title: `${prefix} show ${i}`,
		startsAt: new Date(Date.UTC(2026, 10, 1 + (i % 28), 4))
	}));

const month = (cmc: number, sustaining: number, member: number) => [
	{ block: 'cmc' as CalendarBlock, events: events(cmc, 'c') },
	{ block: 'sustaining' as CalendarBlock, events: events(sustaining, 's') },
	{ block: 'member' as CalendarBlock, events: events(member, 'm') }
];

const rows = (cols: ReturnType<typeof layOut>['columns']) =>
	cols.flat().filter((l) => l.kind === 'row').length;

describe('layOut', () => {
	it('prints a quiet month in one column at full size', () => {
		const { columns, size } = layOut(month(3, 2, 4));
		expect(columns).toHaveLength(1);
		expect(size).toBe(34);
		expect(rows(columns)).toBe(9);
	});

	it('moves a busy month to two columns before dropping anything', () => {
		const { columns } = layOut(month(12, 12, 20));
		expect(columns).toHaveLength(2);
		expect(rows(columns)).toBe(44);
		expect(columns.flat().some((l) => l.kind === 'more')).toBe(false);
	});

	it('names what it leaves out of a month that cannot fit', () => {
		const { columns } = layOut(month(10, 10, 80));
		const more = columns.flat().find((l) => l.kind === 'more');
		expect(more).toMatchObject({ kind: 'more', block: 'member' });
		expect(rows(columns) + (more as { count: number }).count).toBe(100);
	});

	it('skips a block with no listings', () => {
		const { columns } = layOut(month(2, 0, 1));
		expect(columns.flat().filter((l) => l.kind === 'head')).toEqual([
			{ kind: 'head', block: 'cmc' },
			{ kind: 'head', block: 'member' }
		]);
	});
});

describe('renderCalendar', () => {
	it('renders a portrait PNG with sponsors', async () => {
		const png = await renderCalendar({
			month: '2026-11',
			blocks: month(4, 3, 30),
			sponsors: [{ name: 'Acme Audio', src: null }]
		});
		const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
		expect(view.getUint32(0)).toBe(0x89504e47);
		expect([view.getUint32(16), view.getUint32(20)]).toEqual([CALENDAR_WIDTH, CALENDAR_HEIGHT]);
	});
});
