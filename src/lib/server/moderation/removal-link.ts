import { createHmac, timingSafeEqual } from 'node:crypto';
import * as env from '$app/env/private';

/** How long a removal notice's appeal link works. Staff can send a fresh one. */
export const REMOVAL_LINK_TTL_DAYS = 60;

function secret(): string {
	const value = env.BETTER_AUTH_SECRET;
	if (!value) throw new Error('BETTER_AUTH_SECRET is not configured');
	return value;
}

function sign(payload: string): string {
	return createHmac('sha256', `removal-link:${secret()}`).update(payload).digest('base64url');
}

/**
 * A link a removed member opens without a session. It names one removal and
 * expires; it is single-use because a report admits one appeal.
 */
export function signRemovalToken(removalId: string, now = new Date()): string {
	const expires = Math.floor(now.getTime() / 1000) + REMOVAL_LINK_TTL_DAYS * 86_400;
	const payload = `${removalId}.${expires}`;
	return Buffer.from(`${payload}.${sign(payload)}`).toString('base64url');
}

export function verifyRemovalToken(
	token: string,
	now = new Date()
): { removalId: string } | 'expired' | null {
	try {
		const [removalId, expires, signature] = Buffer.from(token, 'base64url')
			.toString('utf-8')
			.split('.');
		if (!removalId || !expires || !signature) return null;
		const expected = Buffer.from(sign(`${removalId}.${expires}`));
		const given = Buffer.from(signature);
		if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
		if (Number(expires) * 1000 < now.getTime()) return 'expired';
		return { removalId };
	} catch {
		return null;
	}
}

export function removalLink(removalId: string): string {
	return `${env.ORIGIN}/removed/${signRemovalToken(removalId)}`;
}
