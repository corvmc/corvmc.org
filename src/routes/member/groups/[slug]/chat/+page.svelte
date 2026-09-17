<script lang="ts">
	/** The club or committee's own thread, read and written by every member. */
	import { page } from '$app/state';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import GroupChat from '$lib/components/inbox/GroupChat.svelte';
	import { getMemberLayoutContext } from '../../../layout-context';

	const memberLayout = getMemberLayoutContext();
	const slug = $derived(page.params.slug!);
</script>

<PageHeader title="Chat" backHref="/member/groups/{slug}" />
<PageContent>
	<GroupChat {slug} viewerUserId={memberLayout.current.user.id} />
</PageContent>
