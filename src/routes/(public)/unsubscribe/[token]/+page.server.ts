import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { verifyUnsubscribeToken } from '#lib/server/marketing/unsubscribe.js';
import { unsubscribe } from '#lib/server/marketing/audience-service.js';

// One-click unsubscribe (RFC 8058). Mail clients honoring the
// `List-Unsubscribe-Post: List-Unsubscribe=One-Click` header POST to this
// page's URL with no UI interaction. Verify the signed token and clear the
// audience membership without rendering. Intentionally NOT feature-gated —
// unsubscribe links must work forever, even if email marketing is toggled off.
export const actions: Actions = {
	default: async ({ params }) => {
		const decoded = verifyUnsubscribeToken(params.token);
		if (!decoded) return fail(400, { ok: false });

		await unsubscribe(decoded.subscriberId, decoded.audienceId);
		return { ok: true };
	}
};
