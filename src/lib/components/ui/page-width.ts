/**
 * The one place a page's column width is defined.
 *
 * `PageHeader` and `PageContent` both read it: the header is full-bleed and
 * sticky, so it has to constrain its own row to the same column the body uses
 * or the title sits outside the thing it labels (#1231).
 */
export const PAGE_WIDTH = {
	full: '',
	md: 'max-w-md mx-auto',
	'2xl': 'max-w-2xl mx-auto',
	'3xl': 'max-w-3xl mx-auto',
	// A single column of cards that still has to hold a table. Wider than 3xl
	// reads as a page with a hole in it; narrower makes the rows wrap.
	'5xl': 'max-w-5xl mx-auto'
} as const;

export type PageWidth = keyof typeof PAGE_WIDTH;
