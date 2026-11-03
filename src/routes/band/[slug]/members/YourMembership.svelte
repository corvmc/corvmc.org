<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import type { MemberRef } from '$lib/types/entity';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { leave, updateMyBandMembership } from '$lib/remote/bands.remote';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	/**
	 * The viewer's own membership, at the top of the members page.
	 *
	 * The page used to open with everyone else and bury Leave Band as a bare
	 * button at the very bottom — and an owner, who cannot leave, simply saw
	 * nothing there with no explanation of why.
	 *
	 * Synchronous script: `fields` is read at module scope and the awaited
	 * queries live in the parent, which passes resolved props.
	 */
	const fields = updateMyBandMembership.fields;
	const { fields: leaveFields } = leave;

	let {
		me,
		bandId,
		bandName,
		role,
		onchanged,
		ontransfer
	}: {
		me: {
			/** The presentation ref `getMembers` builds — alias-aware. */
			member: MemberRef;
			alias: string | null;
			position: string | null;
		} | null;
		/** The band these two forms act on — the ref their guards resolve. */
		bandId: string;
		bandName: string;
		role: string;
		onchanged: () => void;
		/** Opens the page's transfer-ownership modal — the owner's way out. */
		ontransfer: () => void;
	} = $props();

	const isOwner = $derived(role === 'owner');
</script>

{#if me}
	<InfoCard title={m.band_slug_members_your_membership_title()}>
		<div class="space-y-4">
			<div class="flex items-center gap-3">
				<EntityIdentity ref={me.member} size="md" />
				<div class="ml-auto"><StatusBadge status={role} /></div>
			</div>

			<Form
				remote={updateMyBandMembership}
				guard
				successToast={m.band_saved()}
				onsuccess={onchanged}
				class="space-y-4"
			>
				<input {...fields.bandId.as('hidden', bandId)} />

				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<FormField
						field={fields.alias}
						type="text"
						label={m.band_slug_members_your_membership_stage_name()}
						value={me.alias ?? ''}
						maxlength="100"
						placeholder={me.member.title}
						description={m.band_slug_members_your_membership_how_re_credited_band_s()}
					/>
					<FormField
						field={fields.position}
						type="text"
						label={m.band_instrument_role()}
						value={me.position ?? ''}
						maxlength="100"
						placeholder={m.band_e_g_bass()}
						description={m.band_slug_members_your_membership_what_play_band_admins_can()}
					/>
				</div>
				<div class="flex justify-end">
					<SubmitButton label={m.band_save()} />
				</div>
			</Form>

			<div class="border-t pt-4">
				{#if isOwner}
					<!-- An owner can't leave while they own the band. Saying so, with the
					     way out, beats the old behaviour of hiding the button entirely
					     and leaving them to guess. -->
					<Alert type="info">
						<ParaglideMessage
							message={m.band_slug_members_your_membership_as_owner_can_t_leave}
							inputs={{ bandName }}
							>{#snippet strong({ children })}<strong>{@render children?.()}</strong
								>{/snippet}</ParaglideMessage
						>
						{#snippet action()}
							<Button variant="ghost" size="sm" onclick={ontransfer}
								>{m.band_slug_members_your_membership_transfer_ownership()}</Button
							>
						{/snippet}
					</Alert>
				{:else}
					<!-- `confirm` and a `form` snippet together: Action renders the
					     confirm copy as a lead-in above the fields, so the band this
					     leaves can ride the submission without losing the prompt. -->
					<Action
						action={leave}
						label={m.band_slug_members_your_membership_leave_band()}
						variant="error"
						size="sm"
						outline
						modalTitle={m.band_slug_members_your_membership_leave_band()}
						submitLabel={m.band_slug_members_your_membership_leave_band()}
						confirm="Leave {bandName}? You'll need to be re-invited to rejoin."
						successToast={m.band_slug_members_your_membership_have_left_band()}
						onsuccess={() => goto(resolve('/member/bands'))}
					>
						{#snippet form()}
							<input {...leaveFields.bandId.as('hidden', bandId)} />
						{/snippet}
					</Action>
				{/if}
			</div>
		</div>
	</InfoCard>
{/if}
