import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';
import type { Capability, Position } from '$lib/config';

// Pins who reads one committee's applications on its staff group page, against
// the real position matrix rather than a stubbed yes/no.

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: { id: 'user-1' } }, url: new URL('http://x/') }),
	query: (...args: unknown[]) => {
		const schema = (typeof args[0] === 'function' ? undefined : args[0]) as z.ZodType | undefined;
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => unknown;
		return Object.assign(
			(raw?: unknown) => Promise.resolve().then(() => handler(schema ? schema.parse(raw) : raw)),
			{ __: { type: 'query' } }
		);
	},
	form: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) =>
		Object.assign(async (raw: unknown) => handler(schema.parse(raw), {}), { __: { type: 'form' } })
}));

let heldPositions: Position[] = ['staff'];
let signedIn = true;
vi.mock('$lib/server/authorization', async () => {
	const { error } = await import('@sveltejs/kit');
	const config = await import('$lib/config');
	return {
		requireUser: () => ({ id: 'user-1' }),
		requireCapability: async (cap: Capability) => {
			if (!signedIn) throw error(401, 'Not authenticated');
			if (!heldPositions.some((p) => config.grantsCapability(config.positions[p], cap)))
				throw error(403, 'Not permitted');
			return { id: 'user-1' };
		}
	};
});

const svc = vi.hoisted(() => ({
	listForCommittee: vi.fn(),
	getByIdActive: vi.fn()
}));
vi.mock('$lib/server/group/committee-application-service', () => ({
	listForCommittee: svc.listForCommittee,
	acceptApplication: vi.fn(),
	declineApplication: vi.fn(),
	listCommittees: vi.fn(),
	listForApplicant: vi.fn(),
	listOpenByCommittee: vi.fn(),
	markContacted: vi.fn(),
	submitApplication: vi.fn(),
	withdrawApplication: vi.fn()
}));
vi.mock('$lib/server/band/band-service', () => ({ getByIdActive: svc.getByIdActive }));
vi.mock('$lib/server/group/group-context', () => ({ requireCommitteeReviewer: vi.fn() }));
vi.mock('$lib/remote/groups.remote', () => ({ getMemberGroup: vi.fn() }));

const { getCommitteeApplicationsFor } = await import('./committee-applications.remote');

const application = {
	choiceId: 'choice-1',
	status: 'submitted',
	submittedAt: new Date('2026-09-01'),
	answers: {},
	applicant: { type: 'member', id: 'u-2', title: 'Applicant' }
};

beforeEach(() => {
	heldPositions = ['staff'];
	signedIn = true;
	svc.getByIdActive.mockReset().mockResolvedValue({
		id: 'g-1',
		kind: 'committee',
		slug: 'booking'
	});
	svc.listForCommittee.mockReset().mockResolvedValue([application]);
});

describe('getCommitteeApplicationsFor', () => {
	it.each<Position>(['staff', 'volunteer_coordinator'])(
		'returns the slug and open applications to %s',
		async (position) => {
			heldPositions = [position];
			await expect(getCommitteeApplicationsFor({ groupId: 'g-1' })).resolves.toEqual({
				slug: 'booking',
				applications: [application]
			});
			expect(svc.listForCommittee).toHaveBeenCalledWith('g-1');
		}
	);

	it('403s a position without committee.reviewApplications, before reading anything', async () => {
		heldPositions = ['technology_coordinator'];
		await expect(getCommitteeApplicationsFor({ groupId: 'g-1' })).rejects.toMatchObject({
			status: 403
		});
		expect(svc.getByIdActive).not.toHaveBeenCalled();
		expect(svc.listForCommittee).not.toHaveBeenCalled();
	});

	it('401s a signed-out caller', async () => {
		signedIn = false;
		await expect(getCommitteeApplicationsFor({ groupId: 'g-1' })).rejects.toMatchObject({
			status: 401
		});
	});

	it('404s a club, so the capability cannot read sideways', async () => {
		svc.getByIdActive.mockResolvedValue({ id: 'g-1', kind: 'club', slug: 'book-club' });
		await expect(getCommitteeApplicationsFor({ groupId: 'g-1' })).rejects.toMatchObject({
			status: 404
		});
		expect(svc.listForCommittee).not.toHaveBeenCalled();
	});

	it('404s a missing or deactivated group', async () => {
		svc.getByIdActive.mockResolvedValue(null);
		await expect(getCommitteeApplicationsFor({ groupId: 'g-1' })).rejects.toMatchObject({
			status: 404
		});
	});

	it('rejects an empty group id', async () => {
		await expect(getCommitteeApplicationsFor({ groupId: '' })).rejects.toThrow();
	});
});
