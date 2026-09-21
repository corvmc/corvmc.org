<script lang="ts">
	/**
	 * Silence one room without silencing the group.
	 *
	 * `group_member.notifyAnnouncements` mutes six groups but not one noisy
	 * topic, because a room is a thread — so this writes `inbox_group_read`,
	 * already keyed on that pair. A muted room stops counting as unread too
	 * (#1309).
	 */
	import { IconBell, IconBellOff } from '@tabler/icons-svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { setRoomMute } from '$lib/remote/group-chat.remote';

	let {
		threadId,
		roomName,
		muted
	}: {
		threadId: string;
		roomName: string;
		muted: boolean;
	} = $props();

	const fields = setRoomMute.fields;
</script>

<Action
	action={setRoomMute}
	label={muted ? 'Unmute' : 'Mute'}
	iconOnly
	modalTitle={muted ? `Unmute ${roomName}` : `Mute ${roomName}`}
	submitLabel={muted ? 'Unmute' : 'Mute'}
	successToast={muted ? 'Room unmuted' : 'Room muted'}
	variant="ghost"
	size="sm"
>
	{#snippet icon()}{#if muted}<IconBellOff size={16} />{:else}<IconBell size={16} />{/if}{/snippet}

	{#snippet form()}
		<input {...fields.threadId.as('hidden', threadId)} />
		<input {...fields.intent.as('hidden', muted ? 'unmute' : 'mute')} />
		<p class="py-2 text-sm">
			{muted
				? `Start hearing about ${roomName} again?`
				: `Stop being notified about ${roomName}? Posts still appear here, and the room stops counting as unread.`}
		</p>
	{/snippet}
</Action>
