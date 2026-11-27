import { redirect } from '@sveltejs/kit';

/** Sign-up is the register mode of /login; `/register` links and typed URLs land there. */
export function load({ url }) {
	const params = new URLSearchParams(url.search);
	params.delete('register');
	const rest = params.toString();
	redirect(308, `/login?register${rest ? `&${rest}` : ''}`);
}
