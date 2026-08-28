<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { RecordForm8282Action } from '$lib/components/actions';
	import { resolve } from '$app/paths';
	import { getForm8282Obligations } from '$lib/remote/inventory.remote';
	import { formatCents, formatDateShort } from '$lib/utils/format';

	/**
	 * Donated units disposed of within three years, where nobody has recorded what
	 * happened about Form 8282 yet.
	 *
	 * The asset page raises this the moment a unit is retired, but the deadline is
	 * 125 days out and the person who retires a thing is rarely the person who
	 * files paperwork. This is the list that keeps one from being quietly missed
	 * between those two facts.
	 */
	const data = $derived(await getForm8282Obligations());
</script>

<PageHeader title="Compliance" subtitle="Inventory" backHref="/staff/inventory" />

<PageContent width="3xl">
	{#if data.rows.length === 0}
		<EmptyState
			title="Nothing outstanding"
			description={data.noFormOnRecord > 0
				? `${data.noFormOnRecord} donated ${data.noFormOnRecord === 1 ? 'unit was' : 'units were'} disposed of inside the three-year window, but none has a signed Form 8283 on record — so no filing is expected.`
				: 'No donated gear has been disposed of inside the three-year window.'}
		/>
	{:else}
		{#if data.overdueCount > 0}
			<Alert type="error" class="mb-4">
				{data.overdueCount === 1
					? 'One filing window has already closed.'
					: `${data.overdueCount} filing windows have already closed.`}
			</Alert>
		{/if}

		<!-- Stated once, at the top: the system is flagging, not determining. -->
		<p class="mb-4 text-subtle">
			Disposing of donated property within three years of receiving it can oblige the collective to
			file IRS Form 8282 within 125 days, with a copy to the donor. Only gifts CMC signed a Form
			8283 for are listed here — that signature is what makes something reportable. Recording an
			outcome stays a person's judgement rather than the system's.
		</p>

		<Table>
			{#snippet head()}
				<th>Unit</th>
				<th class="col-support">Donor</th>
				<th class="col-extra whitespace-nowrap">Received</th>
				<th class="whitespace-nowrap">Disposed</th>
				<th class="whitespace-nowrap">Due by</th>
				<th class="w-px"><span class="sr-only">Record</span></th>
			{/snippet}
			{#each data.rows as row (row.id)}
				<tr class="hover">
					<td class="cell-primary">
						<a class="font-medium" href={resolve(`/staff/inventory/assets/${row.id}`)}>
							{row.itemName}
						</a>
						{#if row.assetTag}
							<div class="font-mono text-subtle">{row.assetTag}</div>
						{/if}
						{#if row.fairValueCents}
							<Badge variant="outline" size="xs">{formatCents(row.fairValueCents)}</Badge>
						{/if}
					</td>
					<td class="col-support">{row.donor ?? '—'}</td>
					<td class="col-extra whitespace-nowrap">
						{row.acquiredAt ? formatDateShort(row.acquiredAt) : '—'}
					</td>
					<td class="whitespace-nowrap">
						{row.disposedAt ? formatDateShort(row.disposedAt) : '—'}
					</td>
					<td class="whitespace-nowrap">
						{#if row.state === 'overdue'}
							<Badge variant="error" size="sm">
								Overdue {row.dueBy ? formatDateShort(row.dueBy) : ''}
							</Badge>
						{:else}
							<span class:text-warning={(row.daysRemaining ?? 99) < 30}>
								{row.dueBy ? formatDateShort(row.dueBy) : '—'}
								<span class="text-subtle">({row.daysRemaining}d)</span>
							</span>
						{/if}
					</td>
					<td class="w-px">
						<RecordForm8282Action assetId={row.id} dueBy={row.dueBy} variant="ghost" />
					</td>
				</tr>
			{/each}
		</Table>
	{/if}
</PageContent>
