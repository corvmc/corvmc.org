<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import { Field } from '$lib/components/ui/Form';
	import Button from '$lib/components/ui/Button.svelte';
	import { getSpendReport } from '$lib/remote/inventory.remote';
	import { formatCents } from '$lib/utils/format';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { contractorTradeLabels, type ContractorTrade } from '$lib/config';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

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
		goto(`${resolve('/staff/inventory/spend')}${qs}`, {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}
</script>

<PageHeader title="Spend" subtitle="Inventory" backHref="/staff/inventory" />

<PageContent width="3xl">
	<div class="mb-4 flex flex-wrap items-end gap-3">
		<Field name="from" type="date" label="From" bind:value={from} />
		<Field name="to" type="date" label="To" bind:value={to} />
		<Button variant="default" size="sm" onclick={apply}>Apply</Button>
	</div>

	<div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
		<StatCard title="Stock" value={formatCents(data.totalCents)} />
		<StatCard title="Services" value={formatCents(data.servicesCents)} />
		<StatCard title="Window" value={`${data.from} → ${data.to}`} />
	</div>

	{#if data.rows.length === 0}
		<EmptyState
			title="Nothing purchased in this window"
			description="Only purchases count here — donations and grants are reported separately."
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th>Category</th>
				<th class="col-support cell-num">Units</th>
				<th class="cell-num">Spend</th>
				<th class="col-support cell-num">Share</th>
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
				<td>Total</td>
				<td class="col-support cell-num"></td>
				<td class="cell-num">{formatCents(data.totalCents)}</td>
				<td class="col-support cell-num"></td>
			</tr>
		</Table>
	{/if}

	<!--
		Services are a second block rather than more rows in the table above. They
		come from `contractor_job`, not from the acquisition ledger, because a
		labor invoice is not stock arriving — it has no line, no unit count and no
		equipment category to sit under.
	-->
	<h2 class="mt-8 mb-3 font-medium">Services</h2>
	{#if data.services.length === 0}
		<EmptyState
			title="No contractor work in this window"
			description="Work paid out to an instrument tech, an electrician or a service company shows here."
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th>Trade</th>
				<th class="col-support cell-num">Jobs</th>
				<th class="cell-num">Spend</th>
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
				<td>Total</td>
				<td class="col-support cell-num"></td>
				<td class="cell-num">{formatCents(data.servicesCents)}</td>
			</tr>
		</Table>
	{/if}

	<p class="mt-4 text-subtle">
		Gifts-in-kind are recorded but not reported here yet — see
		<a class="link" href={resolve('/staff/inventory')}>the inventory spec</a> for the disclosure that
		is still to come.
	</p>
</PageContent>
