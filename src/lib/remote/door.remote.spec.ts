import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$app/server', () => {
	// Tagged like a real remote function, or kit's export check refuses the module.
	const tag = (...args: unknown[]) => {
		const handler = args[args.length - 1] as Record<string, unknown>;
		handler.__ = { type: 'command' };
		return handler;
	};
	return { query: tag, form: tag, command: tag };
});

const requireCapability = vi.fn();
const requireUser = vi.fn(() => ({ id: 'staff-1' }));
// Staff hold finance.collect everywhere; a door volunteer only for `crewFor`.
let everywhere = true;
let crewFor: string | null = null;
const can = vi.fn(async (_cap: string, scope?: { eventId?: string }) =>
	scope?.eventId ? everywhere || scope.eventId === crewFor : everywhere
);
vi.mock('$lib/server/authorization', () => ({
	requireCapability: (...a: unknown[]) => requireCapability(...a),
	requireUser: () => requireUser(),
	can: (...a: [string, { eventId?: string }?]) => can(...a)
}));

const mintConnectionToken = vi.fn();
vi.mock('$lib/server/finance/terminal-service', () => ({
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
vi.mock('$lib/server/ticket/door-sale', () => door);

let driver = 'fake';
vi.mock('$lib/server/stripe', () => ({ paymentDriver: () => driver }));

const completeFakeTerminalPayment = vi.fn((id: string) => ({ id, status: 'succeeded' }));
vi.mock('$lib/server/finance/gateway/fake-gateway', () => ({
	completeFakeTerminalPayment: (id: string) => completeFakeTerminalPayment(id)
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
});

describe('the door remotes', () => {
	it.each([
		['getTerminalConnection', 'evt-1'],
		['startDoorSale', { eventId: 'evt-1', quantity: 1, unitPriceCents: 1000 }]
	])('%s asks for finance.collect on the show, before touching anything', async (name, arg) => {
		forbidden();
		await expect(remote[name](arg)).rejects.toMatchObject({ status: 403 });
		expect(requireCapability).toHaveBeenCalledWith('finance.collect', { eventId: 'evt-1' });
		expect(mintConnectionToken).not.toHaveBeenCalled();
		for (const fn of Object.values(door)) expect(fn).not.toHaveBeenCalled();
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
			staffUserId: 'staff-1'
		});
	});

	it('simulates a tap only under the fake driver', async () => {
		await remote.simulateDoorTap('pi_1');
		expect(door.fulfillDoorSale).toHaveBeenCalledWith({ id: 'pi_1', status: 'succeeded' });

		driver = 'stripe';
		await expect(remote.simulateDoorTap('pi_2')).rejects.toMatchObject({ status: 404 });
		expect(completeFakeTerminalPayment).toHaveBeenCalledTimes(1);
	});

	it('tells the screen whether it may simulate', async () => {
		await expect(remote.getDoorEvents()).resolves.toEqual({ events: [], canSimulate: true });
		driver = 'stripe';
		await expect(remote.getDoorEvents()).resolves.toEqual({ events: [], canSimulate: false });
	});
});
