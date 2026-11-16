import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCheck = vi.fn();
const mockToastInfo = vi.fn();
const mockReload = vi.fn();
let isOutdated = false;

vi.mock('$app/state', () => ({
	updated: {
		get current() {
			return isOutdated;
		},
		check: () => mockCheck()
	}
}));
vi.mock('svelte-sonner', () => ({ toast: { info: (...a: unknown[]) => mockToastInfo(...a) } }));

beforeEach(() => {
	vi.clearAllMocks();
	isOutdated = false;
	const store = new Map<string, string>();
	vi.stubGlobal('sessionStorage', {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => store.set(k, v)
	});
	vi.stubGlobal('location', { reload: mockReload });
});

const { recoverFromStaleDeploy, reloadIfStaleBuild } = await import('./stale-deploy-recovery');

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

describe('reloadIfStaleBuild', () => {
	it('reloads a tab whose build is older than the deploy (JAVASCRIPT-SVELTEKIT-4D)', () => {
		isOutdated = true;

		expect(reloadIfStaleBuild()).toBe(true);
		expect(mockReload).toHaveBeenCalledOnce();
	});

	it('leaves a tab on the current build alone', () => {
		expect(reloadIfStaleBuild()).toBe(false);
		expect(mockReload).not.toHaveBeenCalled();
	});

	it('reloads once when the reload comes back stale', () => {
		isOutdated = true;

		reloadIfStaleBuild();
		expect(reloadIfStaleBuild()).toBe(false);
		expect(mockReload).toHaveBeenCalledOnce();
	});
});
