<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import { hasCapability } from '#lib/config.js';
	import { getStaffLayout } from '#lib/remote/layout.remote.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { withQuery } from '#lib/utils/with-query.js';
	import { groupViewCapability, groupViewQuery, type GroupView } from './views';

	let { view }: { view: GroupView } = $props();

	// Presentation only: each view's remotes guard on the same capability.
	const options: { value: GroupView; label: string }[] = [
		{ value: 'band', label: m.staff_groups_group_views_bands_label() },
		{ value: 'club', label: m.staff_groups_group_views_clubs_label() },
		{ value: 'committee', label: m.staff_groups_group_views_committees_label() }
	];

	// The staff layout already fetched this; the call dedupes to it.
	const caps = $derived((await getStaffLayout()).capabilities);
	const shown = $derived(options.filter((o) => hasCapability(caps, groupViewCapability[o.value])));
</script>

{#if shown.length > 1}
	<Select
		size="sm"
		aria-label={m.staff_kind_label()}
		value={view}
		onchange={(e: Event) =>
			goto(
				withQuery(
					resolve('staff/groups'),
					groupViewQuery((e.currentTarget as HTMLSelectElement).value as GroupView)
				)
			)}
	>
		{#each shown as o (o.value)}
			<option value={o.value}>{o.label}</option>
		{/each}
	</Select>
{/if}
