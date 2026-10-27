import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';

// ---------------------------------------------------------------------------
// Who reaches each ticket action on the listing page (#1949). Sale terms ride
// `updateEvent` and take the show's committee (see the listing-guard spec);
// comps and cancellations stay `event.manageTickets`, which no committee seat
// can carry. A booker holds `production.book` through the show's project only.
// ---------------------------------------------------------------------------

type Persona = 'staff' | 'booker' | 'outsider';
let persona: Persona = 'staff';

const denied = () => Object.assign(new Error('403: Not permitted'), { status: 403 });
const STAFF_CAPS = ['event.read', 'event.manage', 'event.manageTickets'];

vi.mock('$lib/server/authorization', () => ({
	can: vi.fn(async (cap: string) => persona === 'staff' && STAFF_CAPS.includes(cap)),
	requireCapability: vi.fn(async (cap: string) => {
		if (persona !== 'staff' || !STAFF_CAPS.includes(cap)) throw denied();
		return mockUser({ id: 'staff-1' });
	}),
	requireUser: vi.fn(() => mockUser({ id: `${persona}-1` }))
}));

vi.mock('$lib/server/group/group-context', () => ({
	requireProjectCommittee: vi.fn(async (projectId: string | null, cap: string) => {
		if (persona === 'booker' && projectId === 'proj-show' && cap === 'production.book') {
			return { user: mockUser({ id: 'booker-1' }), groups: [], via: 'committee' };
		}
		throw denied();
	})
}));

vi.mock('$lib/server/production/production-scope', () => ({
	projectOfEvent: vi.fn(async () => ({ projectId: 'proj-show', productionId: 'prod-1' }))
}));

const createTickets = vi.fn(async () => []);
const cancelTicketService = vi.fn(async () => undefined);
vi.mock('$lib/server/ticket/ticket-service', async (orig) => ({
	...(await orig<object>()),
	createTickets: (...a: unknown[]) => createTickets(...(a as [])),
	cancelTicket: (...a: unknown[]) => cancelTicketService(...(a as [])),
	getTicketsRemaining: vi.fn(async () => 50)
}));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: mockUser({ id: 'staff-1' }) },
		url: new URL('http://localhost/staff/events/evt-show'),
		request: { headers: new Headers() }
	}),
	command: (_schema: unknown, handler: (...args: any[]) => any) => {
		(handler as any).__ = { type: 'command' };
		return handler;
	},
	form: (_schema: unknown, handler: (...args: any[]) => any) => {
		(handler as any).__ = { type: 'form' };
		(handler as any).for = () => handler;
		(handler as any).fields = {};
		return handler;
	},
	query: () => {
		const inert = () => ({ refresh: () => undefined });
		(inert as any).__ = { type: 'query' };
		return inert;
	}
}));

const { compTickets, cancelTicket } = (await import('$lib/remote/events.remote')) as any;

const issue = new Proxy({}, { get: () => (msg: string) => msg });
const COMP = { eventId: 'evt-show', attendeeName: 'Guest', attendeeEmail: 'g@x.org', quantity: 2 };

beforeEach(() => {
	vi.clearAllMocks();
	persona = 'staff';
});

describe('compTickets', () => {
	it('lets event.manageTickets comp a show', async () => {
		await compTickets(COMP, issue);
		expect(createTickets).toHaveBeenCalledWith(
			expect.objectContaining({ eventId: 'evt-show', quantity: 2 })
		);
	});

	it("refuses the show's committee, issuing nothing", async () => {
		persona = 'booker';
		await expect(compTickets(COMP, issue)).rejects.toMatchObject({ status: 403 });
		expect(createTickets).not.toHaveBeenCalled();
	});

	it('refuses someone off the committee, issuing nothing', async () => {
		persona = 'outsider';
		await expect(compTickets(COMP, issue)).rejects.toMatchObject({ status: 403 });
		expect(createTickets).not.toHaveBeenCalled();
	});
});

describe('cancelTicket', () => {
	it("refuses the show's committee, cancelling nothing", async () => {
		persona = 'booker';
		await expect(cancelTicket({ ticketId: 't1' })).rejects.toMatchObject({ status: 403 });
		expect(cancelTicketService).not.toHaveBeenCalled();
	});

	it('lets event.manageTickets cancel a ticket', async () => {
		await cancelTicket({ ticketId: 't1' });
		expect(cancelTicketService).toHaveBeenCalledWith('t1');
	});
});
