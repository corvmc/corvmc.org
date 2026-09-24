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

const remote = (await import('./door.remote')) as unknown as Record<
	string,
	(data?: unknown) => Promise<unknown>
>;

describe('getTerminalConnection', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('refuses anyone without finance.collect before minting a token', async () => {
		requireCapability.mockRejectedValue(Object.assign(new Error('Not permitted'), { status: 403 }));
		await expect(remote.getTerminalConnection()).rejects.toMatchObject({ status: 403 });
		expect(requireCapability).toHaveBeenCalledWith('finance.collect');
		expect(mintConnectionToken).not.toHaveBeenCalled();
	});

	it('hands a collector the token and the Location to bind to', async () => {
		requireCapability.mockResolvedValue({ id: 'staff-1' });
		const connection = { secret: 'pst_test_x', locationId: 'tml_1', simulated: true };
		mintConnectionToken.mockResolvedValue(connection);
		await expect(remote.getTerminalConnection()).resolves.toEqual(connection);
	});
});
