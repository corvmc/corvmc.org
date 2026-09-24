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
vi.mock('$lib/server/authorization', () => ({
	requireCapability: (...a: unknown[]) => requireCapability(...a)
}));

const mintConnectionToken = vi.fn();
vi.mock('$lib/server/finance/terminal-service', () => ({
	mintConnectionToken: () => mintConnectionToken()
}));

const door = {
	listDoorEvents: vi.fn(async () => []),
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
	requireCapability.mockResolvedValue({ id: 'staff-1' });
});

describe('the door remotes', () => {
	it.each([
		['getTerminalConnection', undefined],
		['getDoorEvents', undefined],
		['startDoorSale', { eventId: 'evt-1', quantity: 1, unitPriceCents: 1000 }],
		['getDoorSale', 'pi_1'],
		['cancelDoorSale', 'pi_1'],
		['simulateDoorTap', 'pi_1']
	])('%s refuses anyone without finance.collect, before touching anything', async (name, arg) => {
		forbidden();
		await expect(remote[name](arg)).rejects.toMatchObject({ status: 403 });
		expect(requireCapability).toHaveBeenCalledWith('finance.collect');
		expect(mintConnectionToken).not.toHaveBeenCalled();
		for (const fn of Object.values(door)) expect(fn).not.toHaveBeenCalled();
	});

	it('hands a collector the token and the Location to bind to', async () => {
		const connection = { secret: 'pst_test_x', locationId: 'tml_1', simulated: true };
		mintConnectionToken.mockResolvedValue(connection);
		await expect(remote.getTerminalConnection()).resolves.toEqual(connection);
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
