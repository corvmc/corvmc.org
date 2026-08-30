<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { setAnnouncementMute } from '$lib/remote/announcements.remote';

	/**
	 * Silence one group without silencing the rest.
	 *
	 * The global `announcement` notification preference cannot express this — a
	 * member of six groups needs to mute one — so it writes
	 * `group_member.notifyAnnouncements` on their own roster row.
	 *
	 * It is also the landing point for the link in every announcement email.
	 * Those ride the transactional stream, so a member who has hit "unsubscribe
	 * from all" for marketing still gets them; the reason that is defensible is
	 * that leaving or muting is one visible click from the message, rather than a
	 * setting somewhere. Mount-agnostic, like the rest of these.
	 */
	let {
		groupId,
		groupName,
		muted
	}: {
		groupId: string;
		groupName: string;
		muted: boolean;
	} = $props();

	const fields = setAnnouncementMute.fields;
</script>

<Action
	action={setAnnouncementMute}
	label={muted ? 'Unmute announcements' : 'Mute announcements'}
	successToast={muted ? 'Announcements on' : 'Announcements muted'}
	variant="ghost"
	size="sm"
	onsuccess={() => invalidateAll()}
	onfailure={() => toast.error('Failed to save')}
>
	{#snippet form()}
		<input {...fields.groupId.as('hidden', groupId)} />
		<input {...fields.intent.as('hidden', muted ? 'unmute' : 'mute')} />
		<p class="py-2 text-sm">
			{muted
				? `Start getting announcements from ${groupName} again?`
				: `Stop getting emails and notifications from ${groupName}? Posts still appear on its page.`}
		</p>
	{/snippet}
</Action>
