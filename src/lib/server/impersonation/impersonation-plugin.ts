import { z } from 'zod';
import type { BetterAuthPlugin } from 'better-auth';
import {
	APIError,
	createAuthEndpoint,
	getSessionFromCtx,
	sessionMiddleware
} from 'better-auth/api';
import { deleteSessionCookie, expireCookie, setSessionCookie } from 'better-auth/cookies';
import {
	assertMayImpersonate,
	ImpersonationRefusedError,
	recordImpersonation
} from './impersonation-service';

/** How long a view-as session lasts before the admin has to start again. */
const IMPERSONATION_SECONDS = 60 * 60;

/**
 * Start and stop viewing as a member (#2847): the admin plugin's session swap,
 * without its ban, set-role and set-password endpoints, which gate on a
 * `user.role` column this app does not use. `SERVER_ONLY`: reached through
 * `auth.api` from `impersonation.remote.ts`, never over HTTP. The admin's own
 * session waits in the signed `admin_session` cookie until Stop.
 */
export const impersonation = () =>
	({
		id: 'impersonation',
		schema: {
			session: {
				fields: { impersonatedBy: { type: 'string', required: false, input: false } }
			}
		},
		endpoints: {
			startImpersonating: createAuthEndpoint(
				'/impersonation/start',
				{
					method: 'POST',
					body: z.object({ userId: z.string().min(1) }),
					use: [sessionMiddleware],
					metadata: { SERVER_ONLY: true }
				},
				async (ctx) => {
					const admin = ctx.context.session;
					if ((admin.session as { impersonatedBy?: string | null }).impersonatedBy) {
						throw new APIError('BAD_REQUEST', { message: 'Stop viewing as a member first.' });
					}
					try {
						await assertMayImpersonate(admin.user.id, ctx.body.userId);
					} catch (err) {
						if (err instanceof ImpersonationRefusedError) {
							throw new APIError('FORBIDDEN', { message: err.message });
						}
						throw err;
					}
					const target = await ctx.context.internalAdapter.findUserById(ctx.body.userId);
					if (!target) throw new APIError('NOT_FOUND', { message: 'No such member.' });

					const session = await ctx.context.internalAdapter.createSession(
						target.id,
						true,
						{
							impersonatedBy: admin.user.id,
							expiresAt: new Date(Date.now() + IMPERSONATION_SECONDS * 1000)
						},
						true
					);
					const authCookies = ctx.context.authCookies;
					deleteSessionCookie(ctx);
					const dontRemember = await ctx.getSignedCookie(
						authCookies.dontRememberToken.name,
						ctx.context.secret
					);
					await ctx.setSignedCookie(
						ctx.context.createAuthCookie('admin_session').name,
						`${admin.session.token}:${dontRemember || ''}`,
						ctx.context.secret,
						authCookies.sessionToken.attributes
					);
					await setSessionCookie(ctx, { session, user: target }, true);
					await recordImpersonation(
						'started',
						{ id: admin.user.id, name: admin.user.name, email: admin.user.email },
						target.id
					);
					return ctx.json({ userId: target.id });
				}
			),
			stopImpersonating: createAuthEndpoint(
				'/impersonation/stop',
				{ method: 'POST', requireHeaders: true, metadata: { SERVER_ONLY: true } },
				async (ctx) => {
					const current = await getSessionFromCtx(ctx);
					const adminId = (current?.session as { impersonatedBy?: string | null } | undefined)
						?.impersonatedBy;
					if (!current || !adminId) {
						throw new APIError('BAD_REQUEST', { message: 'Not viewing as a member.' });
					}
					const adminCookie = ctx.context.createAuthCookie('admin_session');
					const stored = await ctx.getSignedCookie(adminCookie.name, ctx.context.secret);
					const [adminToken, dontRemember] = (stored || '').split(':');
					const adminSession = adminToken
						? await ctx.context.internalAdapter.findSession(adminToken)
						: null;
					await ctx.context.internalAdapter.deleteSession(current.session.token);
					expireCookie(ctx, adminCookie);
					if (!adminSession || adminSession.session.userId !== adminId) {
						// The admin's own session ended meanwhile: drop to signed out.
						deleteSessionCookie(ctx);
					} else {
						await setSessionCookie(ctx, adminSession, !!dontRemember);
					}
					const admin = adminSession?.user;
					await recordImpersonation(
						'stopped',
						admin
							? { id: admin.id, name: admin.name, email: admin.email }
							: { id: adminId, name: 'Administrator', email: '' },
						current.user.id
					);
					return ctx.json({ memberId: current.user.id });
				}
			)
		}
	}) satisfies BetterAuthPlugin;
