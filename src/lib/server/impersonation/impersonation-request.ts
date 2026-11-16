import type { RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { recordImpersonatedWrite } from './impersonation-service';

/**
 * The request half of viewing as a member (#2847), called from
 * `hooks.server.ts`: who the admin is, which better-auth endpoints are
 * refused, and the audit row for every request that could write. Remote
 * `form` and `command` calls are POSTs, so they are all covered.
 */

/** better-auth's own credential endpoints. The remote functions refuse theirs separately. */
const REFUSED_AUTH_PATHS = [
	'/api/auth/change-password',
	'/api/auth/change-email',
	'/api/auth/set-password',
	'/api/auth/delete-user'
];

export function refusedWhileImpersonating(pathname: string): boolean {
	return REFUSED_AUTH_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function couldWrite(method: string): boolean {
	return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

export async function impersonatorFor(adminId: string) {
	const [row] = await db
		.select({ id: user.id, name: user.name, email: user.email })
		.from(user)
		.where(eq(user.id, adminId))
		.limit(1);
	return row ?? { id: adminId, name: 'Administrator', email: '' };
}

export async function auditImpersonatedRequest(event: RequestEvent, status: number): Promise<void> {
	const { impersonator, user: member } = event.locals;
	if (!impersonator || !member || !couldWrite(event.request.method)) return;
	await recordImpersonatedWrite(impersonator, member.id, {
		method: event.request.method.toUpperCase(),
		path: event.url.pathname.slice(0, 200),
		status
	});
}
