<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import { Field } from '$lib/components/ui/Form';
	import Button from '$lib/components/ui/Button.svelte';
	import { getSpendReport } from '$lib/remote/inventory.remote';
	import StaffViews from '../../StaffViews.svelte';
	import { reportViews } from '../views';
	import { formatCents } from '$lib/utils/format';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { contractorTradeLabels, type ContractorTrade } from '$lib/config';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { withQuery } from '$lib/utils/with-query';

	/**
	 * What the collective spent on stock, per category, over a window.
	 *
	 * This is the question Phase 1 existed to make answerable: under the old
	 * schema, using something up meant overwriting a number, so "what do we spend
	 * on sticks in a year" had no answer at all. It reads the acquisition ledger,
	 * and it counts **purchases only** — a donation is not spend, and folding
	 * gifts in would overstate the budget by exactly what was given.
	 *
	 * Range lives in the URL rather than in `replaceState`, which updates neither
	 * `page.url` nor the router.
	 */
	let from = $state(page.url.searchParams.get('from') ?? '');
	let to = $state(page.url.searchParams.get('to') ?? '');

	const data = $derived(await getSpendReport({ from: from || undefined, to: to || undefined }));

	function apply() {
		// Assembled by hand rather than with `URLSearchParams`: the lint rule bans
		// a mutable instance of it in a component, and both values are plain dates.
		// The path comes from `resolve()` on a literal route id — that is all it
		// accepts, which is why the query string is appended rather than passed
		// through a URL object, and why the `goto` warning here is unavoidable.
		const parts: string[] = [];
		if (from) parts.push(`from=${encodeURIComponent(from)}`);
		if (to) parts.push(`to=${encodeURIComponent(to)}`);
		const qs = parts.length > 0 ? `?${parts.join('&')}` : '';
		goto(withQuery(resolve('/staff/reports/inventory-spend'), qs), {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}
</script>

<PageHeader title={m.staff_reports()} documentTitle={m.staff_reports_inventory_spend()}>
	<StaffViews views={reportViews} active="inventory-spend" collapse />
</PageHeader>

<PageContent>
	<div class="mb-4 flex flex-wrap items-end gap-3">
		<Field name="from" type="date" label={m.staff_from()} bind:value={from} />
		<Field name="to" type="date" label={m.staff_text()} bind:value={to} />
		<Button variant="default" size="sm" onclick={apply}>{m.staff_apply()}</Button>
	</div>

	<div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
		<StatCard title={m.staff_stock()} value={formatCents(data.totalCents)} />
		<StatCard title={m.staff_inventory_spend_services()} value={formatCents(data.servicesCents)} />
		<StatCard
			title={m.staff_inventory_spend_window()}
			value={`${data.from} → ${data.to}`}
			size="sm"
			valueClass="whitespace-normal"
		/>
	</div>

	{#if data.rows.length === 0}
		<EmptyState
			title={m.staff_inventory_spend_nothing_purchased_window()}
			description={m.staff_inventory_spend_only_purchases_count_here_donations()}
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th>{m.staff_category()}</th>
				<th class="col-support cell-num">{m.staff_units()}</th>
				<th class="cell-num">{m.staff_spend()}</th>
				<th class="col-support cell-num">{m.staff_inventory_spend_share()}</th>
			{/snippet}
			{#each data.rows as row (row.categoryId)}
				<tr class="hover">
					<td class="cell-primary">{row.categoryName}</td>
					<td class="col-support cell-num">{row.units}</td>
					<td class="cell-num">{formatCents(row.totalCents)}</td>
					<td class="col-support cell-num">{Math.round(row.share * 100)}%</td>
				</tr>
			{/each}
			<tr class="font-medium">
				<td>{m.staff_total()}</td>
				<td class="col-support cell-num"></td>
				<td class="cell-num">{formatCents(data.totalCents)}</td>
				<td class="col-support cell-num"></td>
			</tr>
		</Table>
	{/if}

	{#if data.sources.length > 0}
		<h2 class="mt-8 mb-3 font-medium">{m.staff_inventory_spend_by_supplier()}</h2>
		<Table>
			{#snippet head()}
				<th>{m.staff_supplier()}</th>
				<th class="col-support cell-num">{m.staff_inventory_spend_purchases()}</th>
				<th class="cell-num">{m.staff_spend()}</th>
				<th class="col-support cell-num">{m.staff_inventory_spend_share()}</th>
			{/snippet}
			{#each data.sources as row (row.sourceName ?? '')}
				<tr class="hover">
					<td class="cell-primary">
						{#if row.sourceName}
							{row.sourceName}
						{:else}
							<span class="text-subtle">{m.staff_inventory_spend_not_recorded()}</span>
						{/if}
					</td>
					<td class="col-support cell-num">{row.acquisitionCount}</td>
					<td class="cell-num">{formatCents(row.totalCents)}</td>
					<td class="col-support cell-num">{Math.round(row.share * 100)}%</td>
				</tr>
			{/each}
		</Table>
	{/if}

	<!--
		Services are a second block rather than more rows in the table above. They
		come from `contractor_job`, not from the acquisition ledger, because a
		labor invoice is not stock arriving — it has no line, no unit count and no
		equipment category to sit under.
	-->
	<h2 class="mt-8 mb-3 font-medium">{m.staff_inventory_spend_services()}</h2>
	{#if data.services.length === 0}
		<EmptyState
			title={m.staff_inventory_spend_no_contractor_work_window()}
			description={m.staff_inventory_spend_work_paid_out_instrument_tech()}
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th>{m.staff_inventory_spend_trade()}</th>
				<th class="col-support cell-num">{m.staff_inventory_spend_jobs()}</th>
				<th class="cell-num">{m.staff_spend()}</th>
			{/snippet}
			{#each data.services as row (row.trade)}
				<tr class="hover">
					<td class="cell-primary">
						<Badge variant="outline" size="sm">
							{contractorTradeLabels[row.trade as ContractorTrade]}
						</Badge>
					</td>
					<td class="col-support cell-num">{row.jobCount}</td>
					<td class="cell-num">{formatCents(row.totalCents)}</td>
				</tr>
			{/each}
			<tr class="font-medium">
				<td>{m.staff_total()}</td>
				<td class="col-support cell-num"></td>
				<td class="cell-num">{formatCents(data.servicesCents)}</td>
			</tr>
		</Table>
	{/if}

	<p class="mt-4 text-subtle">
		<ParaglideMessage
			message={m.staff_inventory_spend_gifts_kind_recorded_but_not}
			inputs={{ staff_inventory_spend_inventory_spec: m.staff_inventory_spend_inventory_spec() }}
			>{#snippet a({ children })}<a class="link" href={resolve('/staff/inventory')}
					>{@render children?.()}</a
				>{/snippet}</ParaglideMessage
		>
	</p>
</PageContent>
