<script lang="ts">
	import { getUserReservations } from '$lib/remote/users.remote';
	import { getUserRecurringSeries } from '$lib/remote/reservations.remote';
	import { getUserLoans } from '$lib/remote/equipment.remote';
	import { RelatedList } from '$lib/components/shared/entity';
	import Table from '$lib/components/shared/Table.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import BookerTypeIcon from '$lib/components/shared/reservations/BookerTypeIcon.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import Badge from '$lib/components/shared/Badge.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { formatDateTimeShort, formatDateShortYear, formatTimeRange } from '$lib/utils/format';

	let { id }: { id: string } = $props();
</script>

<RelatedList title="Reservations" result={getUserReservations(id)}>
	{#snippet children(data)}
		{#if data.counts.upcoming === 0 && data.counts.past === 0}
			<EmptyState
				title="No reservations"
				description="Nothing booked by this member, or by a band they're in."
			/>
		{:else}
			<p class="mb-3 text-muted">
				{data.counts.upcoming} upcoming · {data.counts.past} past
				{#if data.counts.unpaid > 0}
					· <span class="text-warning">{data.counts.unpaid} unpaid</span>
				{/if}
			</p>

			{#each [{ label: 'Upcoming', rows: data.upcoming }, { label: 'Past', rows: data.past }] as group (group.label)}
				{#if group.rows.length > 0}
					<h4 class="mt-3 mb-1 text-subtle font-semibold uppercase">{group.label}</h4>
					<Table>
						{#snippet head()}
							<th class="w-px"><span class="sr-only">Status</span></th>
							<th>When</th>
							<th class="col-support">Booked by</th>
							<th class="col-extra cell-num">Owed</th>
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
										{r.bandName ?? (r.own ? 'Themselves' : '—')}
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

<RelatedList title="Recurring bookings" result={getUserRecurringSeries(id)}>
	{#snippet children(series)}
		{#if series.length === 0}
			<EmptyState title="No recurring bookings" description="No standing weekly or monthly slot." />
		{:else}
			<Table>
				{#snippet head()}
					<th>Pattern</th>
					<th class="col-support">Time</th>
					<th class="col-extra">Runs until</th>
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
							{s.seriesEndsAt ? formatDateShortYear(s.seriesEndsAt) : 'No end date'}
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/snippet}
</RelatedList>

<RelatedList title="Equipment loans" result={getUserLoans(id)}>
	{#snippet children(loans)}
		{#if loans.length === 0}
			<EmptyState title="No loans" description="This member has never borrowed equipment." />
		{:else}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Item</th>
					<th class="col-support">Due</th>
					<th class="col-extra">Returned</th>
				{/snippet}
				{#each loans as loan (loan.id)}
					<tr class="hover" use:rowLink={resolve(`/staff/equipment/loans/${loan.id}`)}>
						<td class="w-px"><StatusBadge status={loan.status} /></td>
						<td class="cell-primary">
							<a class="font-medium" href={resolve(`/staff/equipment/loans/${loan.id}`)}>
								{loan.equipmentName ?? 'Removed item'}
							</a>
							{#if loan.quantity > 1}
								<div class="text-muted">×{loan.quantity}</div>
							{/if}
						</td>
						<td class="col-support whitespace-nowrap">
							{#if loan.dueDate}
								{formatDateShortYear(loan.dueDate)}
								{#if loan.isOverdue}
									<Badge variant="error" size="sm">Overdue</Badge>
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
