<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { getActiveCertifications, grantCertification } from '$lib/remote/volunteer.remote';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { clubToday } from '$lib/config';
	import { Latest } from '$lib/latest.svelte';

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

	// Not `{#await}`: a refresh would re-pend it and unmount the open modal (#2356).
	const catalog = new Latest(() => getActiveCertifications());
	$effect(() => {
		if (catalog.error) throw catalog.error.e;
	});
</script>

{#if catalog.current?.length}
	{@const options = catalog.current.map((c) => ({ value: c.id, label: c.name }))}
	<Action
		action={grantCertification}
		label={m.staff_grant()}
		variant="default"
		size="sm"
		modalTitle={m.staff_members_id_panels_grant_certification_modal_title()}
		submitLabel={m.staff_grant()}
		successToast={m.staff_members_id_panels_grant_certification_success_toast()}
		{onsuccess}
	>
		{#snippet form()}
			<input {...grantCertification.fields.userId.as('hidden', userId)} />
			<FormField
				field={grantCertification.fields.certificationId}
				label={m.staff_members_id_panels_grant_certification_certification()}
				type="select"
				{options}
			/>
			<FormField
				field={grantCertification.fields.grantedOn}
				label={m.staff_granted()}
				type="date"
				value={clubToday()}
				max={clubToday()}
				description={m.staff_members_id_panels_grant_certification_expiry_worked_ou()}
			/>
			<FormField
				field={grantCertification.fields.reference}
				label={m.staff_members_id_panels_grant_certification_card_licence_num()}
				type="text"
				description={m.staff_members_id_panels_grant_certification_external_card_le()}
			/>
			<FormField field={grantCertification.fields.notes} label={m.staff_notes()} type="textarea" />
		{/snippet}
	</Action>
{/if}
