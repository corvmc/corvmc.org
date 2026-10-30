<script lang="ts">
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

<RelatedList title="Orientation" result={getMemberOrientation(id)}>
	{#snippet children(data)}
		<div class="flex flex-wrap items-center gap-3">
			<StatusBadge status={data.state} label />

			<p class="text-muted">
				{#if data.state === 'scheduled' && data.scheduledFor}
					Booked for {formatDateTimeShort(data.scheduledFor)}.
				{:else if data.state === 'completed' && data.detail?.completedAt}
					Shown around {formatDateTimeShort(data.detail.completedAt)}.
				{:else if data.state === 'waived' && data.detail?.waivedReason}
					{data.detail.waivedReason}
				{:else}
					Their first booking will raise a shift for someone to meet them.
				{/if}
			</p>

			{#if data.state === 'pending' || data.state === 'scheduled'}
				<Action
					action={waiveMemberOrientation}
					label="Waive"
					variant="ghost"
					size="sm"
					modalTitle="Waive orientation"
					submitLabel="Waive"
					successToast="Orientation waived"
				>
					{#snippet form()}
						<input type="hidden" name="userId" value={id} />
						<FormField
							name="reason"
							label="Why is it not needed?"
							type="textarea"
							description="The next staffer reading the list needs to know why this member is not on it."
						/>
					{/snippet}
				</Action>
			{/if}
		</div>
	{/snippet}
</RelatedList>
