import { createContext } from 'svelte';
import { datePresets, type DateRange } from '#lib/components/ui/DateFilter.svelte';

export type Status = 'confirmed' | 'payment_due' | 'waitlisted' | 'cancelled';
export type Booker = 'user' | 'group' | 'production' | 'event_listing';
export const statuses: Status[] = ['confirmed', 'payment_due', 'waitlisted', 'cancelled'];
export const bookers: Booker[] = ['user', 'group', 'production', 'event_listing'];
const ranges: DateRange[] = [...datePresets, 'custom'];

/** The URL keys these filters own; any other key on the address is left alone. */
export const FILTER_KEYS = ['q', 'booker', 'date', 'from', 'to', 'status', 'page'];

/**
 * The practice-space list's filters, owned by the layout so the list and the
 * open reservation beside it read one copy: the list queries with it, and the
 * reservation's close control returns to it.
 */
export class ReservationFilters {
	search = $state('');
	booker = $state<Booker | ''>('');
	range = $state<DateRange>('from_today');
	from = $state('');
	to = $state('');
	status = $state<Status | ''>('');
	page = $state(1);

	constructor(params: URLSearchParams) {
		const pick = <T extends string>(list: readonly T[], key: string) =>
			list.find((v) => v === params.get(key));
		this.search = params.get('q') ?? '';
		this.booker = pick(bookers, 'booker') ?? '';
		this.range = pick(ranges, 'date') ?? 'from_today';
		this.from = params.get('from') ?? '';
		this.to = params.get('to') ?? '';
		this.status = pick(statuses, 'status') ?? '';
		this.page = Number(params.get('page')) || 1;
	}

	/** The remote query's argument. */
	get query() {
		const custom = this.range === 'custom';
		return {
			search: this.search || undefined,
			bookerType: this.booker || undefined,
			range: this.range,
			dateFrom: custom && this.from ? this.from : undefined,
			dateTo: custom && this.to ? this.to : undefined,
			status: this.status || undefined,
			page: this.page
		};
	}

	/** The URL query string, without `?`; empty for the default view. */
	get urlQuery(): string {
		const q = this.query;
		const pairs: [string, string | undefined][] = [
			['q', q.search],
			['booker', q.bookerType],
			['date', q.range === 'from_today' ? undefined : q.range],
			['from', q.dateFrom],
			['to', q.dateTo],
			['status', q.status],
			['page', q.page > 1 ? String(q.page) : undefined]
		];
		return pairs
			.filter((p): p is [string, string] => !!p[1])
			.map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
			.join('&');
	}
}

/** The current URL's filter keys, in the same form as `urlQuery`, to tell whether it is stale. */
export function urlFilterQuery(url: URL): string {
	return [...url.searchParams]
		.filter(([k]) => FILTER_KEYS.includes(k))
		.map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
		.join('&');
}

/** The reservation one step above (-1) or below (1) the open one; none past either end. */
export function adjacentId(ids: string[], openId: string, step: -1 | 1): string | undefined {
	const at = ids.indexOf(openId);
	return at === -1 ? undefined : ids[at + step];
}

export const [getReservationFilters, setReservationFilters] = createContext<ReservationFilters>();
