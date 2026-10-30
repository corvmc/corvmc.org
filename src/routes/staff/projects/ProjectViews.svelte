<script lang="ts">
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import { hasCapability, type Capability } from '$lib/config';
	import { getStaffLayout } from '$lib/remote/layout.remote';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';

	type ProjectsView = 'projects' | 'productions';

	let { active }: { active: ProjectsView } = $props();

	// Presentation only: each view's remotes keep their own guard.
	const views: { key: ProjectsView; label: string; href: ResolvedPathname; cap: Capability }[] = [
		{ key: 'projects', label: 'Projects', href: resolve('/staff/projects'), cap: 'project.read' },
		{
			key: 'productions',
			label: 'Productions',
			href: resolve('/staff/projects/productions'),
			cap: 'event.manage'
		}
	];

	// The staff layout already fetched this; the call dedupes to it.
	const caps = $derived((await getStaffLayout()).capabilities);
	const tabs = $derived(views.filter((v) => hasCapability(caps, v.cap)));
</script>

{#if tabs.length > 1}
	<TabBar class="mb-4" {active} {tabs} />
{/if}
