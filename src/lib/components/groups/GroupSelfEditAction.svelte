<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { updateMyGroupMembership } from '$lib/remote/groups.remote';

	/**
	 * A member editing their own row: their stage name only. Role and position
	 * are a chair's to set, through `GroupMemberEditAction`.
	 */
	let {
		slug,
		alias,
		onchanged
	}: {
		slug: string;
		alias: string | null;
		onchanged: () => void;
	} = $props();

	const { fields } = updateMyGroupMembership;
</script>

<Action
	action={updateMyGroupMembership}
	label="Edit"
	aria-label="Edit your membership"
	modalTitle="Your membership"
	variant="ghost"
	size="xs"
	successToast="Saved"
	onsuccess={onchanged}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...fields.slug.as('hidden', slug)} />
			<FormField
				field={fields.alias}
				type="text"
				label="Display name"
				value={alias ?? ''}
				maxlength="100"
				description="How you're credited on this roster. Leave blank to use your account name. A chair sets your position."
			/>
		</div>
	{/snippet}
</Action>
