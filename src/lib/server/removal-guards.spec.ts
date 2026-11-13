import { describe, it, expect, vi } from 'vitest';

// A suspended or banned member has `deletedAt` set, and the session gate in
// hooks.server.ts leaves `locals.user` empty for them (hooks.server.spec.ts).
// Every remote write starts from one of these guards (scripts/remote-guard.spec.ts),
// so each must refuse a request with no user, before it reads anything.
vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: {}, url: new URL('http://x/') })
}));
const touched = vi.hoisted(() => ({ db: false }));
vi.mock('#lib/server/db/index.js', () => ({
	db: new Proxy(
		{},
		{
			get() {
				touched.db = true;
				throw new Error('a guard read the database before checking the session');
			}
		}
	)
}));

const auth = await import('./authorization');
const groups = await import('./group/group-context');
const listings = await import('./event/listing-guard');
const orgs = await import('./party/organization-guard');

const ref = { id: 'g1' } as never;

const guards: [string, () => unknown][] = [
	['requireUser', () => auth.requireUser()],
	['requireCapability', () => auth.requireCapability('user.read')],
	['requireCapabilityOrOwner', () => auth.requireCapabilityOrOwner('user.read', 'u1')],
	['requireGroupRole', () => groups.requireGroupRole(ref, 'member')],
	['requireBandRole', () => groups.requireBandRole(ref, 'member')],
	['requireProgramRole', () => groups.requireProgramRole(ref, 'member')],
	['requireApplicationReviewer', () => groups.requireApplicationReviewer(ref)],
	['requireCommitteeMember', () => groups.requireCommitteeMember('g1', 'event.manage')],
	['requireProjectCommittee', () => groups.requireProjectCommittee('p1', 'event.manage')],
	['requireListingWriter', () => listings.requireListingWriter('e1')],
	['requireListingReader', () => listings.requireListingReader('e1')],
	['requireOrganizationReader', () => orgs.requireOrganizationReader('o1')]
];

describe('a removed member is refused by every session guard', () => {
	it.each(guards)('%s answers 401', async (_name, call) => {
		touched.db = false;
		await expect((async () => call())()).rejects.toMatchObject({ status: 401 });
		expect(touched.db).toBe(false);
	});
});
