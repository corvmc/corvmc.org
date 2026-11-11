<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import { refreshAll } from '$app/navigation';
	import { setAnnouncementMute } from '#lib/remote/announcements.remote.js';

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
	data-testid="mute-announcements"
	label={muted
		? m.groups_mute_announcements_unmute_announcements_label()
		: m.groups_mute_announcements_mute_announcements_label()}
	successToast={muted
		? m.groups_mute_announcements_announcements_toast()
		: m.groups_mute_announcements_announcements_muted_toast()}
	variant="ghost"
	size="sm"
	onsuccess={() => refreshAll()}
>
	{#snippet form()}
		<input {...fields.groupId.as('hidden', groupId)} />
		<input {...fields.intent.as('hidden', muted ? 'unmute' : 'mute')} />
		<p class="py-2 text-sm">
			{muted
				? m.groups_mute_announcements_start_getting_announcements_from_a_text({ groupName })
				: m.groups_mute_announcements_stop_getting_emails_notifications_text({ groupName })}
		</p>
	{/snippet}
</Action>
