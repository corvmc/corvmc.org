<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { updateGroupMember } from '$lib/remote/groups.remote';

	/**
	 * A chair editing another member's role and what they do here.
	 *
	 * No alias, matching the band side: a stage name is self-identification and
	 * a chair cannot rename someone.
	 */
	let {
		slug,
		memberId,
		memberName,
		role,
		position,
		kindLabel,
		onchanged
	}: {
		slug: string;
		memberId: string;
		memberName: string;
		role: 'admin' | 'member';
		position: string | null;
		kindLabel: string;
		onchanged: () => void;
	} = $props();

	const { fields } = updateGroupMember;

	const roleOptions = [
		{ value: 'member', label: m.groups_member() },
		{ value: 'admin', label: m.groups_admin() }
	];
</script>

<Action
	action={updateGroupMember.for(memberId)}
	label={m.groups_edit()}
	aria-label={m.groups_group_member_edit_aria_label({ memberName })}
	modalTitle={m.groups_group_member_edit_aria_label({ memberName })}
	variant="ghost"
	size="xs"
	successToast={m.groups_group_member_edit_success_toast()}
	onsuccess={onchanged}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...fields.slug.as('hidden', slug)} />
			<input {...fields.memberId.as('hidden', memberId)} />
			<FormField
				field={fields.role}
				type="select"
				label={m.groups_role()}
				value={role}
				options={roleOptions}
				description={m.groups_group_member_edit_description()}
			/>
			<FormField
				field={fields.position}
				type="text"
				label={m.groups_position()}
				value={position ?? ''}
				maxlength="100"
				placeholder={m.groups_group_member_edit_placeholder({
					value: kindLabel === 'committee' ? 'Secretary' : 'Chart librarian'
				})}
			/>
		</div>
	{/snippet}
</Action>
