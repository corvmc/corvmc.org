import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/env/private', () => ({
	BETTER_AUTH_SECRET: 'test-secret',
	ORIGIN: 'https://x.test'
}));

const { signRemovalToken, verifyRemovalToken, REMOVAL_LINK_TTL_DAYS } =
	await import('./removal-link');

const now = new Date('2026-11-13T00:00:00Z');
const DAY = 86_400_000;

describe('removal link', () => {
	it('names the removal it was signed for', () => {
		expect(verifyRemovalToken(signRemovalToken('r1', now), now)).toEqual({ removalId: 'r1' });
	});

	it('expires after its term', () => {
		const token = signRemovalToken('r1', now);
		const after = new Date(now.getTime() + (REMOVAL_LINK_TTL_DAYS + 1) * DAY);
		expect(verifyRemovalToken(token, after)).toBe('expired');
	});

	it('refuses a token whose removal id was swapped', () => {
		const [, expires, signature] = Buffer.from(signRemovalToken('r1', now), 'base64url')
			.toString()
			.split('.');
		const forged = Buffer.from(`r2.${expires}.${signature}`).toString('base64url');
		expect(verifyRemovalToken(forged, now)).toBeNull();
	});

	it('refuses garbage', () => {
		expect(verifyRemovalToken('not-a-token', now)).toBeNull();
	});
});
