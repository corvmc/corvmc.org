<script lang="ts">
	import { m as msg } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import DataList from '#lib/components/ui/DataList.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import BadgeList from '#lib/components/ui/BadgeList.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import Button from '#lib/components/ui/Button.svelte';
	import { toast } from 'svelte-sonner';
	import { formatDateShort } from '#lib/utils/format.js';
	import { getInterestedVolunteers } from '#lib/remote/volunteer.remote.js';

	/**
	 * The members who said they would help with this role, owning the query behind them.
	 *
	 * Paginated, so it is keyed by a page number the page's role-id-keyed query cannot carry — see
	 * RoleShiftsCard for the same reasoning.
	 */
	let { role }: { role: { id: string; name: string } } = $props();

	// Until there's an in-app way to mail volunteers, the useful move is to hand staff the
	// addresses for whatever they're looking at. Copies the page in view, and says so, rather
	// than implying it grabbed everyone.
	async function copyEmails(emails: string[]) {
		try {
			await navigator.clipboard.writeText(emails.join(', '));
			toast.success(
				msg.staff_volunteer_roles_id_role_interested_card_copied({
					length: emails.length,
					value: emails.length === 1 ? 'address' : 'addresses'
				})
			);
		} catch {
			toast.error(msg.staff_volunteer_roles_id_role_interested_card_couldn_t_copy());
		}
	}

	let pageNumber = $state(1);

	const interested = $derived(
		getInterestedVolunteers({ volunteerRoleId: role.id, page: pageNumber })
	);
</script>

<InfoCard title={msg.staff_volunteer_roles_id_role_interested_card_title()}>
	{#snippet header(title)}
		<div class="flex items-center justify-between gap-2">
			{#await interested then r}
				<CardTitle>
					{title}
					<!--
						The count that matters when the role is gated is how many could actually
						take a shift, not how many said yes.

						"today" is load-bearing. This page has no one shift in mind, so the gate
						can only be evaluated against now — while the gate that actually refuses a
						claim is evaluated as of the shift's date, and a card expiring next week
						does not cover a shift the week after
						(docs/reports/volunteer-workflow-findings.md#a7). The shift-scoped version
						of this list lives in AddVolunteerAction, which passes the date.
					-->
					{#if r.gated && r.rows.length > 0}
						<span class="text-muted font-normal">
							{msg.staff_volunteer_roles_id_role_interested_card_cleared_today({
								length: r.rows.filter((m) => m.missing.length === 0).length,
								length2: r.rows.length
							})}
						</span>
					{/if}
				</CardTitle>
			{/await}
			{#await interested then r}
				{#if r.rows.length > 0}
					<Button variant="ghost" size="sm" onclick={() => copyEmails(r.rows.map((m) => m.email))}>
						{msg.staff_volunteer_roles_id_role_interested_card_copy_emails_pa()}
					</Button>
				{/if}
			{/await}
		</div>
	{/snippet}

	{#await interested then r}
		{@const gated = r.gated}
		<DataList
			result={interested}
			empty={msg.staff_volunteer_roles_id_role_interested_card_empty()}
			onpage={(p) => (pageNumber = p)}
		>
			{#snippet children(members)}
				<Table>
					{#snippet head()}
						{#if gated}
							<th class="w-px"><span class="sr-only">{msg.staff_cleared()}</span></th>
						{/if}
						<th>{msg.staff_member()}</th>
						<th class="col-support">{msg.staff_when_they_can_help()}</th>
						<th class="col-extra whitespace-nowrap">{msg.staff_since()}</th>
					{/snippet}

					{#each members as member (member.userId)}
						{@const alsoIn = member.roleNames.filter((n) => n !== role.name)}
						<tr class="hover">
							{#if gated}
								<td class="w-px">
									<StatusBadge status={member.missing.length === 0 ? 'cleared' : 'uncleared'} />
								</td>
							{/if}
							<td class="cell-primary whitespace-nowrap">
								<EntityIdentity ref={member.member} />
								{#if gated && member.missing.length > 0}
									<div class="text-xs text-warning">
										{msg.staff_volunteer_roles_id_role_interested_card_needs({
											join: member.missing.map((c) => c.name).join(', ')
										})}
									</div>
								{/if}
							</td>

							<td class="col-support">
								{#if member.availability}
									<div class="truncate" title={member.availability}>{member.availability}</div>
								{/if}
								{#if member.phone}
									<div class="text-subtle">{member.phone}</div>
								{/if}
								<BadgeList items={alsoIn} max={2} class="mt-1" />
							</td>

							<td class="col-extra whitespace-nowrap">{formatDateShort(member.since)}</td>
						</tr>
					{/each}
				</Table>
			{/snippet}
		</DataList>
	{/await}
</InfoCard>
