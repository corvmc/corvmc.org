<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
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
		bandId,
		memberId,
		memberName,
		role,
		position,
		onchanged
	}: {
		/** The band whose roster this row belongs to — the ref the guard resolves. */
		bandId: string;
		memberId: string;
		memberName: string;
		role: 'admin' | 'member';
		position: string | null;
		onchanged: () => void;
	} = $props();

	const update = $derived(updateMemberRemote.for(memberId));
	const { fields } = updateMemberRemote;

	const roleOptions = [
		{ value: 'member', label: m.band_role_member() },
		{ value: 'admin', label: m.band_admin() }
	];
</script>

<Action
	action={update}
	label={m.band_slug_members_edit_member_edit()}
	modalTitle={m.band_slug_members_edit_member_modal_title({ memberName })}
	variant="ghost"
	size="xs"
	successToast={m.band_slug_members_edit_member_success_toast()}
	onsuccess={onchanged}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...fields.bandId.as('hidden', bandId)} />
			<input {...fields.memberId.as('hidden', memberId)} />
			<FormField
				field={fields.role}
				type="select"
				label={m.band_role()}
				value={role}
				options={roleOptions}
				description={m.band_slug_members_edit_member_description()}
			/>
			<FormField
				field={fields.position}
				type="text"
				label={m.band_instrument_role()}
				value={position ?? ''}
				maxlength="100"
				placeholder={m.band_e_g_bass()}
			/>
		</div>
	{/snippet}
</Action>
