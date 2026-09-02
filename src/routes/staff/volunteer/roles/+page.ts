import { redirect } from '@sveltejs/kit';

/**
 * The roles table folded into Setup, beside the clearances that gate them.
 * Role *detail* stays at `roles/[id]` — that is where a role is changed, and
 * `entityHref` resolves every role ref to it.
 */
export function load() {
	redirect(308, '/staff/volunteer/setup');
}
