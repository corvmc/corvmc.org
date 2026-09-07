<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { updateGroupMember } from '$lib/remote/groups.remote';

	/**
	 * A leader editing another member's role and what they do here.
	 *
	 * No alias, matching the band side: a stage name is self-identification and
	 * a leader cannot rename someone.
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
		{ value: 'member', label: 'Member' },
		{ value: 'admin', label: 'Admin' }
	];
</script>

<Action
	action={updateGroupMember.for(memberId)}
	label="Edit"
	aria-label={`Edit ${memberName}`}
	modalTitle="Edit {memberName}"
	variant="ghost"
	size="xs"
	successToast="Member updated"
	onsuccess={onchanged}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...fields.slug.as('hidden', slug)} />
			<input {...fields.memberId.as('hidden', memberId)} />
			<FormField
				field={fields.role}
				type="select"
				label="Role"
				value={role}
				options={roleOptions}
				description="Admins post announcements, upload documents, run sessions and manage the roster."
			/>
			<FormField
				field={fields.position}
				type="text"
				label="Position"
				value={position ?? ''}
				maxlength="100"
				placeholder="e.g. {kindLabel === 'committee' ? 'Secretary' : 'Chart librarian'}"
			/>
		</div>
	{/snippet}
</Action>
