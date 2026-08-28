<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { Field } from '$lib/components/ui/Form';
	import Button from '$lib/components/ui/Button.svelte';
	import { getAcquisitions } from '$lib/remote/inventory.remote';
	import { acquisitionKinds, acquisitionKindLabels } from '$lib/config';
	import { formatCents, formatDateShort } from '$lib/utils/format';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	/**
	 * Everything the collective has taken in, and what it cost.
	 *
	 * Receiving has written these rows since Phase 1; nothing has ever read them
	 * back. That gap is why the disclosure columns sat empty in production — a
	 * Form 8283 is signed weeks after a gift arrives, and there was no acquisition
	 * to return to.
	 *
	 * Filters live in the URL rather than in `replaceState`, which updates neither
	 * `page.url` nor the router.
	 */
	let kind = $state(page.url.searchParams.get('kind') ?? '');
	let from = $state(page.url.searchParams.get('from') ?? '');
	let to = $state(page.url.searchParams.get('to') ?? '');
	let owed = $state(page.url.searchParams.get('owed') === '1');

	const data = $derived(
		await getAcquisitions({
			kind: (kind || undefined) as (typeof acquisitionKinds)[number] | undefined,
			from: from || undefined,
			to: to || undefined,
			awaitingReimbursement: owed || undefined
		})
	);

	function apply() {
		// Assembled by hand for the same reason as the spend report: the lint rule
		// bans a mutable `URLSearchParams` in a component, and `resolve()` takes a
		// literal route id and nothing else.
		const parts: string[] = [];
		if (kind) parts.push(`kind=${encodeURIComponent(kind)}`);
		if (from) parts.push(`from=${encodeURIComponent(from)}`);
		if (to) parts.push(`to=${encodeURIComponent(to)}`);
		if (owed) parts.push('owed=1');
		const qs = parts.length > 0 ? `?${parts.join('&')}` : '';
		goto(`${resolve('/staff/inventory/acquisitions')}${qs}`, {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}
</script>

<PageHeader title="Acquisitions" subtitle="Inventory" backHref="/staff/inventory" />

<PageContent width="3xl">
	<div class="mb-4 flex flex-wrap items-end gap-3">
		<Field
			name="kind"
			type="select"
			label="Kind"
			bind:value={kind}
			options={[
				{ value: '', label: 'All' },
				...acquisitionKinds.map((k) => ({ value: k, label: acquisitionKindLabels[k] }))
			]}
		/>
		<Field name="from" type="date" label="From" bind:value={from} />
		<Field name="to" type="date" label="To" bind:value={to} />
		<Field
			name="owed"
			type="checkbox"
			label="Awaiting reimbursement"
			bind:value={owed}
			checkboxLabel="Only what somebody is owed for"
		/>
		<Button variant="default" size="sm" onclick={apply}>Apply</Button>
	</div>

	{#if data.owedCount > 0 && !owed}
		<p class="mb-4 text-subtle">
			{data.owedCount === 1
				? 'One acquisition is awaiting reimbursement.'
				: `${data.owedCount} acquisitions are awaiting reimbursement.`}
		</p>
	{/if}

	{#if data.rows.length === 0}
		<EmptyState
			title="Nothing recorded"
			description={owed
				? 'Nobody is currently owed for anything the collective has taken in.'
				: 'Receiving stock against an item is what creates an acquisition.'}
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th class="whitespace-nowrap">Date</th>
				<th>Source</th>
				<th class="col-support">Kind</th>
				<th class="col-extra">Reference</th>
				<th class="col-support cell-num">Lines</th>
				<th class="cell-num">Value</th>
				<th>Reimbursement</th>
			{/snippet}
			{#each data.rows as row (row.id)}
				<tr class="hover">
					<td class="whitespace-nowrap">
						<a class="font-medium" href={resolve(`/staff/inventory/acquisitions/${row.id}`)}>
							{formatDateShort(row.occurredAt)}
						</a>
					</td>
					<td class="cell-primary">
						{row.donorName ?? '—'}
						{#if row.kind === 'donation' && row.acknowledgedAt}
							<Badge variant="outline" size="xs">8283 signed</Badge>
						{/if}
					</td>
					<td class="col-support">{acquisitionKindLabels[row.kind]}</td>
					<td class="col-extra">{row.reference ?? '—'}</td>
					<td class="col-support cell-num">{row.lineCount}</td>
					<td class="cell-num">{formatCents(row.totalCents)}</td>
					<td>
						{#if row.awaitingReimbursement}
							<Badge variant="warning" size="sm">Owed to {row.paidByName}</Badge>
						{:else if row.reimbursedAt}
							<span class="text-subtle">
								Repaid {formatDateShort(row.reimbursedAt)}
							</span>
						{:else}
							<span class="text-subtle">—</span>
						{/if}
					</td>
				</tr>
			{/each}
		</Table>
	{/if}
</PageContent>
