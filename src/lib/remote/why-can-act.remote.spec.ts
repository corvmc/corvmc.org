import { describe, it, expect, vi, beforeEach } from 'vitest';

/** A person's grants are theirs to see, and anyone's to a `user.read` holder (#2994). */

let caller: { id: string } | null = { id: 'me' };
let readsUsers = false;

vi.mock('#lib/server/authorization.js', async () => {
	const { error } = await import('@sveltejs/kit');
	return {
		requireUser: () => {
			if (!caller) throw error(401, 'Not authenticated');
			return caller;
		},
		requireCapability: async (cap: string) => {
			if (!caller) throw error(401, 'Not authenticated');
			if (!(readsUsers && cap === 'user.read')) throw error(403, 'Not permitted');
			return caller;
		}
	};
});

const explainAccess = vi.fn(async (_id: string) => ({
	positions: [],
	departments: [],
	shiftRoles: []
}));
vi.mock('#lib/server/access/why-can-act.js', () => ({ explainAccess }));

vi.mock('$app/server', () => ({
	query: (...args: unknown[]) => {
		const handler = args.pop() as (v: unknown) => unknown;
		const schema = args[0] as { parse: (v: unknown) => unknown } | undefined;
		const call = (v: unknown) =>
			Promise.resolve().then(() => handler(schema ? schema.parse(v) : v));
		return Object.assign(call, { __: { type: 'query' } });
	}
}));

const { getPersonAccessWhy, getMyAccessWhy } = await import('./why-can-act.remote');

beforeEach(() => {
	explainAccess.mockClear();
	caller = { id: 'me' };
	readsUsers = false;
});

describe('getPersonAccessWhy', () => {
	it('serves a member their own', async () => {
		await getPersonAccessWhy('me');
		expect(explainAccess).toHaveBeenCalledWith('me');
	});

	it("refuses a member someone else's, before reading", async () => {
		await expect(getPersonAccessWhy('other')).rejects.toMatchObject({ status: 403 });
		expect(explainAccess).not.toHaveBeenCalled();
	});

	it("serves a user.read holder anyone's", async () => {
		readsUsers = true;
		await getPersonAccessWhy('other');
		expect(explainAccess).toHaveBeenCalledWith('other');
	});

	it('refuses a signed-out caller', async () => {
		caller = null;
		await expect(getPersonAccessWhy('me')).rejects.toMatchObject({ status: 401 });
		await expect(getMyAccessWhy()).rejects.toMatchObject({ status: 401 });
		expect(explainAccess).not.toHaveBeenCalled();
	});
});
