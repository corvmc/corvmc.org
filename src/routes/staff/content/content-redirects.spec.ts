import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Content's bare row and the retired tips tab land on a view (#2765). */
let held: string[] = [];
vi.mock('#lib/server/authorization.js', () => ({
	can: async (cap: string) => held.includes(cap)
}));

const content = await import('./+page.server');
const tips = await import('../local-resources/tips/+page');

// The build wraps each load for Sentry, which reads the URL, route and request.
const at = (path: string) => {
	const url = `https://corvmc.test${path}`;
	return { url: new URL(url), params: {}, route: { id: path }, request: new Request(url) } as never;
};

const thrown = async (run: () => unknown) => {
	try {
		await run();
	} catch (err) {
		return err;
	}
};

beforeEach(() => {
	held = [];
});

describe('/staff/content', () => {
	it.each([
		[['help.read', 'localResource.manage'], '/staff/help'],
		[['localResource.manage'], '/staff/local-resources']
	])('sends a staffer holding %j to %s', async (caps, location) => {
		held = caps;
		expect(await thrown(() => content.load(at('/staff/content')))).toMatchObject({
			status: 307,
			location
		});
	});
});

describe('/staff/local-resources/tips', () => {
	it('lands on the pending filter', async () => {
		expect(await thrown(() => tips.load(at('/staff/local-resources/tips')))).toMatchObject({
			status: 308,
			location: '/staff/local-resources?status=pending'
		});
	});
});
