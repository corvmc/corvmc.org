<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { updateMyGroupMembership } from '$lib/remote/groups.remote';

	/**
	 * A member editing their own row: their stage name, and what they do here.
	 *
	 * The counterpart to `GroupMemberEditAction`, which carries `role` and not
	 * `alias` for the same reason this carries `alias` and not `role`.
	 */
	let {
		slug,
		alias,
		position,
		kindLabel,
		onchanged
	}: {
		slug: string;
		alias: string | null;
		position: string | null;
		/** `club` or `committee` — only the position placeholder reads it. */
		kindLabel: string;
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
				description="How you're credited on this roster. Leave blank to use your account name."
			/>
			<FormField
				field={fields.position}
				type="text"
				label="Position"
				value={position ?? ''}
				maxlength="100"
				placeholder="e.g. {kindLabel === 'committee' ? 'Secretary' : 'Chart librarian'}"
				description="What you do here. A leader can change this too."
			/>
		</div>
	{/snippet}
</Action>
