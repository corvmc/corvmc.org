import { redirect } from '@sveltejs/kit';
import { productionsPath } from '../productions/path';

// Productions is its own list again (#3112); the old view's links land on it.
export function load({ url }) {
	if (url.searchParams.get('view') === 'productions') {
		redirect(308, productionsPath(url.search, '/staff/events'));
	}
}
