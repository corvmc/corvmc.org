<script lang="ts">
	/**
	 * The band's own thread. Every active member reads and writes it — unlike
	 * Messages next door, which is booking enquiries and is admins only.
	 */
	import { page } from '$app/state';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import GroupChat from '$lib/components/inbox/GroupChat.svelte';
	import { getBandLayoutContext } from '../layout-context';

	const bandLayout = getBandLayoutContext();
	const slug = $derived(page.params.slug!);
</script>

<PageHeader title="Chat" subtitle={bandLayout.current.band.name} />
<PageContent>
	<GroupChat {slug} viewerUserId={bandLayout.current.user.id} />
</PageContent>
