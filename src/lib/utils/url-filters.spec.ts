import { describe, it, expect } from 'vitest';
import { oneOf, parseFields, positiveInt, text, toHref } from './url-filters';

const views = ['review', 'calendar', 'rejected', 'all'] as const;

const fields = {
	view: oneOf(views, 'review'),
	source: text<'cmc' | 'band' | 'community' | ''>(),
	page: positiveInt(1)
};

// A `type`, not an `interface`: only a type alias gets the implicit index
// signature that `Record<string, unknown>` asks for.
type Filters = {
	view: (typeof views)[number];
	source: 'cmc' | 'band' | 'community' | '';
	page: number;
};

const parse = (qs: string) => parseFields<Filters>(fields, new URLSearchParams(qs));
const href = (values: Filters) => toHref('/staff/events', fields, values);

describe('oneOf', () => {
	it('accepts a listed value', () => {
		expect(parse('view=rejected').view).toBe('rejected');
	});

	// The query string is user input. A value no branch handles must not reach
	// the filter — it selects the default view instead.
	it('falls back for anything unlisted', () => {
		expect(parse('view=nonsense').view).toBe('review');
		expect(parse('').view).toBe('review');
	});
});

describe('positiveInt', () => {
	it('reads a page number', () => {
		expect(parse('page=4').page).toBe(4);
	});

	// The hand-written form was `Number(raw ?? '1') || 1`, which caught 0 only
	// because it is falsy, and passed -3 straight through to the query's offset.
	it.each([
		['page=0', 1],
		['page=-3', 1],
		['page=abc', 1],
		['page=', 1],
		['', 1]
	])('falls back for %s', (qs, expected) => {
		expect(parse(qs).page).toBe(expected);
	});

	it('truncates a fractional page', () => {
		expect(parse('page=2.7').page).toBe(2);
	});
});

describe('toHref', () => {
	it('leaves defaults out so a clean view has a clean URL', () => {
		expect(href({ view: 'review', source: '', page: 1 })).toBe('/staff/events');
	});

	it('emits only the fields that differ from their default', () => {
		expect(href({ view: 'all', source: '', page: 3 })).toBe('/staff/events?view=all&page=3');
	});

	// Declaration order, not touch order — otherwise the same view has two
	// addresses depending on which control the staffer reached for first.
	it('orders keys by declaration, not by assignment', () => {
		expect(href({ view: 'all', source: 'band', page: 2 })).toBe(
			'/staff/events?view=all&source=band&page=2'
		);
	});

	it('percent-encodes values', () => {
		expect(toHref('/x', { q: text() }, { q: 'a b&c' })).toBe('/x?q=a%20b%26c');
	});

	it('round-trips through parse', () => {
		const values = { view: 'rejected' as const, source: 'cmc' as const, page: 7 };
		const url = new URL(href(values), 'https://example.test');
		expect(parseFields(fields, url.searchParams)).toEqual(values);
	});
});
