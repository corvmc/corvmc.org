<script lang="ts">
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import { relativeDay } from '$lib/utils/format';
	import Action from '$lib/components/ui/Action.svelte';
	import { approveVolunteerSignup } from '$lib/remote/volunteer.remote';
	import type { MemberRef } from '$lib/types/entity';

	/**
	 * Under-18 sign-ups waiting on a staff decision.
	 *
	 * Rows come from the page's one query now. It used to own `getBlockedVolunteers` and
	 * live above the hour-log table, which meant a queue of *people* was only ever found by
	 * somebody who had come to do something else
	 * (docs/reports/volunteer-workflow-findings.md#c2).
	 */
	type BlockedVolunteer = {
		userId: string;
		member: MemberRef;
		firstName: string;
		lastName: string;
		createdAt: Date;
	};

	let { rows }: { rows: BlockedVolunteer[] } = $props();
</script>

<InfoCard title="Awaiting guardian sign-off">
	{#snippet header(title)}
		<div class="flex items-center justify-between gap-2">
			<CardTitle>{title}</CardTitle>
			<Button href="/staff/volunteer/people?tab=signoff" variant="ghost" size="sm">People →</Button>
		</div>
	{/snippet}

	<p class="text-muted">
		These members told us they're under 18, so they can't pick up shifts or log hours yet. Approving
		lets them do both.
	</p>
	<Table>
		{#snippet head()}
			<th class="w-px"><span class="sr-only">Status</span></th>
			<th>Member</th>
			<th class="col-support">Name given</th>
			<th class="col-extra whitespace-nowrap">Signed up</th>
			<th class="w-px"><span class="sr-only">Actions</span></th>
		{/snippet}

		{#each rows as row (row.userId)}
			<tr>
				<td class="w-px"><StatusBadge status="blocked" /></td>
				<td class="cell-primary">
					<EntityIdentity ref={row.member} />
				</td>
				<td class="col-support">{row.firstName} {row.lastName}</td>
				<td class="col-extra whitespace-nowrap">{relativeDay(row.createdAt)}</td>
				<td class="w-px">
					<div class="flex justify-end">
						<Action
							action={approveVolunteerSignup.for(row.userId)}
							label="Approve"
							variant="primary"
							size="sm"
							modalTitle="Approve {row.firstName} {row.lastName}?"
							submitLabel="Approve"
							successToast="Volunteer approved"
						>
							{#snippet form()}
								<input type="hidden" name="userId" value={row.userId} />
								<p class="text-sm">
									Make sure a guardian's sign-off is on file first — approving lets them claim
									shifts and log hours on their own.
								</p>
							{/snippet}
						</Action>
					</div>
				</td>
			</tr>
		{/each}
	</Table>
</InfoCard>
