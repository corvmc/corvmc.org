<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { refreshAll } from '$app/navigation';
	import { createStaffExternalAct } from '#lib/remote/external-acts.remote.js';

	/**
	 * Stub an act when booking it.
	 *
	 * There is no visibility field, deliberately: an external act is forced
	 * hidden by the service, so "public" is not a state a form could put it in.
	 */
	const fields = createStaffExternalAct.fields;
</script>

<Action
	action={createStaffExternalAct}
	label={m.staff_bands_acts_create_external_act_add_act()}
	modalTitle={m.staff_bands_acts_create_external_act_modal_title()}
	submitLabel={m.staff_bands_acts_create_external_act_add_act()}
	successToast={m.staff_bands_acts_create_external_act_success_toast()}
	variant="primary"
	size="sm"
	onsuccess={() => refreshAll()}
>
	{#snippet form()}
		<div class="space-y-4">
			<FormField
				field={fields.name}
				type="text"
				label={m.staff_name()}
				placeholder={m.staff_bands_acts_create_external_act_touring_act()}
				required
			/>
			<FormField
				field={fields.hometown}
				type="text"
				label={m.staff_hometown()}
				placeholder={m.staff_bands_acts_create_external_act_portland()}
			/>
			<FormField
				field={fields.url}
				type="text"
				label={m.staff_their_site()}
				placeholder={m.staff_bands_acts_create_external_act_https()}
				description={m.staff_bands_acts_create_external_act_where_their_name_should()}
			/>
			<FormField
				field={fields.bio}
				type="textarea"
				label={m.staff_bands_acts_create_external_act_notes_record()}
				description={m.staff_bands_acts_create_external_act_marketing_material_when()}
			/>
		</div>
	{/snippet}
</Action>
