<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { createStaffExternalAct } from '$lib/remote/external-acts.remote';

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
	label="Add act"
	modalTitle="Add an external act"
	submitLabel="Add act"
	successToast="Act recorded"
	variant="primary"
	size="sm"
	onsuccess={() => invalidateAll()}
	onfailure={() => toast.error('Could not record the act')}
>
	{#snippet form()}
		<div class="space-y-4">
			<FormField field={fields.name} type="text" label="Name" placeholder="Touring Act" required />
			<FormField field={fields.hometown} type="text" label="Hometown" placeholder="Portland, OR" />
			<FormField
				field={fields.url}
				type="text"
				label="Their site"
				placeholder="https://…"
				description="Where their name should point on a public bill. CMC hosts no page for them, so without this their name renders as plain text."
			/>
			<FormField
				field={fields.bio}
				type="textarea"
				label="Notes for the record"
				description="Marketing material for when they come back. Not shown publicly."
			/>
		</div>
	{/snippet}
</Action>
