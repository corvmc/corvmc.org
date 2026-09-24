import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$app/server', () => {
	// Tagged like a real remote function, or kit's export check refuses the module.
	const tag = (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as Record<string, unknown>;
		handler.__ = { type: 'query' };
		return handler;
	};
	return { query: tag, form: tag, command: tag };
});

/** Resolves the band from the slug it is handed, as the real guard does. */
const ROLES: Record<string, string> = { 'our-band': 'admin' };
const requireGroupRole = vi.fn(async (ref: { slug?: string }, _minRole: string) => {
	if (!ROLES[ref.slug!])
		throw Object.assign(new Error('Not a member of this group'), { status: 403 });
	return { user: { id: 'user-1' }, group: { id: 'band-1', slug: ref.slug }, role: 'admin' };
});
vi.mock('$lib/server/group/group-context', () => ({
	requireGroupRole: (...a: unknown[]) => requireGroupRole(...(a as [{ slug?: string }, string]))
}));

const getById = vi.fn();
const openBandTicketSale = vi.fn();
const closeBandTicketSale = vi.fn();
vi.mock('$lib/server/event/event-service', () => ({
	getById: (...a: unknown[]) => getById(...(a as [])),
	openBandTicketSale: (...a: unknown[]) => openBandTicketSale(...(a as [])),
	closeBandTicketSale: (...a: unknown[]) => closeBandTicketSale(...(a as []))
}));

const bandSaleBlocker = vi.fn();
vi.mock('$lib/server/ticket/ticket-seller', () => ({
	bandSaleBlocker: (...a: unknown[]) => bandSaleBlocker(...(a as []))
}));
const getTicketsSold = vi.fn();
const getEventTickets = vi.fn();
const getTicketById = vi.fn();
const checkIn = vi.fn();
vi.mock('$lib/server/ticket/ticket-service', () => ({
	getTicketsSold: (...a: unknown[]) => getTicketsSold(...(a as [])),
	getEventTickets: (...a: unknown[]) => getEventTickets(...(a as [])),
	getTicketById: (...a: unknown[]) => getTicketById(...(a as [])),
	checkIn: (...a: unknown[]) => checkIn(...(a as []))
}));

const remote = (await import('./band-ticket-sale.remote')) as unknown as Record<
	string,
	(data: unknown, issue?: unknown) => Promise<unknown>
>;

const issue = new Proxy(
	{},
	{ get: (_t, name: string) => (message: string) => ({ name, message }) }
) as never;

const gig = {
	id: 'evt-1',
	groupId: 'band-1',
	source: 'band',
	status: 'published',
	ticketingEnabled: true,
	ticketPrice: 1500,
	ticketPriceFloorCents: 0,
	ticketQuantity: 100
};

const doorTickets = [
	{ id: 'tkt-1', code: 'AAA-111', attendeeName: 'Ana', attendeeEmail: 'a@x.org', status: 'valid' },
	{
		id: 'tkt-2',
		code: 'BBB-222',
		attendeeName: 'Bo',
		attendeeEmail: 'b@x.org',
		status: 'checked_in'
	},
	{ id: 'tkt-3', code: 'CCC-333', attendeeName: 'Cy', attendeeEmail: 'c@x.org', status: 'refunded' }
];

beforeEach(() => {
	vi.clearAllMocks();
	getById.mockResolvedValue(gig);
	bandSaleBlocker.mockResolvedValue(null);
	getTicketsSold.mockResolvedValue(12);
	getEventTickets.mockResolvedValue(doorTickets);
	getTicketById.mockResolvedValue({ id: 'tkt-1', eventId: 'evt-1', status: 'valid' });
	checkIn.mockResolvedValue({ alreadyIn: false, checkedInAt: new Date(0) });
});

describe('getBandTicketSale', () => {
	it('shows the band its sale: terms, what has sold, and anything in the way', async () => {
		bandSaleBlocker.mockResolvedValue('no_payouts');

		expect(await remote.getBandTicketSale({ slug: 'our-band', eventId: 'evt-1' })).toEqual({
			onSale: true,
			blocker: 'no_payouts',
			priceCents: 1500,
			priceFloorCents: 0,
			quantity: 100,
			sold: 12
		});
		expect(requireGroupRole).toHaveBeenCalledWith({ slug: 'our-band' }, 'admin');
	});

	it('404s a gig another band owns', async () => {
		getById.mockResolvedValue({ ...gig, groupId: 'band-2' });
		await expect(
			remote.getBandTicketSale({ slug: 'our-band', eventId: 'evt-1' })
		).rejects.toMatchObject({ status: 404 });
	});

	it('refuses a caller with no role on the band named', async () => {
		await expect(
			remote.getBandTicketSale({ slug: 'their-band', eventId: 'evt-1' })
		).rejects.toThrow(/not a member/i);
	});
});

