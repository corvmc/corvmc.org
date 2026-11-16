import type { RequestHandler } from './$types';
import { listPublicUpcomingEvents } from '#lib/server/event/event-service.js';
import { listPublicBands } from '#lib/server/directory/directory-service.js';

const STATIC_ROUTES = [
	'/',
	'/about',
	'/about/privacy',
	'/about/bylaws',
	'/events',
	'/directory',
	'/programs',
	'/contribute',
	'/contact',
	'/subscribe',
	'/login'
];

export const GET: RequestHandler = async ({ url }) => {
	const origin = url.origin;

	const [events, bands] = await Promise.all([
		listPublicUpcomingEvents(new Date(), { limit: 500, offset: 0 }),
		listPublicBands()
	]);

	const urls = [
		...STATIC_ROUTES.map((path) => `<url><loc>${origin}${path}</loc></url>`),
		...events.map((e) => `<url><loc>${origin}/events/${e.id}</loc></url>`),
		...bands.map((b) => `<url><loc>${origin}/directory/bands/${b.slug}</loc></url>`)
	];

	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

	return new Response(xml, {
		headers: {
			'Content-Type': 'application/xml',
			'Cache-Control': 'max-age=3600'
		}
	});
};
