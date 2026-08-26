import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { form, query, getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema/authentication';
import { auth } from '$lib/server/auth';
import { eq } from 'drizzle-orm';
import { requireUser, hasAnyRole } from '$lib/server/authorization';
import { deactivateUser } from '$lib/server/user/user-service';
import {
	getSubscriptionsForUser,
	getOptInAudiencesForUser
} from '$lib/server/marketing/audience-service';
import {
	addSubscriber,
	unsubscribe as unsubscribeFromAudience
} from '$lib/server/marketing/audience-service';
import {
	findOrCreateForUser,
	clearSelfServiceSuppression
} from '$lib/server/marketing/subscriber-service';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getMemberAccount = query(async () => {
	const currentUser = requireUser();

	const [row, staff] = await Promise.all([
		db
			.select({
				id: user.id,
				name: user.name,
				email: user.email,
				pronouns: user.pronouns,
				phone: user.phone
			})
			.from(user)
			.where(eq(user.id, currentUser.id))
			.then((rows) => rows[0]),
		hasAnyRole(currentUser.id, ['admin', 'staff'])
	]);

	if (!row) throw error(404, 'User not found');

	return { user: row, isStaff: staff };
});

export const getMySubscriptions = query(z.void(), async () => {
	const currentUser = requireUser();
	return getSubscriptionsForUser(currentUser.id);
});

export const getAvailableLists = query(z.void(), async () => {
	const currentUser = requireUser();
	return getOptInAudiencesForUser(currentUser.id);
});

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export const updateProfile = form(
	z.object({
		name: z.string().min(1, 'Name is required').max(255),
		pronouns: z.string().max(50).optional().default(''),
		phone: z.string().max(30).optional().default('')
	}),
	async (data) => {
		const currentUser = requireUser();

		await db
			.update(user)
			.set({
				name: data.name,
				pronouns: data.pronouns || null,
				phone: data.phone || null,
				updatedAt: new Date()
			})
			.where(eq(user.id, currentUser.id));

		return { success: true };
	}
);

export const changePassword = form(
	z
		.object({
			currentPassword: z.string().min(1, 'Current password is required'),
			newPassword: z.string().min(8, 'Password must be at least 8 characters'),
			confirmPassword: z.string().min(1, 'Please confirm your password')
		})
		.refine((d) => d.newPassword === d.confirmPassword, {
			message: 'Passwords do not match',
			path: ['confirmPassword']
		}),
	async (data) => {
		requireUser();
		const event = getRequestEvent();

		// Use better-auth's change-password endpoint via internal API
		await auth.api.changePassword({
			headers: event.request.headers,
			body: {
				currentPassword: data.currentPassword,
				newPassword: data.newPassword,
				revokeOtherSessions: false
			}
		});

		return { success: true };
	}
);

export const deleteAccount = form(
	z.object({
		password: z.string().min(1, 'Password is required to delete your account')
	}),
	async (data) => {
		const currentUser = requireUser();
		const event = getRequestEvent();

		// Staff and admin accounts cannot be self-deleted
		if (await hasAnyRole(currentUser.id, ['admin', 'staff'])) {
			throw error(403, 'Staff and admin accounts cannot be deleted this way');
		}

		// Verify password by attempting sign-in
		try {
			await auth.api.signInEmail({
				headers: event.request.headers,
				body: {
					email: currentUser.email,
					password: data.password
				}
			});
		} catch {
			throw error(403, 'Incorrect password');
		}

		// Full offboarding (cancels reservations + subscription, purges sessions,
		// soft-deletes) lives in the shared service shared with staff deactivation.
		await deactivateUser(currentUser.id);

		// Sign out
		await auth.api.signOut({ headers: event.request.headers });

		return { success: true };
	}
);

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

export const subscribe = form(
	z.object({
		audienceId: z.string().min(1)
	}),
	async (data) => {
		const currentUser = requireUser();
		const audienceId = data.audienceId as string;
		const sub = await findOrCreateForUser(currentUser.id, currentUser.email, currentUser.name);
		// Opting in lifts a previous "unsubscribe from all"; a bounce or complaint
		// suppression is left alone.
		await clearSelfServiceSuppression(sub.id);
		await addSubscriber(audienceId, sub.id);

		void getMyEmailSubscriptions().refresh();
		return { success: true };
	}
);

export const unsubscribe = form(
	z.object({
		audienceId: z.string().min(1)
	}),
	async (data) => {
		const currentUser = requireUser();
		const audienceId = data.audienceId as string;
		// find-or-create, not find: a member can be in a built-in audience without
		// ever having had a subscriber row, and still needs to be able to leave it.
		const sub = await findOrCreateForUser(currentUser.id, currentUser.email, currentUser.name);
		await unsubscribeFromAudience(sub.id, audienceId);

		void getMyEmailSubscriptions().refresh();
		return { success: true };
	}
);

/**
 * The account page's Email Subscriptions section, as one query.
 *
 * Both halves are unparameterized and both are refreshed together by the two mutations below, so
 * the wrapper replaces them one for one.
 */
export const getMyEmailSubscriptions = query(z.void(), async () => {
	const [subscriptions, available] = await Promise.all([getMySubscriptions(), getAvailableLists()]);
	return { subscriptions, available };
});
