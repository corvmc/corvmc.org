import { afterEach, describe, it, expect, vi } from 'vitest';

const captureException = vi.hoisted(() => vi.fn());
const update = vi.hoisted(() => vi.fn());

vi.mock('#lib/server/sentry.js', () => ({ captureException }));
vi.mock('$app/env/private', async () =>
	(await import('#lib/testing/env-mock.js')).envMock({
		LARAVEL_URL: 'https://laravel.test',
		MIGRATION_SECRET: 'secret'
	})
);
vi.mock('#lib/server/db/index.js', () => {
	// The account row, then its user, for each call.
	const rows = [[{ userId: 'u1' }], [{ email: 'a@example.com' }]];
	let i = 0;
	return {
		db: {
			select: () => ({ from: () => ({ where: async () => rows[i++ % 2] }) }),
			update: () => ({
				set: (values: unknown) => {
					update(values);
					return { where: async () => undefined };
				}
			})
		}
	};
});

import { verifyBcryptViaLaravel } from './auth';

/** The proxy runs only after local bcrypt has already said no. */
describe('verifyBcryptViaLaravel', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		captureException.mockClear();
		update.mockClear();
	});

	const laravelSays = (valid: boolean) =>
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ valid })))
		);

	it('treats agreement with local bcrypt as a wrong password, not an error', async () => {
		laravelSays(false);

		expect(await verifyBcryptViaLaravel('$2y$hash', 'wrong')).toBe(false);
		expect(captureException).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
	});

	it('reports local bcrypt missing a password Laravel accepts', async () => {
		laravelSays(true);

		expect(await verifyBcryptViaLaravel('$2y$hash', 'right')).toBe(true);
		expect(captureException).toHaveBeenCalledOnce();
		expect(update).toHaveBeenCalledOnce();
	});
});
