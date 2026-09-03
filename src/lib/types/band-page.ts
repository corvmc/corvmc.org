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

export interface MerchItem {
	title: string;
	url: string;
	imageKey?: string;
	price?: string;
}

export type Block =
	| {
			id: string;
			type: 'hero';
			imageKey: string;
			headline?: string;
			subtitle?: string;
			cssClass?: string;
	  }
	| { id: string; type: 'bio'; content: string; cssClass?: string }
	| { id: string; type: 'links'; style: 'buttons' | 'icons' | 'list'; cssClass?: string }
	| { id: string; type: 'members'; showPositions: boolean; cssClass?: string }
	| { id: string; type: 'events'; limit?: number; showPast?: boolean; cssClass?: string }
	| { id: string; type: 'gallery'; imageKeys: string[]; downloadable?: boolean; cssClass?: string }
	| { id: string; type: 'embed'; platform: string; url: string; cssClass?: string }
	| { id: string; type: 'press'; cssClass?: string }
	| { id: string; type: 'achievements'; cssClass?: string }
	| { id: string; type: 'contact'; showForm?: boolean; cssClass?: string }
	| { id: string; type: 'tech_rider'; cssClass?: string }
	| { id: string; type: 'custom_html'; content: string; cssClass?: string }
	| { id: string; type: 'merch'; items: MerchItem[]; cssClass?: string }
	| { id: string; type: 'spacer'; height: 'sm' | 'md' | 'lg'; cssClass?: string };

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
