import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PosterCard from './PosterCard.svelte';
import { CDN_MARKER, transformOptions } from '$lib/utils/images';

/**
 * Posters are the largest images the app serves. When Cloudflare Image
 * Transformations are on, the card must offer the browser a size ladder rather
 * than the single 1200px original — and when they're off (or the URL is an
 * untransformable original) it must fall back to plain markup, not a broken or
 * half-populated `srcset`.
 */

const base = {
	href: '/events/1',
	title: 'Cascade Fest',
	startsAt: new Date('2026-08-20T19:00:00Z')
};

const img = () => document.querySelector('img[alt="Cascade Fest"]');

describe('PosterCard poster sizing', () => {
	it('offers a width ladder when the URL is a transform URL', async () => {
		const posterUrl = `https://media.corvmc.org${CDN_MARKER}${transformOptions(1200)}/events/posters/e1.jpg`;
		render(PosterCard, { ...base, posterUrl });

		const srcset = img()?.getAttribute('srcset') ?? '';
		expect(srcset.split(', ')).toHaveLength(3);
		expect(srcset).toContain('320w');
		expect(img()?.getAttribute('sizes')).toBeTruthy();
	});

	it('omits srcset entirely for a plain R2 URL', async () => {
		const posterUrl = 'https://media.corvmc.org/events/posters/e1.jpg';
		render(PosterCard, { ...base, posterUrl });

		expect(img()?.getAttribute('src')).toBe(posterUrl);
		expect(img()?.hasAttribute('srcset')).toBe(false);
		expect(img()?.hasAttribute('sizes')).toBe(false);
	});
});
