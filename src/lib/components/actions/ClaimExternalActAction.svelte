<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SearchSelect from '#lib/components/ui/Form/SearchSelect.svelte';
	import { searchMembers } from '#lib/remote/reservations.remote.js';
	import { claimStaffExternalAct } from '#lib/remote/external-acts.remote.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

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
	label={m.staff_bands_acts_claim_external_act_claim_label()}
	modalTitle={m.staff_bands_acts_claim_external_act_modal_title({ actName })}
	submitLabel={m.staff_bands_acts_claim_external_act_submit_label()}
	successToast={m.staff_bands_acts_claim_external_act_success_toast()}
	variant="ghost"
	size="xs"
	onsuccess={(result) => {
		const slug = (result as { slug?: string } | undefined)?.slug;
		if (slug) goto(resolve(`band/${slug}`));
	}}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...fields.entryId.as('hidden', entryId)} />
			<p class="text-sm">
				{m.staff_bands_acts_claim_external_act_becomes_cmc_band_with_sl_text({ actName })}
			</p>
			<FormField
				field={claimStaffExternalAct.for(entryId).fields.ownerId}
				label={m.staff_owner_label()}
				required
			>
				<SearchSelect
					search={searchMembers}
					bind:value={owner}
					field={fields.ownerId}
					placeholder={m.staff_search_by_name_email_placeholder()}
				/>
			</FormField>
			<fieldset class="fieldset">
				<p class="text-subtle">
					{m.staff_bands_acts_claim_external_act_member_from_act_who_join_text()}
				</p>
			</fieldset>
		</div>
	{/snippet}
</Action>
