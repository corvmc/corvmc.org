<script lang="ts">
	import Action from '$lib/components/shared/Action.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import { updateMemberRemote } from '$lib/remote/bands.remote';

	/**
	 * An admin editing another member's role and what they play.
	 *
	 * `position` has been settable only at invite time since bands shipped —
	 * `updateMemberRemote` accepted it the whole while, but nothing rendered an
	 * input for it, so a wrong instrument was permanent.
	 *
	 * No alias here on purpose: a stage name is self-identification, and its
	 * only path is `updateMyBandMembership` on the member's own row.
	 */
	let {
		memberId,
		memberName,
		role,
		position,
		onchanged
	}: {
		memberId: string;
		memberName: string;
		role: 'admin' | 'member';
		position: string | null;
		onchanged: () => void;
	} = $props();

	const update = $derived(updateMemberRemote.for(memberId));
	const { fields } = updateMemberRemote;

	const roleOptions = [
		{ value: 'member', label: 'Member' },
		{ value: 'admin', label: 'Admin' }
	];
</script>

<Action
	action={update}
	label="Edit"
	modalTitle="Edit {memberName}"
	variant="ghost"
	size="xs"
	successToast="Member updated"
	onsuccess={onchanged}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...fields.memberId.as('hidden', memberId)} />
			<FormField
				field={fields.role}
				type="select"
				label="Role"
				value={role}
				options={roleOptions}
				description="Admins can edit the band profile, its events, and its members."
			/>
			<FormField
				field={fields.position}
				type="text"
				label="Instrument / role"
				value={position ?? ''}
				maxlength="100"
				placeholder="e.g. Bass"
			/>
		</div>
	{/snippet}
</Action>
