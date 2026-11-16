import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '#lib/paraglide/messages.js';
import { addCalendarDays, clockEdges, forEachClockEdge } from '#lib/test/clock-edges.js';

/**
 * What a record's shift card shows (#2630): relation headers only when there
 * are two relations, chips only with a count, the places filled across the
 * shifts, and Add shift only for a viewer who can open one.
 */

type Related = {
	groups: { key: string; shifts: Record<string, unknown>[]; more: boolean }[];
	ended: number;
	addShift: {
		tasks: { id: string; label: string; capacity: number | null; minutes: number | null }[];
		newTask: { roleId: string | null } | null;
		roles: { id: string; name: string; capacity: number | null; minutes: number | null }[];
		startsAt?: Date | null;
	} | null;
};
let response: Related | null;
const getRelatedShifts = vi.hoisted(() => vi.fn());
const getMemberRelatedShifts = vi.hoisted(() => vi.fn());
let memberResponse: { groups: Related['groups'] };
vi.mock('#lib/remote/member-related.remote.js', () => ({ getMemberRelatedShifts }));

vi.mock('#lib/remote/tasks.remote.js', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null
	});
	return {
		getRelatedShifts,
		addRelatedShift: {
			enhance: () => ({ method: 'POST', action: '?/add' }),
			fields: {
				...Object.fromEntries(
					[
						'subjectType',
						'subjectId',
						'taskId',
						'volunteerRoleId',
						'title',
						'startsAt',
						'endsAt',
						'capacity'
					].map((n) => [n, field(n)])
				),
				allIssues: () => null
			},
			result: undefined
		}
	};
});
vi.mock('#lib/remote/volunteer.remote.js', () => ({
	confirmShiftClaims: { for: () => ({ fields: {} }) },
	claimShift: {
		for: () => ({
			enhance: () => ({ method: 'POST', action: '?/claim' }),
			fields: {
				shiftId: { as: (type: string, value?: unknown) => ({ type, name: 'shiftId', value }) },
				allIssues: () => null
			},
			result: undefined
		})
	},
	assignShiftToMember: {},
	inviteMemberToShift: {},
	getShiftCandidates: vi.fn()
}));
vi.mock('$app/navigation', () => ({
	refreshAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const RelatedShifts = (await import('./RelatedShifts.svelte')).default;

const start = new Date('2031-05-10T02:00:00Z');
const shift = (id: string, over: Record<string, unknown> = {}) => ({
	id: `wo-${id}`,
	shiftId: id,
	title: null,
	roleName: 'Door',
	eventId: null,
	eventTitle: null,
	notes: null,
	startsAt: start,
	endsAt: new Date(start.getTime() + 3 * 3_600_000),
	capacity: 2,
	claimed: 2,
	confirmed: 2,
	...over
});

const card = () => document.querySelector('[data-testid="related-shifts"]')!;
const rows = () => card().querySelectorAll('tr[data-shift]');
const groupRows = () => card().querySelectorAll('[data-testid="related-shift-group"]');
const chips = () =>
	[...card().querySelectorAll('[data-chip]')].map((c) => c.getAttribute('data-chip'));
const addShift = () => card().querySelector('[data-testid="related-add-shift"]');

beforeEach(() => {
	document.body.innerHTML = '';
	getRelatedShifts.mockReset().mockImplementation(async () => response);
	getMemberRelatedShifts.mockReset().mockImplementation(async () => memberResponse);
});

describe('RelatedShifts', () => {
	it('heads each relation when there are two, and a row per shift', async () => {
		response = {
			groups: [
				{ key: 'event', shifts: [shift('a')], more: false },
				{ key: 'show', shifts: [shift('b'), shift('c')], more: false }
			],
			ended: 0,
			addShift: null
		};
		await render(RelatedShifts, { subject: { type: 'event', id: 'e1' } });
		await vi.waitFor(() => expect(rows()).toHaveLength(3));
		expect([...groupRows()].map((r) => r.getAttribute('data-relation'))).toEqual(['event', 'show']);
	});

	it('leaves out the header for one relation, and chips with no count', async () => {
		response = {
			groups: [
				{
					key: 'project',
					shifts: [shift('a', { claimed: 1, confirmed: 0 }), shift('b')],
					more: false
				}
			],
			ended: 0,
			addShift: null
		};
		await render(RelatedShifts, { subject: { type: 'project', id: 'p1' } });
		await vi.waitFor(() => expect(rows()).toHaveLength(2));
		expect(groupRows()).toHaveLength(0);
		expect(chips()).toEqual(['claims', 'short']);
	});

	it('narrows the rows to a chip', async () => {
		response = {
			groups: [{ key: 'project', shifts: [shift('a', { confirmed: 1 }), shift('b')], more: false }],
			ended: 0,
			addShift: null
		};
		await render(RelatedShifts, { subject: { type: 'project', id: 'p1' } });
		await vi.waitFor(() => expect(rows()).toHaveLength(2));
		(card().querySelector('[data-chip="short"]') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(rows()).toHaveLength(1));
		expect(rows()[0].getAttribute('data-shift')).toBe('a');
	});

	it('counts booked places across the shifts', async () => {
		response = {
			groups: [
				{
					key: 'event',
					shifts: [shift('a', { capacity: 3, confirmed: 1 }), shift('b', { capacity: 2 })],
					more: false
				}
			],
			ended: 0,
			addShift: null
		};
		await render(RelatedShifts, { subject: { type: 'event', id: 'e1' } });
		await vi.waitFor(() => expect(rows()).toHaveLength(2));
		expect(card().querySelector('[data-testid="related-shifts-summary"]')?.textContent).toBe(
			m.staff_related_shifts_summary_text({ filled: 3, capacity: 5, shifts: 2 })
		);
	});

	it('links View all and the ended chip to Volunteering filtered to the record', async () => {
		response = { groups: [], ended: 2, addShift: null };
		await render(RelatedShifts, { subject: { type: 'group', id: 'g1' } });
		await vi.waitFor(() => expect(chips()).toEqual(['ended']));
		const hrefs = [...card().querySelectorAll('a')].map((a) => a.getAttribute('href'));
		expect(hrefs).toContain('/staff/volunteering?about=group%3Ag1&days=all');
		expect(hrefs).toContain('/staff/volunteering?about=group%3Ag1&days=all&needs=ended');
		expect(card().querySelector('[data-testid="related-shifts-summary"]')).toBeNull();
	});

	it('offers Add shift where the record has a task or can make one', async () => {
		response = {
			groups: [],
			ended: 0,
			addShift: { tasks: [], newTask: { roleId: null }, roles: [] }
		};
		await render(RelatedShifts, { subject: { type: 'group', id: 'g1' } });
		await vi.waitFor(() => expect(addShift()).not.toBeNull());
		expect(card().querySelector('table')).toBeNull();
	});

	it('offers no Add shift with nothing to put a shift on, or without the capability', async () => {
		response = { groups: [], ended: 0, addShift: { tasks: [], newTask: null, roles: [] } };
		await render(RelatedShifts, { subject: { type: 'recurring_work', id: 's1' } });
		await vi.waitFor(() => expect(getRelatedShifts).toHaveBeenCalled());
		await vi.waitFor(() => expect(card()).not.toBeNull());
		expect(addShift()).toBeNull();

		document.body.innerHTML = '';
		response = { groups: [], ended: 0, addShift: null };
		await render(RelatedShifts, { subject: { type: 'group', id: 'g1' } });
		await vi.waitFor(() => expect(card()).not.toBeNull());
		expect(addShift()).toBeNull();
	});

	// The server's start (an event's doors) is a club-time instant; the end adds
	// the role's length, so a late doors time ends on the next club day.
	const openAdd = async (startsAt: Date) => {
		response = {
			groups: [],
			ended: 0,
			addShift: {
				tasks: [{ id: 't1', label: 'Door', capacity: 2, minutes: 120 }],
				newTask: null,
				roles: [],
				startsAt
			}
		};
		await render(RelatedShifts, { subject: { type: 'event', id: 'e1' } });
		await vi.waitFor(() => expect(addShift()).not.toBeNull());
		(addShift() as HTMLElement).click();
		const input = (name: string) =>
			document.querySelector<HTMLInputElement>(`[role="dialog"] input[name="${name}"]`);
		await vi.waitFor(() => expect(input('startsAt')).not.toBeNull());
		return { start: input('startsAt')!.value, end: input('endsAt')!.value };
	};

	forEachClockEdge('starts Add shift at the time the server gives', async (edge) => {
		const { start } = await openAdd(edge.at);
		expect(start).toBe(`${edge.clubDate}T${edge.clubTime}`);
	});

	it.each(['monthEnd', 'yearEnd'] as const)(
		'ends a late start on the next club day, at %s',
		async (name) => {
			const edge = clockEdges[name];
			const { end } = await openAdd(edge.at);
			expect(end).toBe(`${addCalendarDays(edge.clubDate, 1)}T01:30`);
		}
	);

	it("prefills a new task's places from the role it is on", async () => {
		response = {
			groups: [],
			ended: 0,
			addShift: {
				tasks: [],
				newTask: { roleId: 'door' },
				roles: [
					{ id: 'bar', name: 'Bar', capacity: 2, minutes: 120 },
					{ id: 'door', name: 'Door', capacity: 5, minutes: 120 }
				]
			}
		};
		await render(RelatedShifts, { subject: { type: 'role', id: 'door' } });
		await vi.waitFor(() => expect(addShift()).not.toBeNull());
		(addShift() as HTMLElement).click();
		const capacity = () =>
			document.querySelector<HTMLInputElement>('[role="dialog"] input[name="capacity"]');
		await vi.waitFor(() => expect(capacity()?.value).toBe('5'));
		// The role is the record's, so it is not asked for again.
		expect(document.querySelector('[role="dialog"] [name="volunteerRoleId"]')).toBeNull();
	});

	it('draws nothing for a viewer who may not read shifts', async () => {
		response = null;
		await render(RelatedShifts, { subject: { type: 'group', id: 'g1' } });
		await vi.waitFor(() => expect(getRelatedShifts).toHaveBeenCalled());
		await Promise.resolve();
		expect(document.querySelector('[data-testid="related-shifts"]')).toBeNull();
	});

	describe('on a member page', () => {
		const signup = (over: Record<string, unknown> = {}) => ({
			status: null,
			id: null,
			missing: [],
			...over
		});
		const row = (id: string) => card().querySelector(`tr[data-shift="${id}"]`)!;

		it('offers Sign up where the member can take the shift, and their status where on it', async () => {
			memberResponse = {
				groups: [
					{
						key: 'event',
						shifts: [
							shift('open', { claimed: 0, confirmed: 0, signup: signup() }),
							shift('on', {
								claimed: 1,
								confirmed: 0,
								signup: signup({ status: 'claimed', id: 'su-1' })
							}),
							shift('needs', { claimed: 0, confirmed: 0, signup: signup({ missing: ['Sound'] }) }),
							shift('full', { signup: signup() })
						],
						more: false
					}
				]
			};
			await render(RelatedShifts, { subject: { type: 'event', id: 'e1' }, member: true });
			await vi.waitFor(() => expect(rows()).toHaveLength(4));
			expect(getRelatedShifts).not.toHaveBeenCalled();

			const signUp = (id: string) => row(id).querySelector('[data-testid="shift-sign-up"]');
			expect(signUp('open')).not.toBeNull();
			expect(signUp('on')).toBeNull();
			expect(signUp('needs')).toBeNull();
			expect(signUp('full')).toBeNull();
			expect(row('needs').querySelector('[data-testid="shift-needs"]')).not.toBeNull();

			// Only their own shift links, and to their sign-up; no staff page.
			const hrefs = [...card().querySelectorAll('a')].map((a) => a.getAttribute('href'));
			expect(new Set(hrefs)).toEqual(new Set(['/member/volunteer/shifts/su-1']));
			expect(card().querySelector('[data-testid="related-shift-chips"]')).toBeNull();
			expect(card().querySelector('[data-testid="find-volunteers"]')).toBeNull();
			expect(addShift()).toBeNull();
		});

		it('leaves the card off when the record has no open shifts', async () => {
			memberResponse = { groups: [] };
			await render(RelatedShifts, { subject: { type: 'group', id: 'g1' }, member: true });
			await vi.waitFor(() => expect(getMemberRelatedShifts).toHaveBeenCalled());
			await Promise.resolve();
			expect(document.querySelector('[data-testid="related-shifts"]')).toBeNull();
		});
	});
});
