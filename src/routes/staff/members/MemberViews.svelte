<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import TabBar from '#lib/components/ui/TabBar.svelte';
	import { hasCapability, type Capability } from '#lib/config.js';
	import { getStaffLayout } from '#lib/remote/layout.remote.js';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';

	type MemberView = 'all' | 'volunteers' | 'instructors' | 'invites';

	let { active }: { active: MemberView } = $props();

	// Presentation only: each view's remotes guard on the same capability.
	const views: { key: MemberView; label: string; href: ResolvedPathname; cap: Capability }[] = [
		{ key: 'all', label: m.staff_all(), href: resolve('/staff/members'), cap: 'user.list' },
		{
			key: 'volunteers',
			label: m.staff_volunteers(),
			href: resolve('/staff/members/volunteers'),
			cap: 'volunteer.read'
		},
		{
			key: 'instructors',
			label: m.staff_members_member_views_instructors(),
			href: resolve('/staff/members/instructors'),
			cap: 'instructor.read'
		},
		{
			key: 'invites',
			label: m.staff_members_member_views_invites(),
			href: resolve('/staff/members/invites'),
			cap: 'user.invite'
		}
	];

	// The staff layout already fetched this; the call dedupes to it.
	const caps = $derived((await getStaffLayout()).capabilities);
	const tabs = $derived(views.filter((v) => hasCapability(caps, v.cap)));
</script>

{#if tabs.length > 1}
	<TabBar class="mb-4" {active} {tabs} />
{/if}
