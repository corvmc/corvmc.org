<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { revokeCertification } from '$lib/remote/volunteer.remote';

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
	label="Revoke"
	variant="ghost"
	size="xs"
	class="text-error"
	modalTitle="Revoke {name}?"
	submitLabel="Revoke"
	submitVariant="error"
	successToast="Clearance revoked"
	{onsuccess}
>
	{#snippet form()}
		<input type="hidden" name="id" value={id} />
		<input type="hidden" name="userId" value={userId} />
		<p class="text-sm">
			The record stays — the period it covered is history. They lose it from today, so shifts they
			already worked still read as cleared.
		</p>
		<FormField name="reason" label="Why" type="textarea" />
	{/snippet}
</Action>
