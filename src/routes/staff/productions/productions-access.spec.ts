import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getStaffProductions } from '#lib/remote/production-list.remote.js';
import { filterNavSections, staffNavSections } from '../nav-items';

// The row hides, and the remote refuses: both on `event.read` (#3112).
const { auth } = vi.hoisted(() => ({ auth: { held: [] as string[] } }));
vi.mock('#lib/server/authorization.js', async (original) => ({
	...(await original<typeof import('#lib/server/authorization.js')>()),
	...(await import('#lib/server/testing/mock-remote-guards.js')).guardsFor(() => auth.held)
}));
vi.mock('$app/server', async () =>
	(await import('#lib/server/testing/mock-remote-guards.js')).appServerMock()
);
const list = vi.hoisted(() => vi.fn(async () => ({ rows: [], pagination: {} })));
vi.mock('#lib/server/production/production-list.js', () => ({ listProductions: list }));

beforeEach(() => {
	auth.held = [];
	list.mockClear();
});

const call = (filters: object) => (getStaffProductions as never as (f: object) => unknown)(filters);

describe('Productions', () => {
	it('offers the row to a holder of event.read', () => {
		const rows = filterNavSections(staffNavSections, ['event.read']).flatMap((s) => s.items);
		expect(rows.map((r) => r.key)).toContain('productions');
	});

	it('refuses the list without event.read', async () => {
		await expect(call({})).rejects.toMatchObject({ status: 403 });
		expect(list).not.toHaveBeenCalled();
	});

	it('lists for a holder of event.read', async () => {
		auth.held = ['event.read'];
		await expect(call({})).resolves.toMatchObject({ rows: [] });
		expect(list).toHaveBeenCalledOnce();
	});
});
