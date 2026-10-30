<script lang="ts">
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import { hasCapability, type Capability } from '$lib/config';
	import { getStaffLayout } from '$lib/remote/layout.remote';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';

	type GroupView = 'bands' | 'clubs' | 'committees';

	let { active }: { active: GroupView } = $props();

	// Presentation only: each view's remotes keep their own guard.
	const views: { key: GroupView; label: string; href: ResolvedPathname; cap: Capability }[] = [
		{ key: 'bands', label: 'Bands', href: resolve('/staff/groups'), cap: 'band.read' },
		{ key: 'clubs', label: 'Clubs', href: resolve('/staff/groups/clubs'), cap: 'group.read' },
		{
			key: 'committees',
			label: 'Committees',
			href: resolve('/staff/groups/committees'),
			cap: 'committee.reviewApplications'
		}
	];

	// The staff layout already fetched this; the call dedupes to it.
	const caps = $derived((await getStaffLayout()).capabilities);
	const tabs = $derived(views.filter((v) => hasCapability(caps, v.cap)));
</script>

{#if tabs.length > 1}
	<TabBar class="mb-4" {active} {tabs} />
{/if}
