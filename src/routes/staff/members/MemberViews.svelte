<script lang="ts">
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import { hasCapability, type Capability } from '$lib/config';
	import { getStaffLayout } from '$lib/remote/layout.remote';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';

	type MemberView = 'all' | 'volunteers';

	let { active }: { active: MemberView } = $props();

	// Presentation only: each view's remotes guard on the same capability.
	const views: { key: MemberView; label: string; href: ResolvedPathname; cap: Capability }[] = [
		{ key: 'all', label: 'All', href: resolve('/staff/members'), cap: 'user.list' },
		{
			key: 'volunteers',
			label: 'Volunteers',
			href: resolve('/staff/members/volunteers'),
			cap: 'volunteer.read'
		}
	];

	// The staff layout already fetched this; the call dedupes to it.
	const caps = $derived((await getStaffLayout()).capabilities);
	const tabs = $derived(views.filter((v) => hasCapability(caps, v.cap)));
</script>

{#if tabs.length > 1}
	<TabBar class="mb-4" {active} {tabs} />
{/if}
