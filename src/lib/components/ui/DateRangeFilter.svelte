<script lang="ts">
	/**
	 * A from/to date range in a `FilterBar`, with the periods a report is
	 * actually asked for as one click.
	 *
	 * The presets are why this exists rather than a third copy of two date
	 * inputs: typing two dates for "last year" is where a wrong year slips in,
	 * and an off-by-one there is a report that looks right.
	 */
	// Native `<input type="date">` rather than a calendar widget: it is what
	// every other filter bar here uses, and the picker is the platform's.
	import FilterBar from './FilterBar.svelte';
	import Button from './Button.svelte';

	let {
		from = $bindable(),
		to = $bindable(),
		defaultFrom = '',
		defaultTo = '',
		onchange
	}: {
		/** `YYYY-MM-DD`, inclusive. Empty string means unbounded. */
		from: string;
		to: string;
		/** What Clear restores, and what does not count towards the active badge. */
		defaultFrom?: string;
		defaultTo?: string;
		/** Fired after any change, for a page that has to reset pagination. */
		onchange?: () => void;
	} = $props();

	const uid = $props.id();

	const thisYear = new Date().getFullYear();

	// End-of-year is spelled out rather than computed: `new Date(y, 11, 31)` is
	// local time, and this value is read back as a club-time date string.
	const presets = [
		{ label: 'This year', from: `${thisYear}-01-01`, to: '' },
		{ label: 'Last year', from: `${thisYear - 1}-01-01`, to: `${thisYear - 1}-12-31` },
		{ label: 'All time', from: '', to: '' }
	];

	const activeFilterCount = $derived((from !== defaultFrom ? 1 : 0) + (to !== defaultTo ? 1 : 0));

	function apply(nextFrom: string, nextTo: string) {
		from = nextFrom;
		to = nextTo;
		onchange?.();
	}

	function isActive(preset: { from: string; to: string }): boolean {
		return preset.from === from && preset.to === to;
	}
</script>

<FilterBar activeCount={activeFilterCount} onclear={() => apply(defaultFrom, defaultTo)}>
	{#snippet search()}
		<div class="flex flex-wrap items-center gap-2">
			<label class="text-muted" for="range-from-{uid}">From</label>
			<input
				id="range-from-{uid}"
				type="date"
				class="input input-sm"
				value={from}
				onchange={(e) => apply(e.currentTarget.value, to)}
			/>
			<label class="text-muted" for="range-to-{uid}">To</label>
			<input
				id="range-to-{uid}"
				type="date"
				class="input input-sm"
				value={to}
				onchange={(e) => apply(from, e.currentTarget.value)}
			/>
		</div>
	{/snippet}

	{#each presets as preset (preset.label)}
		<Button
			size="sm"
			variant={isActive(preset) ? 'primary' : 'ghost'}
			onclick={() => apply(preset.from, preset.to)}
		>
			{preset.label}
		</Button>
	{/each}
</FilterBar>
