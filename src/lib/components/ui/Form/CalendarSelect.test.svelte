<!--
	Test harness for CalendarSelect: `minValue` / `maxValue` are `DateValue`s,
	which a spec cannot pass as plain props through `render`.
-->
<script lang="ts">
	import { parseDate, type DateValue } from '@internationalized/date';
	import CalendarSelect from './CalendarSelect.svelte';

	let {
		value = $bindable(''),
		min,
		max,
		unavailable = []
	}: {
		value?: string;
		min: string;
		max: string;
		/** ISO dates the picker must refuse. */
		unavailable?: string[];
	} = $props();

	const isDateUnavailable = (d: DateValue) => unavailable.includes(d.toString());
</script>

<CalendarSelect
	name="date"
	bind:value
	minValue={parseDate(min)}
	maxValue={parseDate(max)}
	{isDateUnavailable}
/>
