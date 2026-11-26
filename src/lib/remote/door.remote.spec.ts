import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$app/server', () => {
	// Tagged like a real remote function, or kit's export check refuses the module.
	const tag = (...args: unknown[]) => {
		const handler = args[args.length - 1] as Record<string, unknown>;
		handler.__ = { type: 'command' };
		return handler;
	};
	// A query is also called to refresh it from a form: `getTillCounts(id).refresh()`.
	const queryTag = (...args: unknown[]) => {
		const handler = args[args.length - 1] as (...a: unknown[]) => Promise<unknown>;
		const fn = Object.assign(
			(...a: unknown[]) => Object.assign(handler(...a), { refresh: async () => {} }),
			{
				__: { type: 'query' }
			}
		);
		return fn;
	};
	return { query: queryTag, form: tag, command: tag };
});

const requireCapability = vi.fn();
const requireUser = vi.fn(() => ({ id: 'staff-1' }));
// Staff hold finance.collect everywhere; a door volunteer only for `crewFor`.
let everywhere = true;
let crewFor: string | null = null;
const can = vi.fn(async (_cap: string, scope?: { eventId?: string }) =>
	scope?.eventId ? everywhere || scope.eventId === crewFor : everywhere
);
vi.mock('#lib/server/authorization.js', () => ({
	requireCapability: (...a: unknown[]) => requireCapability(...a),
	requireUser: () => requireUser(),
	can: (...a: [string, { eventId?: string }?]) => can(...a)
}));

const mintConnectionToken = vi.fn();
vi.mock('#lib/server/finance/terminal-service.js', () => ({
	mintConnectionToken: () => mintConnectionToken()
}));

const door = {
	listDoorEvents: vi.fn(async () => [] as { id: string }[]),
	doorSaleEventId: vi.fn(async () => 'evt-1' as string | null),
	startDoorSale: vi.fn(),
	getDoorSale: vi.fn(),
	cancelDoorSale: vi.fn(),
	fulfillDoorSale: vi.fn()
};
vi.mock('#lib/server/ticket/door-sale.js', () => door);

const gift = {
	doorDonationEventId: vi.fn(async () => null as string | null),
	startDoorDonation: vi.fn(),
	getDoorDonation: vi.fn(),
	cancelDoorDonation: vi.fn(),
	fulfillDoorDonation: vi.fn()
};
vi.mock('#lib/server/finance/door-donation.js', () => gift);

const requireProjectCommittee = vi.fn();
vi.mock('#lib/server/group/group-context.js', () => ({
	requireProjectCommittee: (...a: unknown[]) => requireProjectCommittee(...a)
}));

const scope = {
	projectOfEvent: vi.fn(
		async () =>
			({ projectId: 'proj-1', productionId: 'prod-1' }) as {
				projectId: string | null;
				productionId: string | null;
			} | null
	),
	projectOfProduction: vi.fn(async () => 'proj-1' as string | null),
	eventOfProduction: vi.fn(async () => 'evt-1' as string | null)
};
vi.mock('#lib/server/production/production-scope.js', () => scope);

const till = {
	tillSummary: vi.fn(async () => ({
		handoffs: [
			{ id: 'c-1', cashCents: 5000, byUserId: 'staff-1', byName: 'Sam', at: new Date(0) },
			{ id: 'c-2', cashCents: 2500, byUserId: 'vol-9', byName: 'Vi', at: new Date(0) }
		],
		handoffTotalCents: 7500
	}))
};
vi.mock('#lib/server/production/till-summary.js', () => till);

const counts = {
	recordHandoff: vi.fn(async () => 'c-3'),
	removeHandoff: vi.fn(async () => undefined),
	handoffOwner: vi.fn(
		async () =>
			({ productionId: 'prod-1', countedByUserId: 'staff-1' }) as {
				productionId: string;
				countedByUserId: string | null;
			} | null
	)
};
vi.mock('#lib/server/production/till-count-service.js', () => counts);

