<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import PersonAccess from './PersonAccess.svelte';
	import PermissionHolders from './PermissionHolders.svelte';
	import { getAccessPage } from '$lib/remote/access.remote';

	// Two collections: one person's grants, and one grant's holders.
	let view = $state<'person' | 'permission'>('person');
	let person = $state<{ id: string; name: string; email: string } | null>(null);

	const data = $derived(await getAccessPage());
	const stats = $derived([
		{ title: 'Admins', value: data.summary.admins },
		{ title: 'Staff', value: data.summary.staff },
		{ title: 'Positions held', value: data.summary.positionsHeld },
		{ title: 'Clearances lapsing in 30 days', value: data.summary.lapsingSoon }
	]);
</script>

<PageHeader title="Access" subtitle="Who can do what" />
<PageContent>
	<div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
		{#each stats as stat (stat.title)}
			<StatCard title={stat.title} value={stat.value.toLocaleString()} size="sm" />
		{/each}
	</div>

	<TabBar
		tabs={[
			{ key: 'person', label: 'By person' },
			{ key: 'permission', label: 'By permission' }
		]}
		active={view}
		onchange={(key) => (view = key as typeof view)}
	/>

	{#if view === 'person'}
		<PersonAccess bind:person />
	{:else}
		<PermissionHolders certifications={data.certifications} />
	{/if}
</PageContent>
