import { describe, it, expect, vi, beforeEach } from 'vitest';
import { load as settings } from '../settings/+page';
import { load as audit } from '../audit/+page';
import { load as access } from '../access/+page';
import { load as bare } from './+page.server';

const { auth } = vi.hoisted(() => ({ auth: { held: [] as string[] } }));
vi.mock('#lib/server/authorization.js', async (original) => ({
	...(await original<typeof import('#lib/server/authorization.js')>()),
	...(await import('#lib/server/testing/mock-remote-guards.js')).guardsFor(() => auth.held)
}));
vi.mock('$app/server', async () =>
	(await import('#lib/server/testing/mock-remote-guards.js')).appServerMock()
);

beforeEach(() => {
	auth.held = [];
});

// The route and request are what the build's Sentry wrap around a load reads.
const run = async (load: unknown, url: string) => {
	try {
		await (load as (e: unknown) => unknown)({
			url: new URL(url),
			route: { id: '/staff/system' },
			request: new Request(url)
		});
	} catch (err) {
		return err;
	}
	return undefined;
};

/** Settings' tabs and the System rows' old addresses (#2763). */
describe('old addresses', () => {
	it.each([
		['/staff/settings', '/staff/system'],
		['/staff/settings?tab=organization', '/staff/system/organization'],
		['/staff/settings?tab=features', '/staff/system/features'],
		['/staff/settings?tab=access', '/staff/system/access'],
		['/staff/settings?tab=inbox', '/staff/inbox/channels'],
		['/staff/settings?tab=subscriptions', '/staff/members'],
		['/staff/settings?tab=pricing', '/staff/reservations/settings'],
		['/staff/settings?tab=integrations', '/staff/building-access']
	])('%s 308s to %s', async (from, location) => {
		expect(await run(settings, `http://x${from}`)).toMatchObject({ status: 308, location });
	});

	it('keeps the audit log filters', async () => {
		expect(await run(audit, 'http://x/staff/audit?action=x&page=2')).toMatchObject({
			status: 308,
			location: '/staff/system/audit?action=x&page=2'
		});
	});

	it('sends Access to its row', async () => {
		expect(await run(access, 'http://x/staff/access')).toMatchObject({
			status: 308,
			location: '/staff/system/access'
		});
	});
});

describe('the bare System address', () => {
	it.each([
		[['settings.read', 'audit.read'], '/staff/system/organization'],
		[['user.setRole'], '/staff/system/access'],
		[['audit.read'], '/staff/system/audit'],
		[[], '/staff/system/organization']
	])('holding %j opens %s', async (held, location) => {
		auth.held = held;
		expect(await run(bare, 'http://x/staff/system')).toMatchObject({ status: 307, location });
	});
});
