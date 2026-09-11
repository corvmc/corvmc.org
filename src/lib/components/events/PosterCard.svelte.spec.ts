import { resolve } from '$app/paths';
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
	href: resolve('/events/1'),
	title: 'Cascade Fest',
	startsAt: new Date('2026-08-20T19:00:00Z')
};

const img = () => document.querySelector('img[alt="Cascade Fest"]');

describe('PosterCard poster sizing', () => {
	it('offers a width ladder when the URL is a transform URL', async () => {
		const posterUrl = `https://media.corvmc.org${CDN_MARKER}${transformOptions(1200)}/events/posters/e1.jpg`;
		await render(PosterCard, { ...base, posterUrl });

		const srcset = img()?.getAttribute('srcset') ?? '';
		expect(srcset.split(', ')).toHaveLength(3);
		expect(srcset).toContain('320w');
		expect(img()?.getAttribute('sizes')).toBeTruthy();
	});

	it('omits srcset entirely for a plain R2 URL', async () => {
		const posterUrl = 'https://media.corvmc.org/events/posters/e1.jpg';
		await render(PosterCard, { ...base, posterUrl });

		expect(img()?.getAttribute('src')).toBe(posterUrl);
		expect(img()?.hasAttribute('srcset')).toBe(false);
		expect(img()?.hasAttribute('sizes')).toBe(false);
	});
});

/**
 * The tape carries the event's first tag. Suppressing the whole badge row
 * whenever a tape was set meant the same event showed one tag on
 * /member/events and all of them on /events (#1041).
 */
describe('PosterCard tags beside a tape label', () => {
	const tagsOf = () =>
		[...document.querySelectorAll('.sticker-badge')].map((el) => el.textContent?.trim());

	it('shows the tags the tape is not already showing', async () => {
		await render(PosterCard, { ...base, tags: 'Workshop, All-ages', tapeLabel: 'Workshop' });

		expect(tagsOf()).toEqual(['All-ages']);
	});

	it('shows every tag when there is no tape', async () => {
		await render(PosterCard, { ...base, tags: 'Workshop, All-ages' });

		expect(tagsOf()).toEqual(['Workshop', 'All-ages']);
	});

	it('renders no badge row when the tape is the only tag', async () => {
		await render(PosterCard, { ...base, tags: 'Workshop', tapeLabel: 'Workshop' });

		expect(tagsOf()).toEqual([]);
	});
});
