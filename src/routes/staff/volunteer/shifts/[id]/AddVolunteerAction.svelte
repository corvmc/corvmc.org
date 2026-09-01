<script lang="ts">
	/**
	 * Put a member on a shift.
	 *
	 * Two ways in, and the difference matters. The list on the left is who said they'd help
	 * with this role, with their clearances evaluated **as of this shift's date** rather
	 * than today — the distinction the spec insists on and the role page was getting wrong
	 * (docs/reports/volunteer-workflow-findings.md#a7). The picker beside it is for
	 * everybody else: the person at the front desk who never ticked a box.
	 *
	 * A member whose clearance does not cover the shift is shown with what is missing and
	 * is not offered as a one-click add. Pressing on through the picker is still refused by
	 * the service, by name — the gate is the same for staff as for members, because "were
	 * they cleared on the night?" has to stay answerable.
	 *
	 * Owns `getInterestedVolunteers`: it is keyed by role, page and date, which no page
	 * query in this section could carry.
	 */
	import Action from '$lib/components/ui/Action.svelte';
	import MemberPicker from '$lib/components/ui/MemberPicker.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { IconUserPlus } from '@tabler/icons-svelte';
	import { formatDateShort } from '$lib/utils/format';
	import { assignShiftToMember, getInterestedVolunteers } from '$lib/remote/volunteer.remote';

	let {
		shiftId,
		volunteerRoleId,
		roleName,
		startsAt,
		label = 'Add someone',
		iconOnly = true
	}: {
		shiftId: string;
		volunteerRoleId: string;
		roleName: string;
		startsAt: Date;
		label?: string;
		iconOnly?: boolean;
	} = $props();

	const { fields } = assignShiftToMember;

	let userId = $state('');
	let userName = $state('');

	const candidates = $derived(
		getInterestedVolunteers({
			volunteerRoleId,
			asOf: startsAt.toISOString(),
			page: 1
		})
	);
</script>

<Action
	action={assignShiftToMember.for(shiftId)}
	{label}
	{iconOnly}
	icon={addIcon}
	variant="ghost"
	size="sm"
	modalTitle="Add someone to {roleName}"
	submitLabel="Add to shift"
	successToast="Added to the shift"
	onsuccess={() => {
		userId = '';
		userName = '';
	}}
>
	{#snippet form()}
		<input type="hidden" name="shiftId" value={shiftId} />
		<p class="text-sm">
			{roleName} on {formatDateShort(startsAt)}. They go on confirmed — you putting them there is
			the decision — so they'll get the reminder the day before.
		</p>

		{#await candidates then result}
			{#if result.rows.length > 0}
				<div>
					<p class="mb-1 text-sm font-medium">Said they'd help with this</p>
					<ul class="flex max-h-48 flex-col gap-1 overflow-y-auto">
						{#each result.rows as candidate (candidate.userId)}
							{@const blocked = candidate.missing.length > 0}
							<li
								class="flex flex-wrap items-center justify-between gap-2 rounded-box bg-base-200 p-2"
							>
								<div class="min-w-0">
									<div class="truncate font-medium">{candidate.member.title}</div>
									<!--
										Availability was collected on the member's own form and shown to
										nobody until now — it is the one line that answers "can you do
										Saturday". See findings #a6.
									-->
									{#if candidate.availability}
										<div class="truncate text-subtle" title={candidate.availability}>
											{candidate.availability}
										</div>
									{/if}
									{#if candidate.phone}
										<div class="text-subtle">{candidate.phone}</div>
									{/if}
									{#if blocked}
										<div class="text-xs text-warning">
											needs {candidate.missing.map((c) => c.name).join(', ')} by then
										</div>
									{/if}
								</div>

								{#if !blocked}
									<Button
										type="button"
										variant="ghost"
										size="xs"
										onclick={() => {
											userId = candidate.userId;
											userName = candidate.member.title;
										}}
									>
										{userId === candidate.userId ? 'Picked' : 'Pick'}
									</Button>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{:else}
				<EmptyState
					description="Nobody has picked this role yet, so there's no bench to draw on. Search below."
				/>
			{/if}
		{/await}

		<MemberPicker
			field={fields.userId}
			label="Or anybody else"
			bind:value={userId}
			bind:name={userName}
		/>
	{/snippet}
</Action>

{#snippet addIcon()}
	<IconUserPlus size={16} />
{/snippet}
