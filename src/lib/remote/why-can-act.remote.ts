import { z } from 'zod';
import { query } from '$app/server';
import { requireCapability, requireUser } from '#lib/server/authorization.js';
import { explainAccess } from '#lib/server/access/why-can-act.js';

/**
 * Why a person can act (#2994): their positions, departments and live shift
 * roles. Anyone's to a holder of `user.read`, who reads the member record
 * anyway; otherwise only the caller's own.
 */
export const getPersonAccessWhy = query(z.string().min(1), async (userId) => {
	const caller = requireUser();
	if (userId !== caller.id) await requireCapability('user.read');
	return explainAccess(userId);
});

/** The caller's own, for their volunteer profile. */
export const getMyAccessWhy = query(async () => explainAccess(requireUser().id));
