import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setUserAvatar, clearUserAvatar } from '$lib/server/directory/profile-service';
import { validateUpload } from '$lib/server/storage';

// ---------------------------------------------------------------------------
// POST — upload the current user's avatar
// ---------------------------------------------------------------------------

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	const formData = await request.formData();
	const file = formData.get('file') as File | null;

	if (!file || !(file instanceof File)) {
		throw error(400, 'No file provided');
	}

	// Surface a rejected type/size as a 400 rather than letting uploadFile throw a
	// bare Error: that became a 500, so the member saw "Internal Error" instead of
	// the reason and Sentry logged their .psd as a server fault
	// (JAVASCRIPT-SVELTEKIT-2E). Every other upload route already does this.
	const reason = validateUpload(file);
	if (reason) throw error(400, reason);

	const key = await setUserAvatar(locals.user.id, await file.arrayBuffer(), file.type);

	return json({ success: true, avatarKey: key });
};

// ---------------------------------------------------------------------------
// DELETE — remove the current user's avatar
// ---------------------------------------------------------------------------

export const DELETE: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Not authenticated');

	await clearUserAvatar(locals.user.id);

	return json({ success: true });
};
