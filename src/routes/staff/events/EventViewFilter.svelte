<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import { hasCapability } from '#lib/config.js';
	import { getStaffLayout } from '#lib/remote/layout.remote.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { withQuery } from '#lib/utils/with-query.js';
	import { eventViewCapability, eventViewQuery, type EventView } from './views';

	let { view }: { view: EventView } = $props();

	// Presentation only: each view's remotes guard for themselves.
	const options: { value: EventView; label: string }[] = [
		{ value: 'listings', label: m.staff_events_view_listings_label() },
		{ value: 'productions', label: m.staff_projects_project_views_productions_label() },
		{ value: 'venues', label: m.staff_venues_venues_label() },
		{ value: 'vendors', label: m.staff_events_view_vendors_label() }
	];

	// The staff layout already fetched this; the call dedupes to it.
	const caps = $derived((await getStaffLayout()).capabilities);
	const shown = $derived(options.filter((o) => hasCapability(caps, eventViewCapability[o.value])));
</script>

{#if shown.length > 1}
	<Select
		size="sm"
		aria-label={m.staff_events_view_label()}
		data-testid="event-view"
		value={view}
		onchange={(e: Event) =>
			goto(
				withQuery(
					resolve('staff/events'),
					eventViewQuery((e.currentTarget as HTMLSelectElement).value as EventView)
				)
			)}
	>
		{#each shown as o (o.value)}
			<option value={o.value}>{o.label}</option>
		{/each}
	</Select>
{/if}
