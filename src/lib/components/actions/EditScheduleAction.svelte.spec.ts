import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '#lib/test/locators.js';
import { clubInstant, formatDayOfWeek } from '#lib/utils/format.js';

/**
 * What the editor sees before saving a new schedule: the form starts from the
 * current one, and the preview marks each new session generation would
 * waitlist or skip, and lists the old bookings that stay.
 */

const { preview } = vi.hoisted(() => ({
	preview: vi.fn(async (_args: Record<string, unknown>) => ({
		sessions: [] as { startsAt: Date; endsAt: Date; conflict: string | null }[],
		kept: [] as { id: string; startsAt: Date; endsAt: Date }[],
		removed: 0
	}))
}));

vi.mock('#lib/remote/recurring.remote.js', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null
	});
	return {
		previewSeriesSchedule: preview,
		rescheduleSeries: {
			enhance: () => ({ method: 'POST', action: '?/rescheduleSeries' }),
			fields: {
				id: field('id'),
				date: field('date'),
				startTime: field('startTime'),
				endTime: field('endTime'),
				frequency: field('frequency'),
				monthlyMode: field('monthlyMode'),
				until: field('until'),
				allIssues: () => null
			},
			result: undefined
		}
	};
});

vi.mock('$app/navigation', () => ({
	refreshAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const EditScheduleAction = (await import('./EditScheduleAction.svelte')).default;

// A Tuesday, 19:00–21:00 club time.
const series = {
	id: 'ser-1',
	frequencyLabel: 'Every 2 weeks',
	monthlyMode: null,
	startsAt: clubInstant('2026-06-16', '19:00'),
	endsAt: clubInstant('2026-06-16', '21:00'),
	until: null
};

const open = async () => {
	const { locator } = await render(EditScheduleAction, { series });
	await locator.getByRole('button').click();
	return page.getByRole('dialog');
};
const input = (name: string) =>
	document.querySelector(
		`[role="dialog"] :is([name="${name}"], [name^="${name}/"], [name="n:${name}"])`
	) as HTMLInputElement;

beforeEach(() => preview.mockClear());

describe('EditScheduleAction', () => {
	it('starts from the current schedule, on its weekday', async () => {
		await open();
		await expect.poll(() => preview.mock.calls.length).toBeGreaterThan(0);

		const args = preview.mock.calls.at(-1)![0] as Record<string, string>;
		expect(args).toMatchObject({
			id: 'ser-1',
			startTime: '19:00',
			endTime: '21:00',
			frequency: 'biweekly'
		});
		expect(formatDayOfWeek(clubInstant(args.date, '12:00'))).toBe(formatDayOfWeek(series.startsAt));
		expect(input('startTime').value).toBe('19:00');
	});

	it('marks the sessions that would be waitlisted or skipped', async () => {
		const at = (d: string) => clubInstant(d, '19:00');
		preview.mockResolvedValueOnce({
			sessions: [
				{ startsAt: at('2026-06-23'), endsAt: at('2026-06-23'), conflict: null },
				{ startsAt: at('2026-07-07'), endsAt: at('2026-07-07'), conflict: 'booked' },
				{ startsAt: at('2026-07-21'), endsAt: at('2026-07-21'), conflict: 'closed' }
			],
			kept: [],
			removed: 1
		});
		const dialog = await open();

		await expect.element(dialog.getByTestId('schedule-preview')).toBeVisible();
		const marks = [...document.querySelectorAll('[role="dialog"] li[data-conflict]')].map((li) =>
			li.getAttribute('data-conflict')
		);
		expect(marks).toEqual(['booked', 'closed']);
		expect(document.querySelector('[data-testid="kept-bookings"]')).toBeNull();
	});

	it('lists the old bookings that stay', async () => {
		preview.mockResolvedValueOnce({
			sessions: [],
			kept: [
				{
					id: 'res-paid',
					startsAt: clubInstant('2026-06-30', '19:00'),
					endsAt: clubInstant('2026-06-30', '21:00')
				}
			],
			removed: 0
		});
		const dialog = await open();

		await expect.element(dialog.getByTestId('kept-bookings')).toBeVisible();
		expect(document.querySelectorAll('[data-testid="kept-bookings"] li')).toHaveLength(1);
	});
});
