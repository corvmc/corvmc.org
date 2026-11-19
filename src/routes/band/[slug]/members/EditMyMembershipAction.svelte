<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { updateMyBandMembership } from '#lib/remote/bands.remote.js';

	/**
	 * The viewer editing their own roster row: stage name and what they play.
	 * A stage name is self-identification, so this is its only path; an admin's
	 * `EditMemberAction` sets role and position on everyone else's row.
	 */
	const { fields } = updateMyBandMembership;

	let {
		bandId,
		name,
		alias,
		position,
		onchanged
	}: {
		bandId: string;
		/** The name the roster shows: the stage name, else the account name. */
		name: string;
		alias: string | null;
		position: string | null;
		onchanged: () => void;
	} = $props();
</script>

<Action
	action={updateMyBandMembership}
	label={m.band_slug_members_edit_member_edit_label()}
	modalTitle={m.band_slug_members_edit_member_modal_title({ memberName: name })}
	variant="ghost"
	size="xs"
	successToast={m.band_saved_toast()}
	onsuccess={onchanged}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...fields.bandId.as('hidden', bandId)} />
			<FormField
				field={fields.alias}
				type="text"
				label={m.band_slug_members_your_membership_stage_name_label()}
				value={alias ?? ''}
				maxlength="100"
				placeholder={name}
				description={m.band_slug_members_your_membership_how_re_credited_band_s_body()}
			/>
			<FormField
				field={fields.position}
				type="text"
				label={m.band_instrument_role_label()}
				value={position ?? ''}
				maxlength="100"
				placeholder={m.band_e_g_bass_placeholder()}
				description={m.band_slug_members_your_membership_what_play_band_admins_can_body()}
			/>
		</div>
	{/snippet}
</Action>
