<script lang="ts">
	import { getActiveCertifications, grantCertification } from '$lib/remote/volunteer.remote';
	import Action from '$lib/components/shared/Action.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import { clubToday } from '$lib/config';

	/**
	 * The "Grant" button, with the catalogue it needs.
	 *
	 * The catalogue only ever feeds this control — whether to offer granting at
	 * all, and the options once the modal is open — so it has no business
	 * holding up the member's own certification list. Loading it here keeps the
	 * panel to one query, per `custom/no-concurrent-remote-queries`, and renders
	 * nothing until there is something to grant.
	 */
	let { userId, onsuccess }: { userId: string; onsuccess: () => void } = $props();
</script>

{#await getActiveCertifications() then catalog}
	{#if catalog.length > 0}
		<Action
			action={grantCertification}
			label="Grant"
			variant="default"
			size="sm"
			modalTitle="Grant a certification"
			submitLabel="Grant"
			successToast="Certification granted"
			{onsuccess}
		>
			{#snippet form()}
				<input type="hidden" name="userId" value={userId} />
				<FormField
					name="certificationId"
					label="Certification"
					type="select"
					options={catalog.map((c) => ({ value: c.id, label: c.name }))}
				/>
				<FormField
					name="grantedOn"
					label="Granted on"
					type="date"
					value={clubToday()}
					max={clubToday()}
					description="Expiry is worked out from this date and locked in now — later edits to the catalog won't move it."
				/>
				<FormField
					name="reference"
					label="Card or licence number"
					type="text"
					description="For an external card. Leave blank for a CMC clearance."
				/>
				<FormField name="notes" label="Notes" type="textarea" />
			{/snippet}
		</Action>
	{/if}
{/await}
