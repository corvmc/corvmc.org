import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { toast } from 'svelte-sonner';
import '#lib/test/locators.js';
import { fakeQuery, heldRemoteForm } from '#lib/test/fake-remote.svelte.js';

/**
 * Marking a task done shows before the server answers, on the dashboard list
 * and on the task's own page, and a refusal puts it back.
 */

const task = {
	workOrderId: 'wo-1',
	title: 'Fixture task',
	eventTitle: null,
	roleName: 'Fixture role',
	dueAt: new Date('2031-05-10T19:00:00Z'),
	closesItself: false,
	checklist: { done: 0, total: 0 }
};
const dashboard = fakeQuery({
	access: {},
	interests: [],
	openShifts: [],
	unloggedShifts: [],
	unloggedTasks: [],
	assignedTasks: [task],
	roles: [],
	myShifts: [],
	invitations: []
});
const myTask = fakeQuery({
	...task,
	notes: null,
	why: null,
	resolvedAt: null as Date | null,
	items: [],
	canMarkDone: true,
	canTake: false,
	canHandBack: false
});
const markDone = heldRemoteForm();

vi.mock('$app/env/public', async () => (await import('#lib/testing/env-mock.js')).envMock({}));
vi.mock('svelte-sonner', () => ({
	toast: Object.assign(vi.fn(), { success: vi.fn(), info: vi.fn(), error: vi.fn() })
}));
vi.mock('#lib/report-error.js', () => ({ reportError: vi.fn() }));
vi.mock('$app/state', async (original) => ({
	...(await original<Record<string, unknown>>()),
	page: {
		params: { workOrderId: 'wo-1' },
		route: { id: '/member/volunteer/tasks/[workOrderId]' },
		url: new URL('http://localhost/member/volunteer/tasks/wo-1')
	}
}));
vi.mock('#lib/remote/volunteer.remote.js', () => ({
	getMemberVolunteerPage: dashboard,
	getMyTask: myTask,
	markMyTaskDone: markDone,
	takeTask: heldRemoteForm(),
	handBackTask: heldRemoteForm(),
	setMyTaskItemDone: heldRemoteForm(),
	acceptShiftInvitation: heldRemoteForm(),
	declineShiftInvitation: heldRemoteForm(),
	cancelMySignup: heldRemoteForm(),
	submitVolunteerHours: heldRemoteForm(),
	editVolunteerHours: heldRemoteForm()
}));

const Dashboard = (await import('./+page.svelte')).default;
const TaskPage = (await import('./tasks/[workOrderId]/+page.svelte')).default;

const refusal = () => Object.assign(new Error('refused'), { status: 409 });
const row = () => page.getByCss('[data-work-order-id="wo-1"]');
const submit = () => page.getByRole('dialog').getByCss('button[type="submit"]');

beforeEach(async () => {
	await markDone.settleAll();
	vi.mocked(toast.error).mockClear();
});

describe('marking a task done from the dashboard', () => {
	it('takes the task off the list while the server is answering', async () => {
		await render(Dashboard);
		await row().getByRole('button').click();
		await submit().click();

		await expect.element(row()).not.toBeInTheDocument();
		expect(markDone.held).toHaveLength(1);
	});

	it('puts the task back and says why when the server refuses', async () => {
		await render(Dashboard);
		await row().getByRole('button').click();
		await submit().click();
		await expect.element(row()).not.toBeInTheDocument();

		markDone.held[0].reject(refusal());

		await expect.element(row()).toBeVisible();
		await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
	});
});

describe('marking a task done from its page', () => {
	// The details card's status line: due, or done, by structure rather than words.
	const status = () => document.querySelector('p.font-medium')?.textContent?.trim();

	it('shows the task done while the server is answering, and back on refusal', async () => {
		await render(TaskPage);
		await expect.poll(status).toBeTruthy();
		const before = status();

		await page.getByCss('button').first().click();
		await submit().click();
		await expect.poll(status).not.toBe(before);

		markDone.held[0].reject(refusal());

		await expect.poll(status).toBe(before);
		await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
	});
});
