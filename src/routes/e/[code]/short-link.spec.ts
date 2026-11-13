import { describe, it, expect, vi, beforeEach } from 'vitest';

const eventIdByShortCode = vi.fn();
vi.mock('#lib/server/event/short-link.js', () => ({
	eventIdByShortCode: (...a: unknown[]) => eventIdByShortCode(...a)
}));

import { load } from './+page.server';

type Loaded = Parameters<typeof load>[0];

/** `load` never returns: it redirects or errors, so each case reads the thrown object. */
async function run(code: string) {
	try {
		await load({
			params: { code },
			locals: { user: null },
			// The Sentry vite plugin wraps every `load` and reads these off the event.
			route: { id: '/e/[code]' },
			url: new URL(`https://corvmc.org/e/${code}`),
			request: new Request(`https://corvmc.org/e/${code}`)
		} as unknown as Loaded);
	} catch (thrown) {
		return thrown as { status: number; location?: string };
	}
	throw new Error('load returned instead of redirecting');
}

beforeEach(() => eventIdByShortCode.mockReset());

describe('/e/[code]', () => {
	it('redirects to the event page', async () => {
		eventIdByShortCode.mockResolvedValue('evt-1');
		const result = await run('k7m2qx');
		expect(eventIdByShortCode).toHaveBeenCalledWith('k7m2qx');
		expect(result).toMatchObject({ status: 302, location: '/events/evt-1' });
	});

	it('answers 404 for a code nobody holds', async () => {
		eventIdByShortCode.mockResolvedValue(null);
		expect((await run('zzzzzz')).status).toBe(404);
	});
});
