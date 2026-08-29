<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import SearchSelect from '$lib/components/ui/Form/SearchSelect.svelte';
	import { searchMembers } from '$lib/remote/reservations.remote';
	import { assignGroupLeader } from '$lib/remote/groups.remote';
	import { invalidateAll } from '$app/navigation';

	/**
	 * Appoint, or replace, the member who runs this program.
	 *
	 * Not a transfer: a band's owner hands their band on themselves, scoped to
	 * their own row, but a program leader who has gone quiet cannot be the one to
	 * name their replacement. So this needs no participation from whoever holds
	 * the seat — and it works on an empty one, which is the normal state between
	 * a leader stepping down and staff appointing the next.
	 */
	let { groupId, hasLeader }: { groupId: string; hasLeader: boolean } = $props();

	const fields = assignGroupLeader.fields;

	let leader = $state<{ id: string; name: string; email: string } | null>(null);
</script>

<Action
	action={assignGroupLeader}
	label={hasLeader ? 'Change leader' : 'Appoint leader'}
	modalTitle={hasLeader ? 'Change leader' : 'Appoint leader'}
	submitLabel={hasLeader ? 'Change leader' : 'Appoint leader'}
	successToast="Leader appointed"
	variant={hasLeader ? 'ghost' : 'primary'}
	size="sm"
	onsuccess={() => invalidateAll()}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...fields.groupId.as('hidden', groupId)} />

			<SearchSelect
				search={searchMembers}
				bind:value={leader}
				name="userId"
				placeholder="Search by name or email..."
			/>

			<p class="text-subtle">
				{#if hasLeader}
					The current leader is demoted to admin and keeps their place on the roster.
				{:else}
					They become the owner immediately — there is nothing for them to accept.
				{/if}
			</p>
		</div>
	{/snippet}
</Action>
