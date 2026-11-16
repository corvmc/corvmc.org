<script lang="ts" module>
	export interface ListFilterOption<T extends string> {
		value: T;
		label: string;
	}
</script>

<script lang="ts" generics="TType extends string, TStatus extends string">
	import { untrack, type Snippet } from 'svelte';
	import { m } from '#lib/paraglide/messages.js';
	import FilterBar from './FilterBar.svelte';
	import Select from './Form/Select.svelte';
	import SearchInput from './Form/SearchInput.svelte';
	import DateFilter, { type DateRange } from './DateFilter.svelte';

	/**
	 * A staff list's filter row: a type select joined to the search box, the date
	 * range, and a status select. The page owns the values and the options; this
	 * owns the layout, the debounce, the active count, Clear, and going back to
	 * page 1 on any change. From today is the date range Clear returns to.
	 */
	let {
		types,
		typeAllLabel,
		typeLabel,
		type = $bindable(),
		searchPlaceholder,
		// Renamed: FilterBar's `search` snippet would shadow it in the markup.
		search: query = $bindable(),
		range = $bindable(),
		from = $bindable(),
		to = $bindable(),
		statuses,
		status = $bindable(),
		statusDot,
		onstatus,
		page = $bindable(),
		children
	}: {
		types: ListFilterOption<TType>[];
		/** The type select's empty option. */
		typeAllLabel: string;
		/** The type select's accessible name. */
		typeLabel: string;
		type: TType | '';
		searchPlaceholder: string;
		/** The debounced search text, as the query reads it. */
		search: string;
		range: DateRange;
		from: string;
		to: string;
		/** Each option's label carries its count. */
		statuses: ListFilterOption<TStatus>[];
		status: TStatus | '';
		/** When set, a dot on the status select, with this as its screen-reader text. */
		statusDot?: string;
		/** After the status changes, before the page resets: for a status that widens the dates. */
		onstatus?: (next: TStatus | '') => void;
		page: number;
		/** Filters of the page's own, ahead of the date range. */
		children?: Snippet;
	} = $props();

	// The box's own text, seeded once; `query` only moves when the debounce lands.
	let searchText = $state(untrack(() => query));

	const activeCount = $derived(
		(query ? 1 : 0) + (type ? 1 : 0) + (range !== 'from_today' ? 1 : 0) + (status ? 1 : 0)
	);

	function clear() {
		searchText = '';
		query = '';
		type = '';
		range = 'from_today';
		from = '';
		to = '';
		status = '';
		page = 1;
	}
</script>

<FilterBar {activeCount} onclear={clear} searchWidth="wide">
	{#snippet search()}
		<div class="join w-full">
			<Select
				size="sm"
				class="join-item w-auto shrink-0"
				aria-label={typeLabel}
				data-testid="type-filter"
				value={type}
				onchange={(e: Event) => {
					type = (e.currentTarget as HTMLSelectElement).value as TType | '';
					page = 1;
				}}
			>
				<option value="">{typeAllLabel}</option>
				{#each types as t (t.value)}
					<option value={t.value}>{t.label}</option>
				{/each}
			</Select>
			<SearchInput
				class="input join-item w-full input-sm"
				bind:value={searchText}
				placeholder={searchPlaceholder}
				onsearch={(q) => {
					query = q;
					page = 1;
				}}
			/>
		</div>
	{/snippet}
	{@render children?.()}
	<DateFilter bind:range bind:from bind:to onchange={() => (page = 1)} />
	<div class="indicator">
		{#if statusDot}
			<span class="indicator-item status status-error" data-testid="status-dot">
				<span class="sr-only">{statusDot}</span>
			</span>
		{/if}
		<Select
			size="sm"
			aria-label={m.ui_list_filters_status_label()}
			data-testid="status-filter"
			value={status}
			onchange={(e: Event) => {
				status = (e.currentTarget as HTMLSelectElement).value as TStatus | '';
				onstatus?.(status);
				page = 1;
			}}
		>
			<option value="">{m.ui_list_filters_all_statuses_label()}</option>
			{#each statuses as s (s.value)}
				<option value={s.value}>{s.label}</option>
			{/each}
		</Select>
	</div>
</FilterBar>
