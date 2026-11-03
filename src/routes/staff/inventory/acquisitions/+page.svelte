<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Pagination from '$lib/components/ui/Pagination.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { Field } from '$lib/components/ui/Form';
	import Button from '$lib/components/ui/Button.svelte';
	import { getAcquisitions } from '$lib/remote/inventory.remote';
	import { acquisitionKinds, acquisitionKindLabels } from '$lib/config';
	import { formatCents, formatDateShort } from '$lib/utils/format';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { withQuery } from '$lib/utils/with-query';

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
	let pageNo = $state(Number(page.url.searchParams.get('page') ?? '1'));

	const data = $derived(
		await getAcquisitions({
			kind: (kind || undefined) as (typeof acquisitionKinds)[number] | undefined,
			from: from || undefined,
			to: to || undefined,
			awaitingReimbursement: owed || undefined,
			page: pageNo
		})
	);

	function apply(toPage = 1) {
		pageNo = toPage;
		// Assembled by hand for the same reason as the spend report: the lint rule
		// bans a mutable `URLSearchParams` in a component, and `resolve()` takes a
		// literal route id and nothing else.
		const parts: string[] = [];
		if (kind) parts.push(`kind=${encodeURIComponent(kind)}`);
		if (from) parts.push(`from=${encodeURIComponent(from)}`);
		if (to) parts.push(`to=${encodeURIComponent(to)}`);
		if (owed) parts.push('owed=1');
		if (pageNo > 1) parts.push(`page=${pageNo}`);
		const qs = parts.length > 0 ? `?${parts.join('&')}` : '';
		goto(withQuery(resolve('/staff/inventory/acquisitions'), qs), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}
</script>

<PageHeader title={m.staff_acquisitions()} subtitle={m.staff_inventory()} />

<PageContent>
	<div class="mb-4 flex flex-wrap items-end gap-3">
		<Field
			name="kind"
			type="select"
			label={m.staff_kind()}
			bind:value={kind}
			options={[
				{ value: '', label: m.staff_all() },
				...acquisitionKinds.map((k) => ({ value: k, label: acquisitionKindLabels[k] }))
			]}
		/>
		<Field name="from" type="date" label={m.staff_from()} bind:value={from} />
		<Field name="to" type="date" label={m.staff_text()} bind:value={to} />
		<Field
			name="owed"
			type="checkbox"
			label={m.staff_awaiting_reimbursement()}
			bind:value={owed}
			checkboxLabel={m.staff_inventory_acquisitions_checkbox_label()}
		/>
		<Button variant="default" size="sm" onclick={() => apply()}>{m.staff_apply()}</Button>
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
			title={m.staff_inventory_acquisitions_nothing_recorded()}
			description={owed
				? m.staff_inventory_acquisitions_nobody_currently_owed_anything()
				: m.staff_inventory_acquisitions_receiving_stock_against_item_wh()}
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th class="whitespace-nowrap">{m.staff_date()}</th>
				<th>{m.staff_source()}</th>
				<th class="col-support">{m.staff_kind()}</th>
				<th class="col-extra">{m.staff_reference()}</th>
				<th class="col-support cell-num">{m.staff_inventory_acquisitions_lines()}</th>
				<th class="cell-num">{m.staff_value()}</th>
				<th>{m.staff_inventory_acquisitions_reimbursement()}</th>
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
							<Badge variant="outline" size="xs"
								>{m.staff_inventory_acquisitions_8283_signed()}</Badge
							>
						{/if}
					</td>
					<td class="col-support">{acquisitionKindLabels[row.kind]}</td>
					<td class="col-extra">{row.reference ?? '—'}</td>
					<td class="col-support cell-num">{row.lineCount}</td>
					<td class="cell-num">{formatCents(row.totalCents)}</td>
					<td>
						{#if row.awaitingReimbursement}
							<Badge variant="warning" size="sm"
								>{m.staff_inventory_acquisitions_owed({ paidByName: row.paidByName ?? '' })}</Badge
							>
						{:else if row.reimbursedAt}
							<span class="text-subtle">
								{m.staff_inventory_acquisitions_repaid({
									formatDateShort: formatDateShort(row.reimbursedAt)
								})}
							</span>
						{:else}
							<span class="text-subtle">—</span>
						{/if}
					</td>
				</tr>
			{/each}
		</Table>
		<Pagination {...data.pagination} onpage={(n) => apply(n)} />
	{/if}
</PageContent>
