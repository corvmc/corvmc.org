<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import { page } from '$app/state';
	import { memberView } from './views';
	import MemberRoster from './MemberRoster.svelte';
	import VolunteerRoster from './VolunteerRoster.svelte';
	import TeacherRoster from './TeacherRoster.svelte';
	import InviteList from './InviteList.svelte';

	// Each view seeds its filters from the URL at mount, so a change of view remounts.
	const view = $derived(memberView(page.url.searchParams));
</script>

<PageHeader title={m.staff_members_title()} />

<PageContent>
	{#key view}
		{#if view === 'volunteer'}
			<VolunteerRoster />
		{:else if view === 'teacher'}
			<TeacherRoster />
		{:else if view === 'invited'}
			<InviteList />
		{:else}
			<MemberRoster />
		{/if}
	{/key}
</PageContent>
