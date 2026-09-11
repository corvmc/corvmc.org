import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { form, query, getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema/authentication';
import { auth } from '$lib/server/auth';
import { eq } from 'drizzle-orm';
import { parseBirthDateInput } from '$lib/utils/age';
import { requireUser, hasAnyRole } from '$lib/server/authorization';
import { mapDomainError } from '$lib/server/errors';
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
				phone: user.phone,
				dateOfBirth: user.dateOfBirth,
				emailVerified: user.emailVerified
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
		phone: z.string().max(30).optional().default(''),
		// `YYYY-MM-DD` from a date input, parsed and range-checked server-side.
		dateOfBirth: z.string().max(10).optional().default('')
	}),
	async (data) => {
		const currentUser = requireUser();

		const [existing] = await db
			.select({ dateOfBirth: user.dateOfBirth })
			.from(user)
			.where(eq(user.id, currentUser.id))
			.limit(1);

		/**
		 * Write-once from here, the way `volunteer_profile.isAdult` is.
		 *
		 * Messaging eligibility is derived from this, so a member who could edit it
		 * freely could lift their own restriction by claiming a different birthday
		 * — the exact hole `updateVolunteerProfileSchema` omits `isAdult` to close.
		 * Staff can correct a mistake through `updateUser`; the member cannot
		 * quietly re-answer.
		 */
		const dateOfBirth = existing?.dateOfBirth ?? parseBirthDateInput(data.dateOfBirth);

		await db
			.update(user)
			.set({
				name: data.name,
				pronouns: data.pronouns || null,
				phone: data.phone || null,
				dateOfBirth,
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
		try {
			await deactivateUser(currentUser.id);
		} catch (err) {
			mapDomainError(err);
		}

		// Sign out
		await auth.api.signOut({ headers: event.request.headers });

		return { success: true };
	}
);

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

/**
 * The caller's own `subscriber` row, or a 403 explaining what to do about it.
 *
 * `emailVerified` is read from the row rather than taken off the session: the
 * signed cookie is trusted for 60s, so a member who verified moments ago would
 * otherwise be turned away by a stale `false`.
 */
async function subscriberForCurrentUser(currentUser: { id: string; email: string; name: string }) {
	const [row] = await db
		.select({ emailVerified: user.emailVerified })
		.from(user)
		.where(eq(user.id, currentUser.id));

	const sub = await findOrCreateForUser(currentUser.id, currentUser.email, currentUser.name, {
		emailVerified: row?.emailVerified ?? false
	});

	// null means a subscriber row already exists under this address and belongs
	// to nobody yet — someone signed up to a list with it before this account
	// existed. Taking it over needs a confirmed address (#757).
	if (!sub) {
		throw error(
			403,
			'Confirm your email address before managing your mailing lists — this address is already on a list from before your account existed.'
		);
	}
	return sub;
}

/**
 * Send the verification link again.
 *
 * Guarded, and the address is the session's own — better-auth additionally
 * refuses a body email that does not match the session, so the token can never
 * be minted for an address the caller does not hold.
 *
 * `form('unchecked', …)` rather than `form(z.object({}), …)`: kit 2.70 rejects
 * a bare empty object schema.
 */
export const resendVerificationEmail = form('unchecked', async () => {
	const currentUser = requireUser();
	const event = getRequestEvent();

	await auth.api.sendVerificationEmail({
		body: { email: currentUser.email, callbackURL: '/member/account' },
		headers: event.request.headers
	});

	return { success: true };
});

export const subscribe = form(
	z.object({
		audienceId: z.string().min(1)
	}),
	async (data) => {
		const currentUser = requireUser();
		const audienceId = data.audienceId as string;
		const sub = await subscriberForCurrentUser(currentUser);
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
		const sub = await subscriberForCurrentUser(currentUser);
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
