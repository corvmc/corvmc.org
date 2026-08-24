import { describe, it, expect } from 'vitest';
import { imageSrc, transformOptions, IMAGE_PRESETS, CDN_MARKER } from './images';

/** A canonical URL as `getPublicUrl` mints it (Plan A: bare-key source). */
const TRANSFORMED = `https://media.corvmc.org${CDN_MARKER}${transformOptions(1200)}/events/posters/evt-1.jpg`;

/** Plan B shape: absolute source on a different host. */
const TRANSFORMED_ABSOLUTE = `https://corvmc.org${CDN_MARKER}${transformOptions(1200)}/https://media.corvmc.org/events/posters/evt-1.jpg`;

describe('transformOptions', () => {
	it('builds a Cloudflare options segment', () => {
		expect(transformOptions(320, 'cover')).toBe('width=320,fit=cover,format=auto,quality=85');
	});

	it('defaults to scale-down so images are never cropped unasked', () => {
		expect(transformOptions(320)).toContain('fit=scale-down');
	});
});

describe('imageSrc passthrough', () => {
	it('returns an undefined src for a missing URL', () => {
		expect(imageSrc(null, 'poster')).toEqual({ src: undefined });
		expect(imageSrc(undefined, 'poster')).toEqual({ src: undefined });
	});

	it('leaves a plain R2 URL alone and emits no srcset', () => {
		const url = 'https://media.corvmc.org/events/posters/evt-1.jpg';
		expect(imageSrc(url, 'poster')).toEqual({ src: url });
	});

	it('leaves an external OAuth avatar alone', () => {
		const url = 'https://lh3.googleusercontent.com/a/ACg8ocK';
		expect(imageSrc(url, 'avatar-md')).toEqual({ src: url });
	});

	it('leaves a non-image URL alone', () => {
		const url = 'https://media.corvmc.org/bands/b1/media/rider/x.pdf';
		expect(imageSrc(url, 'gallery')).toEqual({ src: url });
	});

	it('returns the URL untouched for the "original" preset', () => {
		expect(imageSrc(TRANSFORMED, 'original')).toEqual({ src: TRANSFORMED });
	});

	it('defaults to the "original" preset', () => {
		expect(imageSrc(TRANSFORMED)).toEqual({ src: TRANSFORMED });
	});
});

describe('imageSrc fluid presets', () => {
	it('emits ascending w-descriptors and a sizes attribute', () => {
		const { src, srcset, sizes } = imageSrc(TRANSFORMED, 'poster');

		expect(srcset).toBe(
			[320, 480, 720]
				.map(
					(w) =>
						`https://media.corvmc.org${CDN_MARKER}${transformOptions(w, 'scale-down')}/events/posters/evt-1.jpg ${w}w`
				)
				.join(', ')
		);
		expect(sizes).toBe(IMAGE_PRESETS.poster.sizes);
		expect(src).toContain('width=320,');
	});

	it('rewrites the options segment without touching the source', () => {
		const { src } = imageSrc(TRANSFORMED, 'thumb');
		expect(src).toBe(
			`https://media.corvmc.org${CDN_MARKER}${transformOptions(160, 'cover')}/events/posters/evt-1.jpg`
		);
	});

	it('preserves an absolute cross-host source', () => {
		const { srcset } = imageSrc(TRANSFORMED_ABSOLUTE, 'hero');
		expect(srcset).toContain('/https://media.corvmc.org/events/posters/evt-1.jpg 1920w');
	});
});

describe('imageSrc fixed presets', () => {
	it('emits x-descriptors and no sizes', () => {
		const result = imageSrc(TRANSFORMED, 'avatar-md');

		expect(result.sizes).toBeUndefined();
		expect(result.srcset).toBe(
			`https://media.corvmc.org${CDN_MARKER}${transformOptions(96, 'cover')}/events/posters/evt-1.jpg, ` +
				`https://media.corvmc.org${CDN_MARKER}${transformOptions(192, 'cover')}/events/posters/evt-1.jpg 2x`
		);
	});

	it('uses the 1x rung as src so the common case fetches once', () => {
		expect(imageSrc(TRANSFORMED, 'avatar-sm').src).toContain('width=48,');
	});
});

describe('imageSrc robustness', () => {
	it('is idempotent — re-narrowing its own output is a no-op', () => {
		const once = imageSrc(TRANSFORMED, 'poster');
		const twice = imageSrc(once.src, 'poster');
		expect(twice).toEqual(once);
	});

	it('splits on the first marker when the key itself contains cdn-cgi', () => {
		const url = `https://media.corvmc.org${CDN_MARKER}${transformOptions(1200)}/bands/cdn-cgi-fan/logo.png`;
		expect(imageSrc(url, 'thumb').src).toBe(
			`https://media.corvmc.org${CDN_MARKER}${transformOptions(160, 'cover')}/bands/cdn-cgi-fan/logo.png`
		);
	});

	it('passes through a marker with no source after the options', () => {
		const url = `https://media.corvmc.org${CDN_MARKER}width=1200`;
		expect(imageSrc(url, 'poster')).toEqual({ src: url });
	});
});
