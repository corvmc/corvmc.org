import { describe, it, expect, vi, beforeEach } from 'vitest';

// A chainable proxy that records calls and resolves to `selectResult`, so the
// assertions are about the query built rather than what a stub returns.
let selectResult: unknown[] = [];
let chainCalls: { method: string; args: unknown[] }[] = [];

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(selectResult);
			}
			return (...args: unknown[]) => {
				chainCalls.push({ method: String(prop), args });
				return proxy;
			};
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chainable()),
		insert: vi.fn(() => chainable()),
		update: vi.fn(() => chainable()),
		delete: vi.fn(() => chainable())
	}
}));

const { nextDeadline, listAgreements, getAgreement, AgreementNotFoundError } =
	await import('./agreement-service');

const TODAY = '2026-09-23';

const base = {
	status: 'prospect' as const,
	applyBy: null,
	endsOn: null,
	reportDueOn: null
};

beforeEach(() => {
	selectResult = [];
	chainCalls = [];
});

describe('nextDeadline', () => {
	it('is the application deadline for a prospect', () => {
		expect(nextDeadline({ ...base, applyBy: '2026-10-01' }, TODAY)).toEqual({
			kind: 'apply',
			on: '2026-10-01',
			overdue: false
		});
	});

	it('flags a missed application deadline as overdue', () => {
		expect(nextDeadline({ ...base, applyBy: '2026-09-22' }, TODAY)?.overdue).toBe(true);
	});

	it('treats today as not yet overdue', () => {
		expect(nextDeadline({ ...base, applyBy: TODAY }, TODAY)?.overdue).toBe(false);
	});

	it('has none while an application awaits a decision', () => {
		expect(nextDeadline({ ...base, status: 'applied', applyBy: '2026-10-01' }, TODAY)).toBeNull();
	});

	it('is the earlier of the report and the end for an active agreement', () => {
		const active = { ...base, status: 'active' as const, endsOn: '2027-01-01' };
		expect(nextDeadline({ ...active, reportDueOn: '2026-11-01' }, TODAY)?.kind).toBe('report');
		expect(nextDeadline({ ...active, reportDueOn: '2027-06-01' }, TODAY)?.kind).toBe('end');
		expect(nextDeadline(active, TODAY)?.kind).toBe('end');
	});

	it('keeps a missed report as the deadline, overdue', () => {
		const d = nextDeadline(
			{ ...base, status: 'active', reportDueOn: '2026-09-01', endsOn: '2027-01-01' },
			TODAY
		);
		expect(d).toEqual({ kind: 'report', on: '2026-09-01', overdue: true });
	});

	it('has none once declined or ended', () => {
		for (const status of ['declined', 'ended'] as const) {
			expect(nextDeadline({ ...base, status, applyBy: '2026-10-01' }, TODAY)).toBeNull();
		}
	});
});

describe('listAgreements', () => {
	const row = (id: string, over: Record<string, unknown>) => ({
		id,
		kind: 'grant',
		counterparty: id,
		title: id,
		amountCents: null,
		tier: null,
		startsOn: null,
		...base,
		...over
	});

	it('sorts by next deadline, undated rows last', async () => {
		selectResult = [
			row('undated', { status: 'applied' }),
			row('later', { applyBy: '2026-12-01' }),
			row('sooner', { status: 'active', reportDueOn: '2026-10-01' })
		];
		const rows = await listAgreements({ today: TODAY });
		expect(rows.map((r) => r.id)).toEqual(['sooner', 'later', 'undated']);
		expect(rows[0].deadline?.kind).toBe('report');
	});

	it('filters to open agreements unless asked for closed ones', async () => {
		await listAgreements({ today: TODAY });
		expect(chainCalls.some((c) => c.method === 'where')).toBe(true);

		chainCalls = [];
		await listAgreements({ today: TODAY, includeClosed: true });
		expect(chainCalls.some((c) => c.method === 'where')).toBe(false);
	});
});

describe('getAgreement', () => {
	it('throws a not-found domain error for an unknown id', async () => {
		selectResult = [];
		await expect(getAgreement('nope')).rejects.toBeInstanceOf(AgreementNotFoundError);
	});
});
