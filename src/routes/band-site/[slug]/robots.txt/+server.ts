import { error, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { bandSiteUrl } from '#lib/utils/band-site-url.js';
import { db } from '#lib/server/db/index.js';
import { group } from '#lib/server/db/schema/group.js';
import { bandSite } from '#lib/server/db/schema/band-site.js';
import { eq, and, isNull } from 'drizzle-orm';

// Served on band subdomains: {slug}.corvmc.org/robots.txt reroutes here.
export const GET: RequestHandler = async ({ params }) => {
	const [row] = await db
		.select({
			tier: bandSite.tier,
			customDomain: bandSite.customDomain,
			status: bandSite.customDomainStatus
		})
		.from(group)
		.leftJoin(bandSite, eq(bandSite.groupId, group.id))
		.where(and(eq(group.slug, params.slug!), isNull(group.deletedAt)))
		.limit(1);
	if (!row || row.tier !== 'premium') throw error(404, 'Not found');

	const origin = bandSiteUrl(
		params.slug!,
		env.PUBLIC_SITE_URL,
		row.status === 'active' ? row.customDomain : null
	);
	const body = ['User-agent: *', 'Allow: /', `Sitemap: ${origin}/sitemap.xml`, ''].join('\n');

	return new Response(body, {
		headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=3600' }
	});
};
