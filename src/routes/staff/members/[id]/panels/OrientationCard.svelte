<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { getMemberOrientation, waiveMemberOrientation } from '$lib/remote/orientation.remote';
	import { RelatedList } from '$lib/components/ui/entity';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { formatDateTimeShort } from '$lib/utils/format';

	/**
	 * Whether this member has been shown around, and the one thing staff can do
	 * about it.
	 *
	 * Lives on Space rather than Volunteer: the orientation is a fact about the
	 * room, and this panel already renders the bookings it hangs off. Nothing is
	 * gated on it — a member who has not been oriented can still book — so this
	 * states a fact rather than raising an alarm.
	 */
	let { id }: { id: string } = $props();
</script>

<RelatedList
	title={m.staff_members_id_panels_orientation_card_title()}
	result={getMemberOrientation(id)}
>
	{#snippet children(data)}
		<div class="flex flex-wrap items-center gap-3">
			<StatusBadge status={data.state} label />

			<p class="text-muted">
				{#if data.state === 'scheduled' && data.scheduledFor}
					{m.staff_members_id_panels_orientation_card_booked({
						formatDateTimeShort: formatDateTimeShort(data.scheduledFor)
					})}
				{:else if data.state === 'completed' && data.detail?.completedAt}
					{m.staff_members_id_panels_orientation_card_shown_around({
						formatDateTimeShort: formatDateTimeShort(data.detail.completedAt)
					})}
				{:else if data.state === 'waived' && data.detail?.waivedReason}
					{data.detail.waivedReason}
				{:else}
					{m.staff_members_id_panels_orientation_card_their_first_booking()}
				{/if}
			</p>

			{#if data.state === 'pending' || data.state === 'scheduled'}
				<Action
					action={waiveMemberOrientation}
					label={m.staff_members_id_panels_orientation_card_waive()}
					variant="ghost"
					size="sm"
					modalTitle={m.staff_members_id_panels_orientation_card_modal_title()}
					submitLabel={m.staff_members_id_panels_orientation_card_waive()}
					successToast={m.staff_members_id_panels_orientation_card_success_toast()}
				>
					{#snippet form()}
						<input {...waiveMemberOrientation.fields.userId.as('hidden', id)} />
						<FormField
							field={waiveMemberOrientation.fields.reason}
							label={m.staff_members_id_panels_orientation_card_why_not_needed()}
							type="textarea"
							description={m.staff_members_id_panels_orientation_card_description()}
						/>
					{/snippet}
				</Action>
			{/if}
		</div>
	{/snippet}
</RelatedList>
