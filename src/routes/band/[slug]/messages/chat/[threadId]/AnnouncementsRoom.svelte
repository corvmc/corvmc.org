<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { untrack } from 'svelte';
	import { IconArrowLeft } from '@tabler/icons-svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import AnnouncementList from '#lib/components/groups/AnnouncementList.svelte';
	import MuteAnnouncementsAction from '#lib/components/groups/MuteAnnouncementsAction.svelte';
	import { markGroupChatSeen } from '#lib/remote/group-chat.remote.js';
	import type { getBandAnnouncementsPage } from '#lib/remote/announcements.remote.js';

	/**
	 * The band's Announcements thread, in the right pane of Messages (#3229).
	 *
	 * Owners and admins write here with the announcement composer: a draft, then
	 * Publish, which posts to the thread and emails the roster. Everyone else
	 * reads the published posts. `canManage` comes from the server, and the
	 * announcement remotes are the guard.
	 */
	let {
		threadId,
		bandId,
		bandName,
		data,
		backHref
	}: {
		threadId: string;
		bandId: string;
		bandName: string;
		data: Awaited<ReturnType<typeof getBandAnnouncementsPage>>;
		backHref: string;
	} = $props();

	// The same seen mark a chat topic sets, so the row's dot clears on opening.
	$effect(() => {
		const id = threadId;
		untrack(() => void markGroupChatSeen(id).catch(() => {}));
	});
</script>

<div class="flex h-full min-h-0 flex-col gap-4" data-testid="announcements-room">
	<div class="flex items-center justify-end gap-2">
		<Button
			href={backHref}
			variant="ghost"
			size="sm"
			shape="square"
			class="mr-auto lg:hidden"
			aria-label={m.ui_back_label()}
		>
			<IconArrowLeft size={18} />
		</Button>
		<!-- Null for a staff non-member, who has no roster row to mute. -->
		{#if data.notifyAnnouncements !== null}
			<MuteAnnouncementsAction
				groupId={bandId}
				groupName={bandName}
				muted={!data.notifyAnnouncements}
			/>
		{/if}
	</div>

	<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
		<AnnouncementList
			groupId={bandId}
			announcements={data.announcements}
			canManage={data.canManage}
		/>
	</div>
</div>
