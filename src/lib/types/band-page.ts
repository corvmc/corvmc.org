export const BAND_THEMES = [
	'default',
	'punk',
	'jazz',
	'metal',
	'indie',
	'electronic',
	'folk'
] as const;

export type BandTheme = (typeof BAND_THEMES)[number];

/**
 * What may actually be stored in `band_site.theme`.
 *
 * `custom` is the state a band reaches by editing a theme's CSS: the page
 * editor copies that theme's rules into the band's own stylesheet and stops
 * applying the class, so the CSS they can read is the whole of what applies.
 * There is deliberately no `.theme-custom` block in the stylesheet — see
 * `band-themes.spec.ts`, which iterates `BAND_THEMES` and would demand one.
 */
export const BAND_THEME_VALUES = [...BAND_THEMES, 'custom'] as const;

export type BandThemeValue = (typeof BAND_THEME_VALUES)[number];

export interface MerchItem {
	title: string;
	url: string;
	imageKey?: string;
	price?: string;
}

/**
 * What every block carries regardless of type.
 *
 * `hidden` is what the page editor's visibility toggle writes. Since the editor
 * became reorder-and-hide — every premium band starts with the whole catalogue,
 * see `$lib/utils/band-site-preset` — there is no delete, so a block a band does
 * not want is one it keeps and stops publishing. Absent means visible.
 */
interface BlockBase {
	id: string;
	cssClass?: string;
	hidden?: boolean;
}

export type Block =
	| (BlockBase & {
			type: 'hero';
			imageKey: string;
			headline?: string;
			subtitle?: string;
	  })
	| (BlockBase & { type: 'bio'; content: string })
	| (BlockBase & { type: 'links'; style: 'buttons' | 'icons' | 'list' })
	| (BlockBase & { type: 'members'; showPositions: boolean })
	| (BlockBase & { type: 'events'; limit?: number; showPast?: boolean })
	| (BlockBase & { type: 'gallery'; imageKeys: string[]; downloadable?: boolean })
	| (BlockBase & { type: 'embed'; platform: string; url: string })
	| (BlockBase & { type: 'press' })
	| (BlockBase & { type: 'achievements' })
	| (BlockBase & { type: 'contact'; showForm?: boolean })
	| (BlockBase & { type: 'tech_rider' })
	| (BlockBase & { type: 'custom_html'; content: string })
	| (BlockBase & { type: 'merch'; items: MerchItem[] })
	| (BlockBase & { type: 'spacer'; height: 'sm' | 'md' | 'lg' });

/**
 * One named human a venue can reach. `phone` is optional throughout and is
 * package-only wherever it appears — see `PublicPressKit`.
 */
export interface EpkContact {
	name: string;
	email: string;
	phone?: string;
}

/** A live video, premium-authored. Public once it exists. */
export interface BandVideo {
	url: string;
	label?: string;
}

/**
 * Everything a band writes into its press kit, both audiences mixed together.
 *
 * Nothing should read this shape directly. `publicPressKit()` and
 * `fullPressKit()` in `$lib/server/band/press-kit.ts` are the two ways out of
 * it, and which one a caller picks is the whole of the privacy boundary.
 */
export interface BandEpk {
	bookingContact?: EpkContact;
	managementContact?: EpkContact;
	prContact?: EpkContact;
	pressQuotes?: PressQuote[];
	achievements?: string[];
	videos?: BandVideo[];
}

export interface BacklineItem {
	instrument: string;
	details: string;
	provided: boolean;
}

export interface PressQuote {
	quote: string;
	publication: string;
	date?: string;
	url?: string;
}

// ---------------------------------------------------------------------------
// Press kit projections
// ---------------------------------------------------------------------------
// `BandEpk` mixes two audiences. Everything a stranger may read is in
// `PublicPressKit`; everything else reaches only whoever the band sends the
// package to. The projections themselves live in
// `$lib/server/band/press-kit.ts` — the types are here so components can name
// what they are handed without importing from `$lib/server/`.
// ---------------------------------------------------------------------------

/**
 * The marketing half: what `/directory/bands/{slug}` renders.
 *
 * Deliberately holds no contact of any kind. A band is reached through the
 * Turnstile-backed form, so no address is ever published for a scraper to take.
 */
export interface PublicPressKit {
	pressQuotes: PressQuote[];
	achievements: string[];
	/** Premium-authored, but public once it exists. */
	videos: BandVideo[];
}

/**
 * The advance half, plus the marketing half: what goes in the downloadable
 * package and what a premium microsite may render behind its own gate.
 */
export interface FullPressKit extends PublicPressKit {
	bookingContact?: EpkContact;
	managementContact?: EpkContact;
	prContact?: EpkContact;
}
