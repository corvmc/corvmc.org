<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { withQuery } from '$lib/utils/with-query';
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
	import { shownCents } from '../display';
	import StaffViews from '../../StaffViews.svelte';
	import { reportViews } from '../views';
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
		const href = withQuery(resolve('/staff/reports/annual'), search);
		if (location.pathname + location.search !== href) {
			void goto(href, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});

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
			"Money held on someone else's behalf — a band's share of the door. Never the collective's income."
	};

	// Last, and a top-level await rather than `{#await}`: a refusal has to reach the
	// panel's boundary, which an `{#await}` with no `{:catch}` renders as nothing.
	const r = $derived(
		await getAnnualReportPage({ from: fromDate || undefined, to: toDate || undefined })
	);
</script>

<PageHeader title={m.staff_reports()} documentTitle={m.staff_reports_annual_report()}>
	<StaffViews views={reportViews} active="annual" collapse />
</PageHeader>

<PageContent>
	<DateRangeFilter bind:from={fromDate} bind:to={toDate} defaultFrom={yearStart}>
		{#snippet actions()}
			<!--
				A plain anchor rather than an Action: the endpoint returns a file, so it is
				a `+server.ts` and the browser has to navigate to it for
				`Content-Disposition` to mean anything.
			-->
			<Button href={exportHref} rel="external" download>
				<IconDownload size={18} />
				{m.staff_export_csv()}
			</Button>
		{/snippet}
	</DateRangeFilter>

	{#if r.coverage.startsAt && !r.coverage.complete}
		<!--
			Said plainly rather than shown as a warning colour. Nothing is broken:
			the app's financial record simply begins where its payment history
			does, and a range reaching further back returns a smaller number with
			no way to tell that apart from a quiet year.
		-->
		<Alert type="info">
			{m.staff_reports_financial_record_begins_money_collective({
				formatDateLong: formatDateLong(r.coverage.startsAt)
			})}
		</Alert>
	{/if}

	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
		<StatCard title={m.staff_reports_earned()} value={formatCents(r.money.totalsByKind.earned)} />
		<StatCard
			title={m.staff_reports_spent()}
			value={formatCents(shownCents('spent', r.money.totalsByKind.spent))}
		/>
		<StatCard title={m.staff_reports_net()} value={formatCents(r.money.netCents)} />
		<StatCard
			title={m.staff_reports_given_kind()}
			value={formatCents(r.money.totalsByKind.in_kind)}
		/>
	</div>

	{#each ['earned', 'spent', 'in_kind', 'pass_through'] as const as kind (kind)}
		<InfoCard title={kindTitles[kind]}>
			<p class="mb-3 text-subtle text-sm">{kindNotes[kind]}</p>
			{#if r.money.byKind[kind].length === 0}
				<EmptyState description={m.staff_reports_description()} />
			{:else}
				<Table>
					{#snippet head()}
						<th>{m.staff_reports_line()}</th>
						<th class="text-right">{m.staff_amount()}</th>
					{/snippet}
					{#each r.money.byKind[kind] as line (line.category)}
						<tr>
							<td>{financialCategoryLabels[line.category]}</td>
							<td class="text-right tabular-nums"
								>{formatCents(shownCents(kind, line.totalCents))}</td
							>
						</tr>
					{/each}
					<tr class="font-semibold">
						<td>{m.staff_reports_total()}</td>
						<td class="text-right tabular-nums"
							>{formatCents(shownCents(kind, r.money.totalsByKind[kind]))}</td
						>
					</tr>
				</Table>
			{/if}
		</InfoCard>
	{/each}

	<InfoCard title={m.staff_reports_donated_time()}>
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
			<StatCard
				title={m.staff_approved_hours()}
				value={formatVolunteerHours(r.volunteering.totals.totalMinutes)}
			/>
			<StatCard title={m.staff_volunteers()} value={r.volunteering.totals.volunteerCount} />
			<StatCard
				title={m.staff_impact_value()}
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
			<ParaglideMessage
				message={m.staff_reports_impact_value_prices_every_approved}
				inputs={{
					formatCents: formatCents(r.volunteering.contributed.rateCents),
					formatCents2: formatCents(r.volunteering.contributed.recognizableServicesCents)
				}}
				>{#snippet strong({ children })}<strong>{@render children?.()}</strong
					>{/snippet}</ParaglideMessage
			>
		</p>
	</InfoCard>

	<InfoCard title={m.staff_events()}>
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<StatCard title={m.staff_reports_cmc_events()} value={r.events.cmcTotal} />
			<StatCard title={m.staff_reports_band_listings()} value={r.events.bandListings} />
			<StatCard title={m.staff_reports_community_listings()} value={r.events.communityListings} />
			<StatCard title={m.staff_cancelled()} value={r.events.cancelled} />
		</div>
		<Table class="mt-4">
			{#snippet head()}
				<th>{m.staff_reports_cmc_events_by_kind()}</th>
				<th class="text-right">{m.staff_reports_held()}</th>
			{/snippet}
			{#each Object.entries(r.events.cmcByKind) as [kind, total] (kind)}
				<tr>
					<td>{eventKindLabels[kind as keyof typeof eventKindLabels]}</td>
					<td class="text-right tabular-nums">{total}</td>
				</tr>
			{/each}
		</Table>
		<p class="mt-3 text-subtle text-sm">
			{m.staff_reports_counts_not_attendance_only_minority()}
		</p>
	</InfoCard>

	<InfoCard title={m.staff_reports_practice_room()}>
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<StatCard title={m.staff_reports_hours_booked()} value={r.room.hours} />
			<StatCard title={m.staff_reports_sessions()} value={r.room.sessions} />
			<StatCard title={m.staff_reports_distinct_bookers()} value={r.room.distinctBookers} />
			<StatCard title={m.staff_reports_no_shows()} value={r.room.noShows} />
		</div>
		<p class="mt-3 text-subtle text-sm">
			{m.staff_reports_hours_room_was_held_including()}
		</p>
	</InfoCard>

	<InfoCard title={m.staff_reports_membership()}>
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
			<StatCard
				title={m.staff_reports_sustaining_members()}
				value={r.membership.sustainingMemberCount}
			/>
			<StatCard
				title={m.staff_reports_practice_hours_funded()}
				value={r.membership.totalFreeHoursAllocated}
			/>
			<StatCard
				title={m.staff_reports_participation()}
				value={`${r.membership.participationPercent}%`}
			/>
		</div>
		<p class="mt-3 text-subtle text-sm">
			{m.staff_reports_as_today_not_over_range()}
		</p>
	</InfoCard>
</PageContent>
