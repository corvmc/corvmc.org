<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import { acceptGroupInvite, declineGroupInvite } from '$lib/remote/groups.remote';
	import { invalidateAll } from '$app/navigation';
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
		else toast.error('That invitation is no longer open.');
		void invalidateAll();
	}
</script>

<div class="flex shrink-0 gap-2">
	<Action
		action={acceptGroupInvite.for(groupId)}
		label="Accept"
		aria-label={`Accept the invitation to ${groupName}`}
		modalTitle="Join {groupName}"
		submitLabel="Join"
		variant="primary"
		size="sm"
		onsuccess={(result) =>
			onAnswered(result as { success: boolean }, `You have joined ${groupName}`)}
		onfailure={() => toast.error('Failed to accept')}
	>
		{#snippet form()}
			<input {...acceptFields.groupId.as('hidden', groupId)} />
			<p class="text-sm">
				You'll be on the roster, see the announcements, and can leave whenever you like.
			</p>
		{/snippet}
	</Action>
	<Action
		action={declineGroupInvite.for(groupId)}
		label="Decline"
		aria-label={`Decline the invitation to ${groupName}`}
		modalTitle="Decline invitation"
		submitLabel="Decline"
		confirm={`Decline the invitation to ${groupName}? They would have to invite you again.`}
		variant="ghost"
		size="sm"
		onsuccess={(result) => onAnswered(result as { success: boolean }, 'Invitation declined')}
		onfailure={() => toast.error('Failed to decline')}
	>
		{#snippet form()}
			<input {...declineFields.groupId.as('hidden', groupId)} />
		{/snippet}
	</Action>
</div>