describe('openBandTicketSaleForm', () => {
	it('puts the gig on sale for the band the guard resolved, in cents', async () => {
		await remote.openBandTicketSaleForm(
			{
				slug: 'our-band',
				eventId: 'evt-1',
				priceDollars: '15',
				floorDollars: '5',
				quantity: '80'
			},
			issue
		);

		expect(openBandTicketSale).toHaveBeenCalledWith('evt-1', 'band-1', {
			priceCents: 1500,
			priceFloorCents: 500,
			quantity: 80
		});
	});

	it('runs the scale to free and leaves capacity open when those are blank', async () => {
		await remote.openBandTicketSaleForm(
			{ slug: 'our-band', eventId: 'evt-1', priceDollars: '10', floorDollars: '', quantity: '' },
			issue
		);

		expect(openBandTicketSale).toHaveBeenCalledWith('evt-1', 'band-1', {
			priceCents: 1000,
			priceFloorCents: 0,
			quantity: null
		});
	});

	it('asks for a price it can read', async () => {
		await expect(
			remote.openBandTicketSaleForm(
				{ slug: 'our-band', eventId: 'evt-1', priceDollars: 'ten' },
				issue
			)
		).rejects.toBeDefined();
		expect(openBandTicketSale).not.toHaveBeenCalled();
	});
});

describe('closeBandTicketSaleForm', () => {
	it('closes the sale for the band the guard resolved', async () => {
		await remote.closeBandTicketSaleForm({ slug: 'our-band', eventId: 'evt-1' }, issue);
		expect(closeBandTicketSale).toHaveBeenCalledWith('evt-1', 'band-1');
	});
});

describe('getBandDoorList', () => {
	it("lists the band's own gig's live tickets by name and code, with a count in", async () => {
		expect(await remote.getBandDoorList({ slug: 'our-band', eventId: 'evt-1' })).toEqual({
			tickets: [
				{ id: 'tkt-1', code: 'AAA-111', attendeeName: 'Ana', status: 'valid' },
				{ id: 'tkt-2', code: 'BBB-222', attendeeName: 'Bo', status: 'checked_in' }
			],
			checkedIn: 1
		});
		expect(requireGroupRole).toHaveBeenCalledWith({ slug: 'our-band' }, 'admin');
		expect(getEventTickets).toHaveBeenCalledWith('evt-1');
	});

	it('404s a gig another band owns, without reading its tickets', async () => {
		getById.mockResolvedValue({ ...gig, groupId: 'band-2' });
		await expect(
			remote.getBandDoorList({ slug: 'our-band', eventId: 'evt-1' })
		).rejects.toMatchObject({ status: 404 });
		expect(getEventTickets).not.toHaveBeenCalled();
	});

	it('refuses a caller with no admin role on the band named', async () => {
		await expect(remote.getBandDoorList({ slug: 'their-band', eventId: 'evt-1' })).rejects.toThrow(
			/not a member/i
		);
		expect(getEventTickets).not.toHaveBeenCalled();
	});
});

describe('checkInBandTicket', () => {
	const data = { slug: 'our-band', eventId: 'evt-1', ticketId: 'tkt-1' };

	it("checks a ticket for the band's own gig in, as the caller", async () => {
		expect(await remote.checkInBandTicket(data, issue)).toMatchObject({
			success: true,
			alreadyIn: false
		});
		expect(requireGroupRole).toHaveBeenCalledWith({ slug: 'our-band' }, 'admin');
		expect(checkIn).toHaveBeenCalledWith('tkt-1', 'user-1');
	});

	it('refuses a caller with no admin role on the band named', async () => {
		await expect(remote.checkInBandTicket({ ...data, slug: 'their-band' }, issue)).rejects.toThrow(
			/not a member/i
		);
		expect(checkIn).not.toHaveBeenCalled();
	});

	it('404s a gig another band owns', async () => {
		getById.mockResolvedValue({ ...gig, groupId: 'band-2' });
		await expect(remote.checkInBandTicket(data, issue)).rejects.toMatchObject({ status: 404 });
		expect(checkIn).not.toHaveBeenCalled();
	});

	it("refuses a ticket for some other show, even with the band's own gig named", async () => {
		getTicketById.mockResolvedValue({ id: 'tkt-9', eventId: 'evt-other', status: 'valid' });
		await expect(
			remote.checkInBandTicket({ ...data, ticketId: 'tkt-9' }, issue)
		).rejects.toMatchObject({ status: 404 });
		expect(checkIn).not.toHaveBeenCalled();
	});
});
