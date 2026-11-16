import { getObject } from '#lib/server/storage.js';
import type { SponsorCredit } from '#lib/server/sponsor/credit-service.js';
import { bytesDataUrl, type SponsorLogo } from './brand';

// What satori can size and resvg can decode. AVIF and WebP are neither, so a
// logo in another format is drawn as the sponsor's name instead.
const DRAWABLE = new Set(['image/png', 'image/jpeg', 'image/svg+xml']);

/**
 * Each credit's logo read through the R2 binding, not image transformations:
 * `format=auto` can answer AVIF. A missing or undrawable logo falls back to
 * the name, so a credit is never dropped from the poster.
 */
export async function sponsorLogos(credits: SponsorCredit[]): Promise<SponsorLogo[]> {
	return Promise.all(
		credits.map(async (c) => {
			const object = c.logoKey ? await getObject(c.logoKey) : null;
			const type = object?.contentType ?? '';
			return {
				name: c.name,
				src: object && DRAWABLE.has(type) ? bytesDataUrl(object.bytes, type) : null
			};
		})
	);
}
