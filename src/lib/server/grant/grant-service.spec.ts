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

const { grantDeadline, grantDeadlineItems, withDeadlines, getGrant, GrantNotFoundError } =
	await import('./grant-service');
const { deleteFunder, FunderInUseError } = await import('./funder-service');

const TODAY = '2026-09-23';

const base = {
	status: 'prospect' as const,
	applyBy: null,
	endsOn: null
};

const report = (dueOn: string, submittedOn: string | null = null) => ({ dueOn, submittedOn });

beforeEach(() => {
	selectResult = [];
	chainCalls = [];
});

describe('grantDeadline', () => {
	it('is the application deadline for a prospect', () => {
		expect(grantDeadline({ ...base, applyBy: '2026-10-01' }, [], TODAY)).toEqual({
			kind: 'apply',
			on: '2026-10-01',
			overdue: false
		});
	});

	it('has none while an application awaits a decision', () => {
		expect(grantDeadline({ ...base, status: 'applied', applyBy: '2026-10-01' }, [], TODAY)).toBe(
			null
		);
	});

	it('is the earliest unsubmitted report once awarded', () => {
		const awarded = { ...base, status: 'awarded' as const, endsOn: '2027-06-30' };
		const reports = [
			report('2026-08-01', '2026-07-28'),
			report('2027-01-15'),
			report('2026-12-01')
		];
		expect(grantDeadline(awarded, reports, TODAY)).toEqual({
			kind: 'report',
			on: '2026-12-01',
			overdue: false
		});
	});

	it('falls back to the award period ending when every report is in', () => {
		const awarded = { ...base, status: 'awarded' as const, endsOn: '2027-06-30' };
		expect(grantDeadline(awarded, [report('2026-08-01', '2026-08-01')], TODAY)?.kind).toBe('end');
	});

	it('keeps a missed report as the deadline, overdue', () => {
		const awarded = { ...base, status: 'awarded' as const, endsOn: '2027-06-30' };
		expect(grantDeadline(awarded, [report('2026-09-01')], TODAY)).toEqual({
			kind: 'report',
			on: '2026-09-01',
			overdue: true
		});
	});

	it('still chases an unsubmitted report after the grant is closed out', () => {
		expect(grantDeadline({ ...base, status: 'closed' }, [report('2026-09-01')], TODAY)?.kind).toBe(
			'report'
		);
		expect(grantDeadline({ ...base, status: 'closed' }, [], TODAY)).toBeNull();
		expect(grantDeadline({ ...base, status: 'declined', applyBy: '2026-10-01' }, [], TODAY)).toBe(
			null
		);
	});
});

describe('grantDeadlineItems', () => {
	const r = (id: string, dueOn: string, submittedOn: string | null = null) => ({
		id,
		title: `Report ${id}`,
		dueOn,
		submittedOn
	});

	it('names every deadline an award owes, not just the soonest', () => {
		const items = grantDeadlineItems(
			{ ...base, id: 'g1', status: 'awarded', endsOn: '2027-06-30' },
			[r('r1', '2026-12-01'), r('r2', '2027-07-15'), r('r3', '2026-10-01', '2026-09-30')]
		);
		expect(items).toEqual([
			{ kind: 'report', on: '2026-12-01', subjectId: 'report:r1', title: 'Report r1' },
			{ kind: 'report', on: '2027-07-15', subjectId: 'report:r2', title: 'Report r2' },
			{ kind: 'end', on: '2027-06-30', subjectId: 'end:g1', title: 'Award ends' }
		]);
	});

	it('keeps only outstanding reports once closed, and only apply-by for a prospect', () => {
		expect(
			grantDeadlineItems({ ...base, id: 'g1', status: 'closed', endsOn: '2026-06-30' }, [
				r('r1', '2026-10-01')
			]).map((d) => d.kind)
		).toEqual(['report']);
		expect(
			grantDeadlineItems({ ...base, id: 'g1', applyBy: '2026-11-01' }, [r('r1', '2026-10-01')])
		).toEqual([{ kind: 'apply', on: '2026-11-01', subjectId: 'apply:g1', title: 'Apply by' }]);
	});

	it('owes nothing while applied or after a refusal', () => {
		for (const status of ['applied', 'declined'] as const) {
			expect(
				grantDeadlineItems({ ...base, id: 'g1', status, applyBy: '2026-11-01' }, [
					r('r1', '2026-10-01')
				])
			).toEqual([]);
		}
	});
});

describe('withDeadlines', () => {
	const app = (id: string, over: Record<string, unknown>) => ({
		id,
		title: id,
		funderName: id,
		...base,
		...over
	});

	it('sorts by next deadline with undated rows last, attaching each its reports', () => {
		const rows = withDeadlines(
			[
				app('undated', { status: 'applied' }),
				app('later', { applyBy: '2026-12-01' }),
				app('sooner', { status: 'awarded' })
			],
			[{ grantApplicationId: 'sooner', ...report('2026-10-01') }],
			TODAY
		);
		expect(rows.map((r) => r.id)).toEqual(['sooner', 'later', 'undated']);
		expect(rows[0].deadline?.kind).toBe('report');
	});
});

describe('getGrant', () => {
	it('throws a not-found domain error for an unknown id', async () => {
		await expect(getGrant('nope', TODAY)).rejects.toBeInstanceOf(GrantNotFoundError);
	});
});

describe('deleteFunder', () => {
	it('refuses while applications still name the funder', async () => {
		selectResult = [{ n: 1 }];
		await expect(deleteFunder('f1')).rejects.toBeInstanceOf(FunderInUseError);
		expect(chainCalls.some((c) => c.method === 'returning')).toBe(false);
	});
});
