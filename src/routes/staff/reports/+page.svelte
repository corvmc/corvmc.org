<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import DateRangeFilter from '$lib/components/ui/DateRangeFilter.svelte';
	import { formatCents, formatDateLong } from '$lib/utils/format';
	import {
		formatVolunteerHours,
		financialCategoryLabels,
		eventKindLabels,
		type FinancialEntryKind
	} from '$lib/config';
	import { getAnnualReportPage } from '$lib/remote/reports.remote';
	import { IconDownload } from '@tabler/icons-svelte';

	// The calendar year, because that is the period a board packet and a Form 990
	// are both written against. A fiscal year that is not the calendar year is a
	// date change, not a different report.
	const thisYear = new Date().getFullYear();
	const yearStart = `${thisYear}-01-01`;

	const initial = page.url.searchParams;
	let fromDate = $state(initial.get('from') ?? yearStart);
	let toDate = $state(initial.get('to') ?? '');

	$effect(() => {
		const pairs: [string, string][] = [];
		if (fromDate !== yearStart) pairs.push(['from', fromDate]);
		if (toDate) pairs.push(['to', toDate]);

		const search = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		const href = `${resolve('/staff/reports')}${search ? `?${search}` : ''}`;
		if (location.pathname + location.search !== href) {
			void goto(href, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});

	const report = $derived(
		getAnnualReportPage({ from: fromDate || undefined, to: toDate || undefined })
	);

	const exportHref = $derived(
		[fromDate ? `from=${fromDate}` : '', toDate ? `to=${toDate}` : '']
			.filter(Boolean)
			.join('&')
			.replace(/^(.+)$/, '?$1')
			.replace(/^/, '/staff/reports/export')
	);

	/**
	 * A spend line is stored positive and reads as a cost, so it is not negated
	 * here — except `refund_absorbed`, which the ledger already stores negative
	 * against earnings. Flipping every spend line's sign would make the two
	 * disagree in the same column.
	 */
	const kindTitles: Record<FinancialEntryKind, string> = {
		earned: 'Earned',
		spent: 'Spent',
		in_kind: 'Given in kind',
		pass_through: 'Collected for others'
	};

	const kindNotes: Record<FinancialEntryKind, string> = {
		earned: 'What the collective kept, after refunds.',
		spent: 'What it paid out for goods, services and fees.',
		in_kind:
			'Donated goods and specialized volunteer time, at market value. Not cash, and not part of net.',
		pass_through:
			"Money held on someone else's behalf — an act's share of the door. Never the collective's income."
	};
</script>

<PageHeader title="Annual report" subtitle="Reports">
	<!--
		A plain anchor rather than an Action: the endpoint returns a file, so it is
		a `+server.ts` and the browser has to navigate to it for
		`Content-Disposition` to mean anything.
	-->
	<Button href={exportHref} size="sm" rel="external" download>
		<IconDownload size={18} />
		Export CSV
	</Button>
</PageHeader>

<PageContent>
	<DateRangeFilter bind:from={fromDate} bind:to={toDate} defaultFrom={yearStart} />

	{#await report then r}
		{#if r.coverage.startsAt && !r.coverage.complete}
			<!--
				Said plainly rather than shown as a warning colour. Nothing is broken:
				the app's financial record simply begins where its payment history
				does, and a range reaching further back returns a smaller number with
				no way to tell that apart from a quiet year.
			-->
			<Alert type="info">
				The financial record begins {formatDateLong(r.coverage.startsAt)}. Money the collective took
				in before then was never recorded here, so the lines below cover only the part of this range
				the record reaches.
			</Alert>
		{/if}

		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<StatCard title="Earned" value={formatCents(r.money.totalsByKind.earned)} />
			<StatCard title="Spent" value={formatCents(r.money.totalsByKind.spent)} />
			<StatCard title="Net" value={formatCents(r.money.netCents)} />
			<StatCard title="Given in kind" value={formatCents(r.money.totalsByKind.in_kind)} />
		</div>

		{#each ['earned', 'spent', 'in_kind', 'pass_through'] as const as kind (kind)}
			<InfoCard title={kindTitles[kind]}>
				<p class="mb-3 text-subtle text-sm">{kindNotes[kind]}</p>
				{#if r.money.byKind[kind].length === 0}
					<EmptyState description="Nothing recorded in this range." />
				{:else}
					<Table>
						{#snippet head()}
							<th>Line</th>
							<th class="text-right">Amount</th>
						{/snippet}
						{#each r.money.byKind[kind] as line (line.category)}
							<tr>
								<td>{financialCategoryLabels[line.category]}</td>
								<td class="text-right tabular-nums">{formatCents(line.totalCents)}</td>
							</tr>
						{/each}
						<tr class="font-semibold">
							<td>Total</td>
							<td class="text-right tabular-nums">{formatCents(r.money.totalsByKind[kind])}</td>
						</tr>
					</Table>
				{/if}
			</InfoCard>
		{/each}

		<InfoCard title="Donated time">
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
				<StatCard
					title="Approved hours"
					value={formatVolunteerHours(r.volunteering.totals.totalMinutes)}
				/>
				<StatCard title="Volunteers" value={r.volunteering.totals.volunteerCount} />
				<StatCard
					title="Impact value"
					value={formatCents(r.volunteering.contributed.impactValueCents)}
				/>
			</div>
			<!--
				Two valuations that must never be added: a donated engineer's hour is
				in both. The contributed-services figure is the narrower one a
				financial statement can recognise, and it is the only one that appears
				in the in-kind table above.
			-->
			<p class="mt-3 text-subtle text-sm">
				Impact value prices every approved hour at {formatCents(
					r.volunteering.contributed.rateCents
				)}/hr and is the figure a grant application asks for. The narrower
				<strong>{formatCents(r.volunteering.contributed.recognizableServicesCents)}</strong> of specialized
				time is what a financial statement can recognise, and it is the amount already counted as contributed
				services above. The two overlap; adding them double-counts.
			</p>
		</InfoCard>

		<InfoCard title="Events">
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard title="CMC events" value={r.events.cmcTotal} />
				<StatCard title="Band listings" value={r.events.bandListings} />
				<StatCard title="Community listings" value={r.events.communityListings} />
				<StatCard title="Cancelled" value={r.events.cancelled} />
			</div>
			<Table class="mt-4">
				{#snippet head()}
					<th>CMC events by kind</th>
					<th class="text-right">Held</th>
				{/snippet}
				{#each Object.entries(r.events.cmcByKind) as [kind, total] (kind)}
					<tr>
						<td>{eventKindLabels[kind as keyof typeof eventKindLabels]}</td>
						<td class="text-right tabular-nums">{total}</td>
					</tr>
				{/each}
			</Table>
			<p class="mt-3 text-subtle text-sm">
				Counts, not attendance. Only a minority of shows are ticketed and RSVPs are optional, so any
				head count the app could produce would be a fraction of the real one.
			</p>
		</InfoCard>

		<InfoCard title="Practice room">
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard title="Hours booked" value={r.room.hours} />
				<StatCard title="Sessions" value={r.room.sessions} />
				<StatCard title="Distinct bookers" value={r.room.distinctBookers} />
				<StatCard title="No-shows" value={r.room.noShows} />
			</div>
			<p class="mt-3 text-subtle text-sm">
				Hours the room was held, including comped and credit-covered time. That is why this does not
				track the practice-room revenue line above.
			</p>
		</InfoCard>

		<InfoCard title="Membership">
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
				<StatCard title="Sustaining members" value={r.membership.sustainingMemberCount} />
				<StatCard title="Practice hours funded" value={r.membership.totalFreeHoursAllocated} />
				<StatCard title="Participation" value={`${r.membership.participationPercent}%`} />
			</div>
			<p class="mt-3 text-subtle text-sm">
				As of today, not over the range — a subscription count is a snapshot, and there is no
				history of it to look back through.
			</p>
		</InfoCard>
	{/await}
</PageContent>
