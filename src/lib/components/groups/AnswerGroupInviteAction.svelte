<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import { acceptGroupInvite, declineGroupInvite } from '#lib/remote/groups.remote.js';
	import { refreshAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';

	/**
	 * The other half of an invitation.
	 *
	 * `invite_only` had no door at all: `joinGroup` refuses with "someone in it
	 * has to add you", and where a `pending` row did exist the member index
	 * rendered it as a badge with nothing to press. Both ends are named here.
	 */
	let { groupId, groupName }: { groupId: string; groupName: string } = $props();

	const acceptFields = acceptGroupInvite.fields;
	const declineFields = declineGroupInvite.fields;

	// Not a failure: a revoked or already-answered invitation is an ordinary
	// state the remote reports in-band rather than throwing.
	function onAnswered(result: { success: boolean }, done: string) {
		if (result.success) toast.success(done);
		else toast.error(m.groups_answer_group_invite_toast());
		void refreshAll();
	}
</script>

<div class="flex shrink-0 gap-2">
	<Action
		action={acceptGroupInvite.for(groupId)}
		label={m.groups_accept_label()}
		aria-label={m.groups_answer_group_invite_accept_invitation_label({ groupName })}
		modalTitle={m.groups_join_title({ groupName })}
		submitLabel={m.groups_join_2_label()}
		variant="primary"
		size="sm"
		onsuccess={(result) =>
			onAnswered(result as { success: boolean }, `You have joined ${groupName}`)}
	>
		{#snippet form()}
			<input {...acceptFields.groupId.as('hidden', groupId)} />
			<p class="text-sm">
				{m.groups_answer_group_invite_ll_roster_see_announcements_can_text()}
			</p>
		{/snippet}
	</Action>
	<Action
		action={declineGroupInvite.for(groupId)}
		label={m.groups_decline_label()}
		aria-label={m.groups_answer_group_invite_decline_invitation_label({ groupName })}
		modalTitle={m.groups_answer_group_invite_decline_invitation_2_title()}
		submitLabel={m.groups_decline_label()}
		confirm={m.groups_answer_group_invite_confirm_body({ groupName })}
		variant="ghost"
		size="sm"
		onsuccess={(result) => onAnswered(result as { success: boolean }, 'Invitation declined')}
	>
		{#snippet form()}
			<input {...declineFields.groupId.as('hidden', groupId)} />
		{/snippet}
	</Action>
</div>
