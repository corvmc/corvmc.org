<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { revokeCertification } from '#lib/remote/volunteer.remote.js';

	/** Revoke one clearance grant, through the volunteer domain's own remote. */
	let {
		id,
		userId,
		name,
		onsuccess
	}: { id: string; userId: string; name: string; onsuccess: () => void } = $props();
</script>

<Action
	action={revokeCertification.for(id)}
	label={m.staff_access_revoke_clearance_revoke_label()}
	variant="ghost"
	size="xs"
	class="text-error"
	modalTitle={m.staff_access_revoke_clearance_modal_title({ name })}
	submitLabel={m.staff_access_revoke_clearance_revoke_label()}
	submitVariant="error"
	successToast={m.staff_access_revoke_clearance_success_toast()}
	{onsuccess}
>
	{#snippet form()}
		<input {...revokeCertification.for(id).fields.id.as('hidden', id)} />
		<input {...revokeCertification.for(id).fields.userId.as('hidden', userId)} />
		<p class="text-sm">
			{m.staff_access_revoke_clearance_record_stays_period_covered_hi_text()}
		</p>
		<FormField
			field={revokeCertification.for(id).fields.reason}
			label={m.staff_why_label()}
			type="textarea"
		/>
	{/snippet}
</Action>
