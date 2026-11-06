import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick, type Component } from 'svelte';
import OuterBoundary from '#lib/components/ui/OuterBoundary.test.svelte';
import BookingPolicy from '#lib/components/reservations/BookingPolicy.svelte';
import VolunteerBlocked from './member/volunteer/blocked/+page.svelte';
import CommitteeNumbers from './member/groups/[slug]/CommitteeNumbers.svelte';
import PublicInstructors from './(public)/directory/instructors/+page.svelte';
import ProjectTemplates from './staff/projects/templates/+page.svelte';
import RoleShiftsCard from './staff/volunteer/roles/[id]/RoleShiftsCard.svelte';
import InboxIndex from './staff/inbox/+page.svelte';
import Daily from './staff/inbox/daily/+page.svelte';
import { session } from './staff/inbox/daily/session.svelte';

// A query that refuses, shaped like a remote: thenable, with `refresh`.
const refused = vi.hoisted(() => () => {
	const rejection = Promise.reject(new Error('Not permitted'));
	rejection.catch(() => {});
	return Object.assign(rejection, { refresh: () => Promise.resolve() });
});

vi.mock('#lib/remote/volunteer.remote.js', () => ({
	getVolunteerBlockedNotice: refused,
	getShifts: refused,
	createShift: {}
}));
vi.mock('#lib/remote/reports.remote.js', () => ({ getCommitteeNumbers: refused }));
vi.mock('#lib/remote/instructors.remote.js', () => ({ getPublicInstructors: refused }));
vi.mock('#lib/remote/duty-lists.remote.js', () => ({ getDutyLists: refused, createDutyList: {} }));
vi.mock('#lib/remote/reservations.remote.js', () => ({ getReservationPolicy: refused }));
vi.mock('#lib/remote/inbox.remote.js', () => ({
	getInboxThreads: refused,
	getInboxThread: refused,
	getInboxThreadCounts: refused,
	getInboxDailyScope: () => Promise.resolve({ threadIds: ['a', 'b'] })
}));
vi.mock('#lib/remote/layout.remote.js', () => ({
	getStaffLayout: () => Promise.resolve({ capabilities: [] })
}));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), replaceState: vi.fn() }));

const rejections: unknown[] = [];
const record = (e: PromiseRejectionEvent) => {
	e.preventDefault();
	rejections.push(e.reason);
};

beforeEach(() => {
	rejections.length = 0;
	window.addEventListener('unhandledrejection', record);
});
afterEach(() => {
	window.removeEventListener('unhandledrejection', record);
	session.end();
});

function mount(page: unknown, innerProps: Record<string, unknown> = {}) {
	const inner = page as Component<Record<string, unknown>>;
	return render(OuterBoundary, { inner, innerProps });
}

// A block renders on Svelte's flush, and a rethrow is reported once microtasks drain, so
// after a flush and a task it has been reported. Vitest also fails the run on one that is not.
const drained = async () => {
	await tick();
	await new Promise((settle) => setTimeout(settle));
};

const role = { id: 'r', name: 'Sound', isActive: false, defaultCapacity: 1 };
const shiftsProps = { role: { ...role, defaultDurationMinutes: 60 }, from: '2026-01-01' };

describe('a block whose query fails', () => {
	// Nothing else on the page is worth keeping, so the failure belongs to the panel.
	it.each([
		['volunteer sign-up notice', VolunteerBlocked],
		['project templates', ProjectTemplates]
	])('%s reaches the panel boundary', async (_name, page) => {
		const { container } = await mount(page);

		await vi.waitFor(() => expect(container.querySelector('[data-outer-failed]')).not.toBeNull());
		await drained();
		expect(rejections).toEqual([]);
	});

	// The rest of the page still works, so the failure stays where it happened.
	it.each([
		['committee numbers', CommitteeNumbers, { groupId: 'g' }],
		['public teachers', PublicInstructors, {}],
		['booking policy', BookingPolicy, {}],
		['role shifts', RoleShiftsCard, shiftsProps]
	])('%s says so in place', async (_name, page, props) => {
		const { container } = await mount(page, props);

		await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
		expect(container.querySelector('[data-outer-failed]')).toBeNull();
		await drained();
		expect(rejections).toEqual([]);
	});

	it('leaves the empty inbox pane blank, with nothing unhandled', async () => {
		const { container } = await mount(InboxIndex);

		await drained();
		expect(container.querySelector('[role="alert"]')).toBeNull();
		expect(rejections).toEqual([]);
	});

	it('lets a Daily session move past a thread that will not load', async () => {
		const { container } = await mount(Daily);
		session.start({ threadIds: ['a', 'b'] } as Parameters<typeof session.start>[0]);

		await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
		const buttons = container.querySelectorAll('button');
		buttons[buttons.length - 1].click();
		await vi.waitFor(() => expect(session.currentId).toBe('b'));
	});
});
