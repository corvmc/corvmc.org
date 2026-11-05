<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { updateMyGroupMembership } from '#lib/remote/groups.remote.js';

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
	label={m.groups_edit()}
	aria-label={m.groups_group_self_edit_aria_label()}
	modalTitle={m.groups_group_self_edit_modal_title()}
	variant="ghost"
	size="xs"
	successToast={m.groups_saved()}
	onsuccess={onchanged}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...fields.slug.as('hidden', slug)} />
			<FormField
				field={fields.alias}
				type="text"
				label={m.groups_group_self_edit_display_name()}
				value={alias ?? ''}
				maxlength="100"
				description={m.groups_group_self_edit_description()}
			/>
		</div>
	{/snippet}
</Action>
