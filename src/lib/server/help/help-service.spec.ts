import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Regression: help access is a visibility ladder, not a ranking of role names.
//
// The implementation this replaced scored role names against a closed
// ROLE_LEVEL table and fell back to `?? 4` — narrower than `member` — for any
// name it had never heard of. So the instant a named position exists
// (docs/specs/admin-vs-staff-spec.md), its holder resolves to `member` and the
// entire Staff Guide disappears for them. Latent today because only `admin`
// and `staff` are assigned; certain on the day the first `treasurer` row is
// inserted, which is why this ships before any position exists.
//
// The fix is that the elevated test is open-ended BY EXCLUSION: a role name
// nobody has heard of widens access instead of erasing it.
// ---------------------------------------------------------------------------

vi.mock('$lib/server/db', () => ({ db: {} }));

const getUserRoles = vi.fn<(userId: string) => Promise<string[]>>();
const isSustainingMember = vi.fn<(userId: string) => Promise<boolean>>();

vi.mock('$lib/server/authorization', () => ({ getUserRoles: (id: string) => getUserRoles(id) }));
vi.mock('$lib/server/finance/subscription-service', () => ({
	isSustainingMember: (id: string) => isSustainingMember(id)
}));

const { resolveHelpAudience, normalizeAudience } = await import('./help-service');

beforeEach(() => {
	getUserRoles.mockReset();
	isSustainingMember.mockReset();
	isSustainingMember.mockResolvedValue(false);
});

describe('resolveHelpAudience', () => {
	it('reads an unknown position at staff, not member', async () => {
		// The whole point of the change. `treasurer` is in no ladder anywhere.
		getUserRoles.mockResolvedValue(['treasurer']);
		expect(await resolveHelpAudience('u1')).toBe('staff');
	});

	it('reads admin and staff at staff', async () => {
		getUserRoles.mockResolvedValue(['admin']);
		expect(await resolveHelpAudience('u1')).toBe('staff');
		getUserRoles.mockResolvedValue(['staff']);
		expect(await resolveHelpAudience('u1')).toBe('staff');
	});

	it('reads a plain member at member', async () => {
		getUserRoles.mockResolvedValue(['member']);
		expect(await resolveHelpAudience('u1')).toBe('member');
	});

	it('does not treat the legacy sustaining or volunteer rows as elevated', async () => {
		// Both are seeded and grant nothing; sustaining status comes from the
		// subscription, below, not from the role row.
		getUserRoles.mockResolvedValue(['member', 'sustaining', 'volunteer']);
		expect(await resolveHelpAudience('u1')).toBe('member');
	});

	it('lifts a subscriber to sustaining', async () => {
		getUserRoles.mockResolvedValue(['member']);
		isSustainingMember.mockResolvedValue(true);
		expect(await resolveHelpAudience('u1')).toBe('sustaining');
	});

	it('prefers a position over a subscription', async () => {
		getUserRoles.mockResolvedValue(['volunteer_coordinator']);
		isSustainingMember.mockResolvedValue(true);
		expect(await resolveHelpAudience('u1')).toBe('staff');
	});

	it('reads a user with no roles at all at member', async () => {
		getUserRoles.mockResolvedValue([]);
		expect(await resolveHelpAudience('u1')).toBe('member');
	});
});

describe('normalizeAudience', () => {
	it('passes ladder values through', () => {
		for (const a of ['public', 'member', 'sustaining', 'staff']) {
			expect(normalizeAudience(a)).toBe(a);
		}
	});

	it('maps the legacy admin tier onto staff', () => {
		// The article editor used to offer `admin`, so production rows may carry
		// it. Without the alias such a row matches no audience and vanishes for
		// everyone, including admins.
		expect(normalizeAudience('admin')).toBe('staff');
	});

	it('clamps anything unrecognised to the most restrictive tier', () => {
		expect(normalizeAudience('wat')).toBe('staff');
		expect(normalizeAudience('')).toBe('staff');
		expect(normalizeAudience(null)).toBe('staff');
		expect(normalizeAudience(undefined)).toBe('staff');
	});
});