let driver = 'fake';
vi.mock('#lib/server/stripe.js', () => ({ paymentDriver: () => driver }));

const completeFakeTerminalPayment = vi.fn((id: string) => ({ id, status: 'succeeded' }));
vi.mock('#lib/server/finance/gateway/fake-gateway.js', () => ({
	completeFakeTerminalPayment: (id: string) => completeFakeTerminalPayment(id)
}));

const listBriefingsForEvents = vi.fn(
	async (_u: string, _e: string[]) =>
		[] as { eventId: string; roleName: string; articleId: string }[]
);
const listConfirmedSignupsForEvents = vi.fn(
	async (_u: string, _e: string[]) => [] as { eventId: string; signupId: string }[]
);
vi.mock('#lib/server/volunteer/volunteer-signup-service.js', () => ({
	listBriefingsForEvents: (u: string, e: string[]) => listBriefingsForEvents(u, e),
	listConfirmedSignupsForEvents: (u: string, e: string[]) => listConfirmedSignupsForEvents(u, e)
}));
const listReadableArticles = vi.fn(async (ids: readonly string[]) =>
	ids.filter((id) => id !== 'art-draft').map((id) => ({ id, title: id, slug: id, summary: null }))
);
vi.mock('#lib/server/help/help-service.js', () => ({
	resolveHelpReader: async () => ({ audience: 'member', capabilities: [] }),
	listReadableArticles: (ids: readonly string[]) => listReadableArticles(ids)
}));

const remote = (await import('./door.remote')) as unknown as Record<
	string,
	(data?: unknown) => Promise<unknown>
>;

const forbidden = () =>
	requireCapability.mockRejectedValue(Object.assign(new Error('Not permitted'), { status: 403 }));

beforeEach(() => {
	vi.clearAllMocks();
	driver = 'fake';
	everywhere = true;
	crewFor = null;
	requireCapability.mockResolvedValue({ id: 'staff-1' });
	door.listDoorEvents.mockResolvedValue([]);
	door.doorSaleEventId.mockResolvedValue('evt-1');
	gift.doorDonationEventId.mockResolvedValue(null);
	listBriefingsForEvents.mockResolvedValue([]);
	listConfirmedSignupsForEvents.mockResolvedValue([]);
	requireProjectCommittee.mockResolvedValue({ user: { id: 'staff-1' } });
	scope.projectOfEvent.mockResolvedValue({ projectId: 'proj-1', productionId: 'prod-1' });
	scope.projectOfProduction.mockResolvedValue('proj-1');
	scope.eventOfProduction.mockResolvedValue('evt-1');
	counts.handoffOwner.mockResolvedValue({ productionId: 'prod-1', countedByUserId: 'staff-1' });
});

