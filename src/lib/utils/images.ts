/**
 * Cloudflare Image Transformations URL helpers.
 *
 * The server mints exactly one canonical transform URL per R2 key (see
 * `getPublicUrl` in `$lib/server/storage`). Because `/cdn-cgi/image/<options>/<source>`
 * is a self-describing shape, the options segment can be rewritten by a *pure*
 * string function — no bucket, no bindings, no `$env`. That lets each component
 * ask for the size it actually draws, at the point of render, on both the server
 * and the client.
 *
 * Everything here degrades safely: a URL without the `/cdn-cgi/image/` marker
 * (transformations disabled, an external OAuth avatar, a PDF that the storage
 * layer deliberately refused to wrap) is passed through untouched with no
 * `srcset`, which renders exactly the markup this app emitted before.
 */

/** The fixed path segment Cloudflare intercepts. */
export const CDN_MARKER = '/cdn-cgi/image/';

/** Width the server mints canonically, before any component narrows it. */
export const DEFAULT_WIDTH = 1200;

const QUALITY = 85;

type Fit = 'cover' | 'scale-down' | 'contain';

/** Rendered at a known CSS size — vary on device pixel ratio, not viewport. */
type FixedPreset = {
	width: number;
	fit: Fit;
	/** Pixel-density rungs; `1` is always the `src`. */
	dpr: readonly number[];
	widths?: never;
	sizes?: never;
};

/** Rendered at a viewport-dependent size — vary on width, needs `sizes`. */
type FluidPreset = {
	widths: readonly number[];
	fit: Fit;
	sizes: string;
	width?: never;
	dpr?: never;
};

/**
 * Size ladders, deliberately kept to 2–3 rungs each: every distinct
 * (image × option-set) is a separately billed unique transformation, and the
 * free tier allows 5,000 per month.
 */
export const IMAGE_PRESETS = {
	'avatar-sm': { width: 48, fit: 'cover', dpr: [1, 2] },
	'avatar-md': { width: 96, fit: 'cover', dpr: [1, 2] },
	'avatar-lg': { width: 192, fit: 'cover', dpr: [1, 2] },
	thumb: { widths: [160, 320], fit: 'cover', sizes: '96px' },
	poster: { widths: [320, 480, 720], fit: 'scale-down', sizes: '(max-width: 640px) 45vw, 320px' },
	gallery: { widths: [320, 640, 960], fit: 'scale-down', sizes: '(max-width: 768px) 50vw, 320px' },
	hero: { widths: [768, 1280, 1920], fit: 'cover', sizes: '100vw' },
	/** Opt out of rewriting entirely — render the URL the server handed us. */
	original: null
} as const satisfies Record<string, FixedPreset | FluidPreset | null>;

export type ImagePreset = keyof typeof IMAGE_PRESETS;

/**
 * The `<options>` segment of a transform URL. `format=auto` lets Cloudflare pick
 * AVIF/WebP/JPEG per client and still bills as a single unique transformation.
 */
export function transformOptions(width: number, fit: Fit = 'scale-down'): string {
	return `width=${width},fit=${fit},format=auto,quality=${QUALITY}`;
}

export type ImageSrc = {
	src: string | undefined;
	srcset?: string;
	sizes?: string;
};

/**
 * Split a transform URL into its origin prefix and its source, or return null
 * when the URL isn't a transform URL at all.
 */
function parse(url: string): { prefix: string; source: string } | null {
	const marker = url.indexOf(CDN_MARKER);
	if (marker === -1) return null;

	const prefix = url.slice(0, marker + CDN_MARKER.length);
	const rest = url.slice(marker + CDN_MARKER.length);

	// The options segment runs to the first slash; everything after it is the
	// source, which may be a bare key or (when transforming cross-host) a URL.
	const slash = rest.indexOf('/');
	if (slash === -1) return null;

	const source = rest.slice(slash + 1);
	if (!source) return null;

	return { prefix, source };
}

/**
 * Resize a server-minted image URL for the size a component actually draws.
 *
 * Returns `{ src }` alone whenever there's nothing to vary, so callers can
 * always spread the result onto an `<img>`: Svelte omits `undefined`
 * attributes, leaving plain `<img src=...>` in the untransformable cases.
 */
export function imageSrc(
	url: string | null | undefined,
	preset: ImagePreset = 'original'
): ImageSrc {
	if (!url) return { src: undefined };

	const config = IMAGE_PRESETS[preset];
	if (!config) return { src: url };

	const parsed = parse(url);
	if (!parsed) return { src: url };

	const { prefix, source } = parsed;
	const build = (width: number) => `${prefix}${transformOptions(width, config.fit)}/${source}`;

	if ('widths' in config) {
		return {
			src: build(config.widths[0]),
			srcset: config.widths.map((w) => `${build(w)} ${w}w`).join(', '),
			sizes: config.sizes
		};
	}

	// Fixed size: `src` is the 1x rung so the common (non-retina) case fetches
	// once — bits-ui's Avatar preloads via `src` alone and would otherwise
	// download a second copy.
	return {
		src: build(config.width),
		srcset: config.dpr.map((d) => `${build(config.width * d)}${d === 1 ? '' : ` ${d}x`}`).join(', ')
	};
}
