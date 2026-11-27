import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '#lib/server/db/test-factory.js';

// ---------------------------------------------------------------------------
// Who reaches each ticket action on the listing page (#1949). Sale terms ride
// `updateEvent` and take the show's committee (see the listing-guard spec);
// comps and cancellations stay `event.manageTickets`, which no committee seat
// can carry. A booker holds `production.book` through the show's project only.
// A guest of an act (#3274) is `event.manageGuests`, scoped to the show the credit
// or ticket is on: the event lead holds it for one show and nothing else.
// ---------------------------------------------------------------------------

type Persona = 'staff' | 'lead' | 'otherLead' | 'booker' | 'outsider';
let persona: Persona = 'staff';

const denied = () => Object.assign(new Error('403: Not permitted'), { status: 403 });
const STAFF_CAPS = ['event.read', 'event.manage', 'event.manageTickets', 'event.manageGuests'];

type Scope = { eventId?: string };
const holds = async (cap: string, scope?: () => Promise<Scope> | Scope) => {
	if (persona === 'staff') return STAFF_CAPS.includes(cap);
	if (cap !== 'event.manageGuests' || !scope) return false;
	const eventId = persona === 'lead' ? 'evt-show' : persona === 'otherLead' ? 'evt-other' : null;
	return !!eventId && (await scope()).eventId === eventId;
};

vi.mock('#lib/server/authorization.js', () => ({
	can: vi.fn(async (cap: string) => persona === 'staff' && STAFF_CAPS.includes(cap)),
	requireCapability: vi.fn(async (cap: string, scope?: () => Promise<Scope> | Scope) => {
		if (!(await holds(cap, scope))) throw denied();
		return mockUser({ id: `${persona}-1` });
	}),
	requireUser: vi.fn(() => mockUser({ id: `${persona}-1` }))
}));

vi.mock('#lib/server/capability/record-scope.js', () => ({
	eventScope: vi.fn(async (eventId: string) => ({ eventId }))
}));

const addGuest = vi.fn(async () => ({}));
const removeGuest = vi.fn(async () => undefined);
vi.mock('#lib/server/ticket/guest-service.js', () => ({
	addGuest: (...a: unknown[]) => addGuest(...(a as [])),
	removeGuest: (...a: unknown[]) => removeGuest(...(a as [])),
	listGuestsByAct: vi.fn(async () => []),
	// The show comes from the row: this credit and this ticket are on `evt-show`.
	eventOfAct: vi.fn(async (id: string) => (id === 'act-1' ? 'evt-show' : null)),
	eventOfGuest: vi.fn(async (id: string) => (id === 'guest-1' ? 'evt-show' : null))
}));

vi.mock('#lib/server/group/group-context.js', () => ({
	requireProjectCommittee: vi.fn(async (projectId: string | null, cap: string) => {
		if (persona === 'booker' && projectId === 'proj-show' && cap === 'production.book') {
			return { user: mockUser({ id: 'booker-1' }), groups: [], via: 'committee' };
		}
		throw denied();
	})
}));

vi.mock('#lib/server/production/production-scope.js', () => ({
	projectOfEvent: vi.fn(async () => ({ projectId: 'proj-show', productionId: 'prod-1' }))
}));

const createTickets = vi.fn(async () => []);
const cancelTicketService = vi.fn(async () => undefined);
const recordTicketComp = vi.fn(async () => undefined);
vi.mock('#lib/server/ticket/ticket-service.js', async (orig) => ({
	...(await orig<object>()),
	createTickets: (...a: unknown[]) => createTickets(...(a as [])),
	recordTicketComp: (...a: unknown[]) => recordTicketComp(...(a as [])),
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

const { compTickets, cancelTicket, addActGuest, removeActGuest } =
	(await import('#lib/remote/events.remote.js')) as any;

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
		// #2891: the comp is recorded under the purchase id its tickets carry.
		const [[issued]] = createTickets.mock.calls as unknown as [[{ purchaseId: string }]];
		expect(recordTicketComp).toHaveBeenCalledWith({
			eventId: 'evt-show',
			purchaseId: issued.purchaseId,
			quantity: 2,
			attendeeName: 'Guest'
		});
	});

	it("refuses the show's committee, issuing nothing", async () => {
		persona = 'booker';
		await expect(compTickets(COMP, issue)).rejects.toMatchObject({ status: 403 });
		expect(createTickets).not.toHaveBeenCalled();
		expect(recordTicketComp).not.toHaveBeenCalled();
	});

	it('refuses someone off the committee, issuing nothing', async () => {
		persona = 'outsider';
		await expect(compTickets(COMP, issue)).rejects.toMatchObject({ status: 403 });
		expect(createTickets).not.toHaveBeenCalled();
		expect(recordTicketComp).not.toHaveBeenCalled();
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

describe('guests of an act', () => {
	const GUEST = { eventBandId: 'act-1', attendeeName: 'Guest', attendeeEmail: 'g@x.org' };

	it.each(['staff', 'lead'] as const)('lets %s add and remove a guest', async (who) => {
		persona = who;
		await addActGuest(GUEST);
		expect(addGuest).toHaveBeenCalledWith({
			eventBandId: 'act-1',
			name: 'Guest',
			email: 'g@x.org'
		});
		await removeActGuest({ ticketId: 'guest-1' });
		expect(removeGuest).toHaveBeenCalledWith('guest-1');
	});

	it.each(['otherLead', 'booker', 'outsider'] as const)(
		'refuses %s, changing nothing',
		async (who) => {
			persona = who;
			await expect(addActGuest(GUEST)).rejects.toMatchObject({ status: 403 });
			await expect(removeActGuest({ ticketId: 'guest-1' })).rejects.toMatchObject({
				status: 403
			});
			expect(addGuest).not.toHaveBeenCalled();
			expect(removeGuest).not.toHaveBeenCalled();
		}
	);

	it('reads the show from the row, so an unknown credit reaches no one but staff', async () => {
		persona = 'lead';
		await expect(addActGuest({ ...GUEST, eventBandId: 'act-elsewhere' })).rejects.toMatchObject({
			status: 403
		});
		expect(addGuest).not.toHaveBeenCalled();
	});
});
