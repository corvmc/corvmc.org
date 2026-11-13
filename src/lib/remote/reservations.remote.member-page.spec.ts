import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '#lib/server/db/test-factory.js';
import { noticeFor } from '#lib/server/reservation/conflict-service.js';

// ---------------------------------------------------------------------------
// The member reservations page carries the first-booking rules (#2747) only
// while the member holds no Practice space clearance. The clearance decision
// itself is `noticeFor`'s, pinned in booking-notice.spec.ts; this pins that the
// page query passes it through for the member's own bookings.
// ---------------------------------------------------------------------------

const actingUser = mockUser({ id: 'user-1', name: 'Acting', email: 'acting@example.com' });

vi.mock('#lib/server/db/index.js', () => ({
	db: {
		select: () => {
			const c: Record<string, unknown> = {
				from: () => c,
				where: () => c,
				limit: () => Promise.resolve([{ subscription: null, phone: null }]),
				orderBy: () => Promise.resolve([])
			};
			return c;
		}
	}
}));

vi.mock('#lib/server/authorization.js', () => ({
	can: vi.fn(async () => false),
	requireCapability: vi.fn(async () => actingUser),
	requireUser: () => actingUser,
	requireCapabilityOrOwner: vi.fn(),
	primaryRoleFor: vi.fn()
}));

vi.mock('#lib/server/reservation/config.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/reservation/config.js')>()),
	getReservationConfig: vi.fn(async () => ({ hourlyRateCents: 1500 }))
}));

vi.mock('#lib/server/reservation/conflict-service.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/reservation/conflict-service.js')>()),
	noticeFor: vi.fn()
}));

vi.mock('#lib/server/instructor/instructor-service.js', () => ({
	getByUserId: vi.fn(async () => null)
}));

vi.mock('#lib/server/finance/credit-service.js', () => ({ getBalance: vi.fn(async () => 0) }));

vi.mock('#lib/server/feature-flags.js', () => ({ requireFeature: vi.fn(async () => undefined) }));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: actingUser },
		url: new URL('http://localhost/member/reservations'),
		request: { headers: new Headers() }
	}),
	form: (_schema: unknown, handler: (...args: any[]) => any) => {
		(handler as any).__ = { type: 'form' };
		(handler as any).for = () => handler;
		return handler;
	},
	query: (...args: any[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (...a: any[]) => any;
		(handler as any).__ = { type: 'query' };
		return handler;
	},
	command: (...args: any[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (...a: any[]) => any;
		(handler as any).__ = { type: 'command' };
		return handler;
	}
}));

const { getMemberReservationsPage } = (await import('#lib/remote/reservations.remote.js')) as any;

beforeEach(() => {
	vi.mocked(noticeFor).mockReset();
});

describe('getMemberReservationsPage first-booking rules', () => {
	it('carries the notice and tour for a member without the clearance', async () => {
		vi.mocked(noticeFor).mockResolvedValue({ minutes: 4320, newMember: true, tourMinutes: 30 });

		const page = await getMemberReservationsPage();

		expect(page.firstBooking).toEqual({ noticeMinutes: 4320, tourMinutes: 30 });
		expect(noticeFor).toHaveBeenCalledWith(expect.anything(), {
			userId: actingUser.id,
			bookerType: 'user'
		});
	});

	it('carries nothing for a cleared member', async () => {
		vi.mocked(noticeFor).mockResolvedValue({ minutes: 60, newMember: false, tourMinutes: 0 });

		const page = await getMemberReservationsPage();

		expect(page.firstBooking).toBeNull();
	});
});