describe('the door remotes', () => {
	it.each([
		['getTerminalConnection', 'evt-1'],
		['startDoorSale', { eventId: 'evt-1', quantity: 1, unitPriceCents: 1000 }],
		['startDoorDonation', { eventId: 'evt-1', amountCents: 2500 }]
	])('%s asks for finance.collect on the show, before touching anything', async (name, arg) => {
		forbidden();
		await expect(remote[name](arg)).rejects.toMatchObject({ status: 403 });
		expect(requireCapability).toHaveBeenCalledWith('finance.collect', { eventId: 'evt-1' });
		expect(mintConnectionToken).not.toHaveBeenCalled();
		for (const fn of [...Object.values(door), ...Object.values(gift)])
			expect(fn).not.toHaveBeenCalled();
	});

	it.each([['getDoorSale'], ['cancelDoorSale'], ['simulateDoorTap']])(
		"%s asks for finance.collect on the sale's own show, and does nothing else when refused",
		async (name) => {
			forbidden();
			await expect(remote[name]('pi_1')).rejects.toMatchObject({ status: 403 });
			expect(door.doorSaleEventId).toHaveBeenCalledWith('pi_1');
			expect(requireCapability).toHaveBeenCalledWith('finance.collect', { eventId: 'evt-1' });
			for (const fn of [door.getDoorSale, door.cancelDoorSale, door.fulfillDoorSale])
				expect(fn).not.toHaveBeenCalled();
		}
	);

	it.each([['getDoorSale'], ['cancelDoorSale'], ['simulateDoorTap']])(
		"%s asks for finance.collect on a donation's own show, and does nothing else when refused",
		async (name) => {
			door.doorSaleEventId.mockResolvedValue(null);
			gift.doorDonationEventId.mockResolvedValue('evt-2');
			forbidden();
			await expect(remote[name]('pi_g')).rejects.toMatchObject({ status: 403 });
			expect(requireCapability).toHaveBeenCalledWith('finance.collect', { eventId: 'evt-2' });
			for (const fn of [gift.getDoorDonation, gift.cancelDoorDonation, gift.fulfillDoorDonation])
				expect(fn).not.toHaveBeenCalled();
		}
	);

	it('routes a donation to the donation service, never the ticket one', async () => {
		door.doorSaleEventId.mockResolvedValue(null);
		gift.doorDonationEventId.mockResolvedValue('evt-1');
		gift.getDoorDonation.mockResolvedValue({ status: 'paid', amountCents: 2500 });
		await expect(remote.getDoorSale('pi_g')).resolves.toEqual({
			status: 'paid',
			quantity: 0,
			donationCents: 2500
		});
		await remote.cancelDoorSale('pi_g');
		await remote.simulateDoorTap('pi_g');
		expect(gift.cancelDoorDonation).toHaveBeenCalledWith('pi_g');
		expect(gift.fulfillDoorDonation).toHaveBeenCalledWith({ id: 'pi_g', status: 'succeeded' });
		for (const fn of [door.getDoorSale, door.cancelDoorSale, door.fulfillDoorSale])
			expect(fn).not.toHaveBeenCalled();
	});

	it('takes a donation as the staffer who is signed in', async () => {
		await remote.startDoorDonation({ eventId: 'evt-1', amountCents: 2500, staffUserId: 'x' });
		expect(gift.startDoorDonation).toHaveBeenCalledWith({
			eventId: 'evt-1',
			amountCents: 2500,
			staffUserId: 'staff-1'
		});
	});

	it('refuses a payment id that is no door sale, without asking the matrix', async () => {
		door.doorSaleEventId.mockResolvedValue(null);
		await expect(remote.getDoorSale('pi_x')).rejects.toMatchObject({ status: 403 });
		expect(door.getDoorSale).not.toHaveBeenCalled();
	});

	it('hands a collector the token and the Location to bind to', async () => {
		const connection = { secret: 'pst_test_x', locationId: 'tml_1', simulated: true };
		mintConnectionToken.mockResolvedValue(connection);
		await expect(remote.getTerminalConnection('evt-1')).resolves.toEqual(connection);
	});

	it('lists every door show to a holder of finance.collect', async () => {
		door.listDoorEvents.mockResolvedValue([{ id: 'evt-1' }, { id: 'evt-2' }]);
		const { events } = (await remote.getDoorEvents()) as { events: { id: string }[] };
		expect(events.map((e) => e.id)).toEqual(['evt-1', 'evt-2']);
	});

	it('lists a door volunteer only the show they are crewing', async () => {
		everywhere = false;
		crewFor = 'evt-2';
		door.listDoorEvents.mockResolvedValue([{ id: 'evt-1' }, { id: 'evt-2' }]);
		const { events } = (await remote.getDoorEvents()) as { events: { id: string }[] };
		expect(events.map((e) => e.id)).toEqual(['evt-2']);
	});

	it('refuses the door screen to a member crewing no door show', async () => {
		everywhere = false;
		door.listDoorEvents.mockResolvedValue([{ id: 'evt-1' }]);
		await expect(remote.getDoorEvents()).rejects.toMatchObject({ status: 403 });
	});

	it('sells as the staffer who is signed in, never one the client names', async () => {
		await remote.startDoorSale({
			eventId: 'evt-1',
			quantity: 2,
			unitPriceCents: 1500,
			staffUserId: 'someone-else'
		});
		expect(door.startDoorSale).toHaveBeenCalledWith({
			eventId: 'evt-1',
			quantity: 2,
			unitPriceCents: 1500,
			payment: 'card',
			staffUserId: 'staff-1'
		});
	});

	it('passes a cash sale through as cash', async () => {
		await remote.startDoorSale({ eventId: 'evt-1', quantity: 1, payment: 'cash' });
		expect(door.startDoorSale).toHaveBeenCalledWith(
			expect.objectContaining({ payment: 'cash', unitPriceCents: 0 })
		);
	});

	it('simulates a tap only under the fake driver', async () => {
		await remote.simulateDoorTap('pi_1');
		expect(door.fulfillDoorSale).toHaveBeenCalledWith({ id: 'pi_1', status: 'succeeded' });

		driver = 'stripe';
		await expect(remote.simulateDoorTap('pi_2')).rejects.toMatchObject({ status: 404 });
		expect(completeFakeTerminalPayment).toHaveBeenCalledTimes(1);
	});

	it('tells the screen whether it may simulate', async () => {
		await expect(remote.getDoorEvents()).resolves.toMatchObject({ canSimulate: true });
		driver = 'stripe';
		await expect(remote.getDoorEvents()).resolves.toMatchObject({ canSimulate: false });
	});

	it("shows the caller's role briefings for the listed shows, once each and only readable ones", async () => {
		everywhere = false;
		crewFor = 'evt-2';
		door.listDoorEvents.mockResolvedValue([{ id: 'evt-1' }, { id: 'evt-2' }]);
		listBriefingsForEvents.mockResolvedValue([
			{ eventId: 'evt-2', roleName: 'Door', articleId: 'art-door' },
			{ eventId: 'evt-2', roleName: 'Door lead', articleId: 'art-door' },
			{ eventId: 'evt-2', roleName: 'Bar', articleId: 'art-draft' }
		]);
		const { briefings } = (await remote.getDoorEvents()) as { briefings: { id: string }[] };

		expect(listBriefingsForEvents).toHaveBeenCalledWith('staff-1', ['evt-2']);
		expect(briefings.map((b) => b.id)).toEqual(['art-door']);
	});

	// The door screen links back to the list it admits people from (#2798).
	type DoorLists = { doorLists: { eventId: string; signupId: string | null }[] };

	it("points a door volunteer at their own shift's list", async () => {
		everywhere = false;
		crewFor = 'evt-2';
		door.listDoorEvents.mockResolvedValue([{ id: 'evt-1' }, { id: 'evt-2' }]);
		listConfirmedSignupsForEvents.mockResolvedValue([{ eventId: 'evt-2', signupId: 's-2' }]);
		const { doorLists } = (await remote.getDoorEvents()) as DoorLists;
		expect(doorLists).toEqual([{ eventId: 'evt-2', signupId: 's-2' }]);
	});

	it('offers no list to a volunteer without a signup on the show', async () => {
		everywhere = false;
		crewFor = 'evt-2';
		door.listDoorEvents.mockResolvedValue([{ id: 'evt-2' }]);
		const { doorLists } = (await remote.getDoorEvents()) as DoorLists;
		expect(doorLists).toEqual([]);
	});

	it('points staff at the staff list for every show', async () => {
		door.listDoorEvents.mockResolvedValue([{ id: 'evt-1' }]);
		const { doorLists } = (await remote.getDoorEvents()) as DoorLists;
		expect(doorLists).toEqual([{ eventId: 'evt-1', signupId: null }]);
	});

	describe('the till count', () => {
		it.each([
			['getTillCounts', 'evt-1'],
			['countTill', { eventId: 'evt-1', cashCents: 5000 }]
		])('%s asks for finance.collect on the show, before touching anything', async (name, arg) => {
			forbidden();
			await expect(remote[name](arg)).rejects.toMatchObject({ status: 403 });
			expect(requireCapability).toHaveBeenCalledWith('finance.collect', { eventId: 'evt-1' });
			expect(counts.recordHandoff).not.toHaveBeenCalled();
			expect(till.tillSummary).not.toHaveBeenCalled();
		});

		it('records a count as the signed-in member, whatever the form names', async () => {
			await remote.countTill({ eventId: 'evt-1', cashCents: 5000, countedByUserId: 'other' });
			expect(counts.recordHandoff).toHaveBeenCalledWith('prod-1', 'staff-1', 5000);
		});

		it('records a count when the member already counted the till (one counter only warns)', async () => {
			await remote.countTill({ eventId: 'evt-1', cashCents: 100 });
			await remote.countTill({ eventId: 'evt-1', cashCents: 200 });
			expect(counts.recordHandoff).toHaveBeenCalledTimes(2);
		});

		it('refuses a count on a show with no production', async () => {
			scope.projectOfEvent.mockResolvedValue({ projectId: null, productionId: null });
			await expect(remote.countTill({ eventId: 'evt-1', cashCents: 5000 })).rejects.toMatchObject({
				status: 404
			});
			expect(counts.recordHandoff).not.toHaveBeenCalled();
		});

		it("marks only the caller's own counts as removable", async () => {
			const result = (await remote.getTillCounts('evt-1')) as { handoffs: { own: boolean }[] };
			expect(result.handoffs.map((h) => h.own)).toEqual([true, false]);
		});

		it('has no counts to show for a show with no production', async () => {
			scope.projectOfEvent.mockResolvedValue({ projectId: null, productionId: null });
			await expect(remote.getTillCounts('evt-1')).resolves.toBeNull();
		});

		it('lets a counter remove their own count while they hold the door grant', async () => {
			await remote.removeTillCount({ countId: 'c-1' });
			expect(can).toHaveBeenCalledWith('finance.collect', { eventId: 'evt-1' });
			expect(requireProjectCommittee).not.toHaveBeenCalled();
			expect(counts.removeHandoff).toHaveBeenCalledWith('c-1');
		});

		it("refuses another volunteer's count, and asks the project for production.run", async () => {
			counts.handoffOwner.mockResolvedValue({ productionId: 'prod-1', countedByUserId: 'vol-9' });
			requireProjectCommittee.mockRejectedValue(
				Object.assign(new Error('Not on a committee'), { status: 403 })
			);
			await expect(remote.removeTillCount({ countId: 'c-2' })).rejects.toMatchObject({
				status: 403
			});
			expect(requireProjectCommittee).toHaveBeenCalledWith('proj-1', 'production.run');
			expect(counts.removeHandoff).not.toHaveBeenCalled();
		});

		it('lets production.run remove a count it did not make', async () => {
			counts.handoffOwner.mockResolvedValue({ productionId: 'prod-1', countedByUserId: 'vol-9' });
			await remote.removeTillCount({ countId: 'c-2' });
			expect(counts.removeHandoff).toHaveBeenCalledWith('c-2');
		});

		it('takes the show from the count row, never from the form', async () => {
			counts.handoffOwner.mockResolvedValue({ productionId: 'prod-1', countedByUserId: 'vol-9' });
			await remote.removeTillCount({ countId: 'c-2', eventId: 'evt-other', projectId: 'proj-x' });
			expect(scope.projectOfProduction).toHaveBeenCalledWith('prod-1');
			expect(requireProjectCommittee).toHaveBeenCalledWith('proj-1', 'production.run');
		});

		it('does nothing for a count that is gone', async () => {
			counts.handoffOwner.mockResolvedValue(null);
			await expect(remote.removeTillCount({ countId: 'c-x' })).rejects.toMatchObject({
				status: 404
			});
			expect(counts.removeHandoff).not.toHaveBeenCalled();
		});
	});
});
