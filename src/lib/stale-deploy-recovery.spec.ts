import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCheck = vi.fn();
const mockToastInfo = vi.fn();
const mockReload = vi.fn();

vi.mock('$app/state', () => ({
	updated: {
		get current() {
			return false;
		},
		check: () => mockCheck()
	}
}));
vi.mock('svelte-sonner', () => ({ toast: { info: (...a: unknown[]) => mockToastInfo(...a) } }));

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubGlobal('location', { reload: mockReload });
});

const { recoverFromStaleDeploy } = await import('./stale-deploy-recovery');

const parseFailure = () =>
	new SyntaxError('JSON.parse: unexpected character at line 1 column 1 of the JSON data');

describe('recoverFromStaleDeploy', () => {
	it('reloads onto the new build when the deploy really did move', async () => {
		mockCheck.mockResolvedValue(true);

		await expect(recoverFromStaleDeploy(parseFailure())).resolves.toBe(true);

		expect(mockToastInfo).toHaveBeenCalledOnce();
		expect(mockReload).toHaveBeenCalledOnce();
	});

	// A malformed response from the *current* build is a real bug: hand it back to
	// the caller so it still reaches Sentry.
	it('declines when the client is already on the current version', async () => {
		mockCheck.mockResolvedValue(false);

		await expect(recoverFromStaleDeploy(parseFailure())).resolves.toBe(false);

		expect(mockReload).not.toHaveBeenCalled();
	});

	it('declines any error that is not a parse failure, without asking the server', async () => {
		await expect(recoverFromStaleDeploy(new Error('Internal Error'))).resolves.toBe(false);

		expect(mockCheck).not.toHaveBeenCalled();
		expect(mockReload).not.toHaveBeenCalled();
	});
});
