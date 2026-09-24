import { describe, it, expect, vi, beforeEach } from 'vitest';

// The committee cut is guarded by the committee named in the request, with
// `finance.read` as staff cover, and the service is reached only past it.

const requireCommitteeMember = vi.fn();
const getCommitteeReport = vi.fn(async () => ({ projects: [] }));

vi.mock('$lib/server/authorization', () => ({ requireCapability: vi.fn() }));
vi.mock('$lib/server/group/group-context', () => ({ requireCommitteeMember }));
vi.mock('$lib/server/report/annual-report-service', () => ({ getAnnualReport: vi.fn() }));
vi.mock('$lib/server/report/committee-report-service', () => ({ getCommitteeReport }));
vi.mock('$app/server', () => ({
	query: (_schema: unknown, handler: Record<string, unknown>) =>
		Object.assign(handler, { __: { type: 'query' } })
}));

const { getCommitteeNumbers } = (await import('./reports.remote')) as unknown as {
	getCommitteeNumbers: (input: unknown) => Promise<unknown>;
};

const GROUP = '0b9d6f6e-8a57-4c1c-9d1e-3a0b8f0f4e21';

beforeEach(() => vi.clearAllMocks());

describe('getCommitteeNumbers', () => {
	it('guards on the committee with finance.read as cover', async () => {
		requireCommitteeMember.mockResolvedValue({ role: 'member' });
		await getCommitteeNumbers({ groupId: GROUP, from: '2026-01-01', to: '' });

		expect(requireCommitteeMember).toHaveBeenCalledWith(GROUP, 'finance.read');
		expect(getCommitteeReport).toHaveBeenCalledWith(GROUP, { from: '2026-01-01', to: undefined });
	});

	it('reads nothing for someone the guard turns away', async () => {
		requireCommitteeMember.mockRejectedValue(Object.assign(new Error('no'), { status: 403 }));

		await expect(getCommitteeNumbers({ groupId: GROUP })).rejects.toThrow('no');
		expect(getCommitteeReport).not.toHaveBeenCalled();
	});
});
