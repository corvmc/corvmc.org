<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import StatCard from '#lib/components/ui/StatCard.svelte';
	import TabBar from '#lib/components/ui/TabBar.svelte';
	import PersonAccess from './PersonAccess.svelte';
	import PermissionHolders from './PermissionHolders.svelte';
	import { getAccessPage } from '#lib/remote/access.remote.js';

	// Two collections: one person's grants, and one grant's holders.
	let view = $state<'person' | 'permission'>('person');
	let person = $state<{ id: string; name: string; email: string } | null>(null);

	const data = $derived(await getAccessPage());
	const stats = $derived([
		{ title: m.staff_access_admins_title(), value: data.summary.admins },
		{ title: m.staff_staff_title(), value: data.summary.staff },
		{ title: m.staff_access_positions_held_title(), value: data.summary.positionsHeld },
		{ title: m.staff_access_clearances_lapsing_30_days_title(), value: data.summary.lapsingSoon }
	]);
</script>

<PageHeader title={m.staff_access_access_title()} subtitle={m.staff_access_subtitle_body()}>
	<TabBar
		tabs={[
			{ key: 'person', label: m.staff_access_by_person_label() },
			{ key: 'permission', label: m.staff_access_by_permission_label() }
		]}
		active={view}
		onchange={(key) => (view = key as typeof view)}
	/>
</PageHeader>
<PageContent>
	<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
		{#each stats as stat (stat.title)}
			<StatCard title={stat.title} value={stat.value.toLocaleString()} size="sm" />
		{/each}
	</div>

	{#if view === 'person'}
		<PersonAccess bind:person />
	{:else}
		<PermissionHolders certifications={data.certifications} />
	{/if}
</PageContent>
