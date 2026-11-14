<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import { hasCapability } from '#lib/config.js';
	import { getStaffLayout } from '#lib/remote/layout.remote.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { withQuery } from '#lib/utils/with-query.js';
	import { memberViewCapability, memberViewQuery, type MemberView } from './views';

	let { view }: { view: MemberView } = $props();

	// Presentation only: each view's remotes guard on the same capability.
	const options: { value: MemberView; label: string }[] = [
		{ value: 'all', label: m.staff_members_any_role_label() },
		{ value: 'volunteer', label: m.staff_members_role_volunteer_label() },
		{ value: 'teacher', label: m.staff_members_role_teacher_label() }
	];

	// The staff layout already fetched this; the call dedupes to it.
	const caps = $derived((await getStaffLayout()).capabilities);
	const shown = $derived(options.filter((o) => hasCapability(caps, memberViewCapability[o.value])));
	const value = $derived(view === 'volunteer' || view === 'teacher' ? view : 'all');
</script>

{#if shown.length > 1}
	<Select
		size="sm"
		aria-label={m.staff_members_role_filter_label()}
		{value}
		onchange={(e: Event) =>
			goto(
				withQuery(
					resolve('staff/members'),
					memberViewQuery((e.currentTarget as HTMLSelectElement).value as MemberView)
				)
			)}
	>
		{#each shown as o (o.value)}
			<option value={o.value}>{o.label}</option>
		{/each}
	</Select>
{/if}
