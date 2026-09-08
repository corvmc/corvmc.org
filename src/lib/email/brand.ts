// ---------------------------------------------------------------------------
// Brand palette for email
// ---------------------------------------------------------------------------
// Email cannot read the site's CSS custom properties (they live in
// src/routes/layout.css as oklch and are resolved by the browser), so the
// hexes are repeated here for anything that renders HTML server-side.
//
// These are the design-system hexes from design-system/project/colors_and_type.css
// — the same values cmc-speaker.png is drawn in. Do not swap them for values
// converted from the live oklch theme without re-exporting the logo art too;
// the two sets differ enough to clash around the image.
//
// The static Postmark templates in postmark/templates/ hardcode the same hexes
// (they are plain files and cannot import this module). src/lib/email/brand.spec.ts
// asserts they stay in sync.
// ---------------------------------------------------------------------------

export const BRAND = {
	/** CMC Orange — primary actions */
	orange: '#e5771e',
	/** Lighter orange, dark-mode primary */
	orangeSoft: '#ff8c42',
	/** Goldenrod — tri-stripe middle */
	goldenrod: '#ffb500',
	/** Red-orange — tri-stripe bottom */
	redOrange: '#f84d13',
	/** Navy — display headings */
	navy: '#003b5c',
	/** Teal — wordmark, tri-stripe top, secondary actions */
	teal: '#00859b',
	/** Brown — card strokes, footer text and labels */
	brown: '#5a3d2b',
	/** Cream — page background */
	cream: '#fffbf6',
	/** Parchment — detail cards, footer background */
	parchment: '#ffe2cd',
	/** Soft yellow — quote/callout background */
	softYellow: '#fff7e2',
	/** Body copy, strong */
	ink: '#1a2330',
	/** Body copy, muted */
	muted: '#4a5563',

	dark: {
		bg: '#161b22',
		surface: '#262d38',
		panel: '#1d232c',
		text: '#e6dcd0',
		muted: '#b6b0a6',
		orange: '#ff8c42',
		teal: '#3eb5ca',
		/** Card and rule strokes. Brown itself is 1.6:1 on the dark panel. */
		stroke: '#9c7355'
	}
} as const;

/** Absolute URL for the email logo. Served from static/email/ — see Phase 1 of the email redesign. */
export const EMAIL_LOGO_URL = 'https://corvmc.org/email/cmc-speaker.png';

/** Tri-stripe, top to bottom. The brand's strongest recall device. */
export const TRI_STRIPE = [BRAND.teal, BRAND.goldenrod, BRAND.redOrange] as const;
