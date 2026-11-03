<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { getUserReservations } from '#lib/remote/users.remote.js';
	import { getUserRecurringSeries } from '#lib/remote/reservations.remote.js';
	import { getUserLoans } from '#lib/remote/inventory.remote.js';
	import { RelatedList } from '#lib/components/ui/entity/index.js';
	import Table from '#lib/components/ui/Table.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import BookerTypeIcon from '#lib/components/reservations/BookerTypeIcon.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import { rowLink } from '#lib/actions/row-link.js';
	import { resolve } from '$app/paths';
	import { formatDateTimeShort, formatDateShortYear, formatTimeRange } from '#lib/utils/format.js';

	import OrientationCard from './OrientationCard.svelte';

	let { id }: { id: string } = $props();
</script>

<!-- Before the bookings, because it is the question the bookings raise: somebody
     is coming in, and has anyone shown them where anything is? -->
<OrientationCard {id} />

<RelatedList
	title={m.staff_members_id_panels_space_panel_reservations()}
	result={getUserReservations(id)}
>
	{#snippet children(data)}
		{#if data.counts.upcoming === 0 && data.counts.past === 0}
			<EmptyState
				title={m.staff_members_id_panels_space_panel_no_reservations()}
				description={m.staff_members_id_panels_space_panel_nothing_booked_by_member()}
			/>
		{:else}
			<p class="mb-3 text-muted">
				{m.staff_members_id_panels_space_panel_upcoming_past({
					upcoming: data.counts.upcoming,
					past: data.counts.past
				})}
				{#if data.counts.unpaid > 0}
					· <span class="text-warning"
						>{m.staff_members_id_panels_space_panel_unpaid({ unpaid: data.counts.unpaid })}</span
					>
				{/if}
			</p>

			{#each [{ label: m.staff_members_id_panels_space_panel_upcoming(), rows: data.upcoming }, { label: m.staff_members_id_panels_space_panel_past(), rows: data.past }] as group (group.label)}
				{#if group.rows.length > 0}
					<h4 class="mt-3 mb-1 text-subtle font-semibold uppercase">{group.label}</h4>
					<Table>
						{#snippet head()}
							<th class="w-px"><span class="sr-only">{m.staff_status()}</span></th>
							<th>{m.staff_when()}</th>
							<th class="col-support">{m.staff_members_id_panels_space_panel_booked_by()}</th>
							<th class="col-extra cell-num">{m.staff_members_id_panels_space_panel_owed()}</th>
						{/snippet}
						{#each group.rows as r (r.id)}
							<tr class="hover" use:rowLink={resolve(`/staff/reservations/${r.id}`)}>
								<td class="w-px"><StatusBadge status={r.status} /></td>
								<td class="cell-primary">
									<a
										class="font-medium whitespace-nowrap"
										href={resolve(`/staff/reservations/${r.id}`)}
									>
										{formatDateTimeShort(r.startsAt)}
									</a>
									<div class="text-muted">
										{formatTimeRange(r.startsAt, r.endsAt)}
										<!-- Cancellations are kept in this list on purpose, and the
										     reason is the whole value of keeping them. -->
										{#if r.cancellationReason}
											· {r.cancellationReason}
										{/if}
									</div>
								</td>
								<td class="col-support">
									<span class="inline-flex items-center gap-1">
										<BookerTypeIcon type={r.bookerType} />
										{r.bandName ??
											(r.own ? m.staff_members_id_panels_space_panel_themselves() : '—')}
									</span>
								</td>
								<td class="col-extra cell-num">
									{#if r.cashDueCents && !r.paidAt}
										<Badge variant="warning" size="sm">
											${(r.cashDueCents / 100).toFixed(2)}
										</Badge>
									{:else}
										—
									{/if}
								</td>
							</tr>
						{/each}
					</Table>
				{/if}
			{/each}
		{/if}
	{/snippet}
</RelatedList>

<RelatedList
	title={m.staff_members_id_panels_space_panel_recurring_bookings()}
	result={getUserRecurringSeries(id)}
>
	{#snippet children(series)}
		{#if series.length === 0}
			<EmptyState
				title={m.staff_members_id_panels_space_panel_no_recurring_bookings()}
				description={m.staff_members_id_panels_space_panel_no_standing_weekly_month()}
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th>{m.staff_members_id_panels_space_panel_pattern()}</th>
					<th class="col-support">{m.staff_members_id_panels_space_panel_time()}</th>
					<th class="col-extra">{m.staff_members_id_panels_space_panel_runs_until()}</th>
				{/snippet}
				{#each series as s (s.id)}
					<tr class="hover" use:rowLink={resolve(`/staff/recurring/${s.id}`)}>
						<td class="cell-primary">
							<a class="font-medium" href={resolve(`/staff/recurring/${s.id}`)}>
								{s.frequencyLabel}
							</a>
						</td>
						<td class="col-support">{formatTimeRange(s.startsAt, s.endsAt)}</td>
						<td class="col-extra">
							{s.seriesEndsAt
								? formatDateShortYear(s.seriesEndsAt)
								: m.staff_members_id_panels_space_panel_no_end_date()}
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/snippet}
</RelatedList>

<RelatedList
	title={m.staff_members_id_panels_space_panel_equipment_loans()}
	result={getUserLoans(id)}
>
	{#snippet children(loans)}
		{#if loans.length === 0}
			<EmptyState
				title={m.staff_members_id_panels_space_panel_no_loans()}
				description={m.staff_members_id_panels_space_panel_member_has_never_borrowe()}
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.staff_status()}</span></th>
					<th>{m.staff_item()}</th>
					<th class="col-support">{m.staff_due()}</th>
					<th class="col-extra">{m.staff_returned()}</th>
				{/snippet}
				{#each loans as loan (loan.id)}
					<tr class="hover" use:rowLink={resolve(`/staff/inventory/loans/${loan.id}`)}>
						<td class="w-px"><StatusBadge status={loan.status} /></td>
						<td class="cell-primary">
							<a class="font-medium" href={resolve(`/staff/inventory/loans/${loan.id}`)}>
								{loan.equipmentName ?? m.staff_members_id_panels_space_panel_removed_item()}
							</a>
							{#if loan.quantity > 1}
								<div class="text-muted">×{loan.quantity}</div>
							{/if}
						</td>
						<td class="col-support whitespace-nowrap">
							{#if loan.dueDate}
								{formatDateShortYear(loan.dueDate)}
								{#if loan.isOverdue}
									<Badge variant="error" size="sm">{m.staff_overdue()}</Badge>
								{/if}
							{:else}
								—
							{/if}
						</td>
						<td class="col-extra whitespace-nowrap">
							{loan.returnedAt ? formatDateShortYear(loan.returnedAt) : '—'}
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/snippet}
</RelatedList>
