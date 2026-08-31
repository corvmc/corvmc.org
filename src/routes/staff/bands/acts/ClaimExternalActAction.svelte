<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import SearchSelect from '$lib/components/ui/Form/SearchSelect.svelte';
	import { searchMembers } from '$lib/remote/reservations.remote';
	import { claimStaffExternalAct } from '$lib/remote/external-acts.remote';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';

	/**
	 * Turn an act into a CMC band, with the member who joined as its owner.
	 *
	 * Nothing merges: the act keeps the entry it already had, so every event it
	 * ever played comes with it — `event_band` pointed at that entry all along.
	 * The only column that changes is `groupId`.
	 */
	let { entryId, actName }: { entryId: string; actName: string } = $props();

	const fields = claimStaffExternalAct.fields;

	let owner = $state<{ id: string; name: string; email: string } | null>(null);
</script>

<Action
	action={claimStaffExternalAct.for(entryId)}
	label="Claim"
	modalTitle="Claim {actName}"
	submitLabel="Create the band"
	successToast="Band created"
	variant="ghost"
	size="xs"
	onsuccess={(result) => {
		const slug = (result as { slug?: string } | undefined)?.slug;
		if (slug) goto(resolve(`/band/${slug}`));
	}}
	onfailure={() => toast.error('Could not claim the act')}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...fields.entryId.as('hidden', entryId)} />
			<p class="text-sm">
				{actName} becomes a CMC band with a slug and a page. Everything already on its record — bio, links,
				and every event it played — comes with it.
			</p>
			<fieldset class="fieldset">
				<legend class="fieldset-legend">Owner</legend>
				<SearchSelect
					search={searchMembers}
					bind:value={owner}
					name="ownerId"
					placeholder="Search by name or email..."
				/>
				<p class="text-subtle">
					The member from the act who joined. They become the owner immediately.
				</p>
			</fieldset>
		</div>
	{/snippet}
</Action>
