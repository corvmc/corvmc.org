import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '#lib/test/locators.js';
import { formatMonthDayYear } from '#lib/utils/format.js';

/** Where the door code would show while the booker owes a fee (#2874). */

const subjectSet = vi.fn();
const field = (name: string) => ({
	as: (type: string, value?: unknown) => ({ type, name, value }),
	issues: () => null,
	value: () => undefined,
	set: name === 'subject' ? subjectSet : vi.fn()
});
const remote = {
	enhance: () => ({ method: 'POST', action: '?/start' }),
	fields: new Proxy({ allIssues: () => null } as Record<string, unknown>, {
		get: (target, key: string) => target[key] ?? field(key)
	}),
	result: undefined
};

vi.mock('#lib/remote/inbox.remote.js', () => ({
	startConversation: { for: () => remote }
}));
// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`.
vi.mock('$app/navigation', () => ({
	refreshAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const DoorCodeHeld = (await import('./DoorCodeHeld.svelte')).default;

const dueOn = new Date('2026-11-03T02:00:00Z');
const date = formatMonthDayYear(dueOn);

beforeEach(() => subjectSet.mockClear());

describe('DoorCodeHeld', () => {
	it('names the booker’s owed date and carries it into the staff compose', async () => {
		await render(DoorCodeHeld, { dueOn });
		const notice = page.getByTestId('door-code-held');
		expect(notice.element().textContent).toContain(date);
		await notice.getByRole('button').click();
		expect(subjectSet).toHaveBeenCalledWith(expect.stringContaining(date));
	});

	it('names the booker to a bandmate, without the date', async () => {
		await render(DoorCodeHeld, { dueOn: null, bookerName: 'Iris Mendel' });
		const notice = page.getByTestId('door-code-held');
		expect(notice.element().textContent).toContain('Iris Mendel');
		expect(notice.element().textContent).not.toContain(date);
		await notice.getByRole('button').click();
		expect(subjectSet).toHaveBeenCalledWith('');
	});
});
