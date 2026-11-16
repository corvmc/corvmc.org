<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * Silence one room without silencing the group.
	 *
	 * `group_member.notifyAnnouncements` mutes six groups but not one noisy
	 * topic, because a room is a thread — so this writes `inbox_group_read`,
	 * already keyed on that pair. A muted room stops counting as unread too
	 * (#1309).
	 */
	import { IconBell, IconBellOff } from '@tabler/icons-svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import { setRoomMute } from '#lib/remote/group-chat.remote.js';

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
	label={muted ? m.inbox_mute_room_unmute_label() : m.inbox_mute_room_mute_label()}
	iconOnly
	modalTitle={muted
		? m.inbox_mute_room_unmute_2_title({ roomName })
		: m.inbox_mute_room_mute_2_title({ roomName })}
	submitLabel={muted ? m.inbox_mute_room_unmute_label() : m.inbox_mute_room_mute_label()}
	successToast={muted
		? m.inbox_mute_room_room_unmuted_toast()
		: m.inbox_mute_room_room_muted_toast()}
	variant="ghost"
	size="sm"
>
	{#snippet icon()}{#if muted}<IconBellOff size={16} />{:else}<IconBell size={16} />{/if}{/snippet}

	{#snippet form()}
		<input {...fields.threadId.as('hidden', threadId)} />
		<input {...fields.intent.as('hidden', muted ? 'unmute' : 'mute')} />
		<p class="py-2 text-sm">
			{muted
				? m.inbox_mute_room_start_hearing_about_again_text({ roomName })
				: m.inbox_mute_room_stop_being_notified_about_posts_text({ roomName })}
		</p>
	{/snippet}
</Action>
