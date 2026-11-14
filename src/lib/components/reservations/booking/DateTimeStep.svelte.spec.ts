import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { getReservationEndTimes } from '#lib/remote/reservations.remote.js';

/**
 * The shortest end the picker offers is a fact about the booker: teaching time
 * is booked by the half-hour, a rehearsal by the hour. The server owns the
 * floor (`reservations.remote.start-times.spec.ts`); this pins that the step
 * asks for the booker's ends and offers what comes back.
 */

vi.mock('#lib/remote/reservations.remote.js', () => ({
	getAvailableDates: vi.fn(async () => ({
		dates: ['2031-05-12'],
		newMemberNoticeMinutes: null,
		tourMinutes: 0
	})),
	getReservationStartTimes: vi.fn(async () => [
		{ value: '11:00', label: '11:00 AM' },
		{ value: '11:30', label: '11:30 AM' }
	]),
	getReservationEndTimes: vi.fn(async ({ bookerType }: { bookerType?: string }) =>
		bookerType === 'instructor'
			? [
					{ value: '11:30', label: '11:30 AM' },
					{ value: '12:00', label: '12:00 PM' }
				]
			: [{ value: '12:00', label: '12:00 PM' }]
	)
}));

// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`.
vi.mock('$app/navigation', () => ({
	refreshAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const Harness = (await import('./DateTimeStep.test.svelte')).default;

const field = (name: string) => ({
	as: (type: string, value?: unknown) => ({ type, name, value }),
	issues: () => null
});
const remote = {
	enhance: () => ({ method: 'POST', action: '?/book' }),
	fields: new Proxy({ allIssues: () => null } as Record<string, unknown>, {
		get: (target, key: string) => target[key] ?? field(key)
	}),
	result: undefined
};

const select = (name: string) =>
	document.querySelector<HTMLSelectElement>(`select[name="${name}"]`);
const offered = (name: string) =>
	[...(select(name)?.options ?? [])].map((o) => o.value).filter((v) => v !== '');

async function endsAfterPicking(bookerType?: 'instructor') {
	await render(Harness, { remote: remote as never, bookerType });
	await vi.waitFor(() => expect(offered('startTime')).toEqual(['11:00', '11:30']));
	await page.elementLocator(select('startTime')!).selectOptions('11:00');
	await vi.waitFor(() => expect(offered('endTime').length).toBeGreaterThan(0));
	return offered('endTime');
}

describe('DateTimeStep', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
		vi.mocked(getReservationEndTimes).mockClear();
	});

	it('offers a teaching booking the half-hour end', async () => {
		expect(await endsAfterPicking('instructor')).toEqual(['11:30', '12:00']);
		expect(getReservationEndTimes).toHaveBeenCalledWith(
			expect.objectContaining({ startTime: '11:00', bookerType: 'instructor' })
		);
	});

	it('asks for member ends when no booker is given', async () => {
		expect(await endsAfterPicking()).toEqual(['12:00']);
	});
});
