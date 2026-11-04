<script lang="ts">
	import { m as msg } from '#lib/paraglide/messages.js';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { withQuery } from '#lib/utils/with-query.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import StatCard from '#lib/components/ui/StatCard.svelte';
	import DataList from '#lib/components/ui/DataList.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import DateRangeFilter from '#lib/components/ui/DateRangeFilter.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import { formatDateShortYear, formatCents } from '#lib/utils/format.js';
	import { formatVolunteerHours } from '#lib/config.js';
	import { getVolunteerReportPage } from '#lib/remote/volunteer.remote.js';
	import { IconDownload } from '@tabler/icons-svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';

	// Calendar year to date is what a board packet asks for, so it's the default
	// rather than "all time" — which would keep drifting as the org ages.
	const thisYear = new Date().getFullYear();
	const yearStart = `${thisYear}-01-01`;

	const initial = page.url.searchParams;
	let fromDate = $state(initial.get('from') ?? yearStart);
	let toDate = $state(initial.get('to') ?? '');
	let pageNumber = $state(Number(initial.get('page') ?? '1') || 1);

	$effect(() => {
		const pairs: [string, string][] = [];
		if (fromDate !== yearStart) pairs.push(['from', fromDate]);
		if (toDate) pairs.push(['to', toDate]);
		if (pageNumber > 1) pairs.push(['page', String(pageNumber)]);

		const search = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		const href = withQuery(resolve('/staff/reports/volunteering'), search);
		if (location.pathname + location.search !== href) {
			void goto(href, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});

	let range = $derived({ from: fromDate || undefined, to: toDate || undefined });
	const pageData = $derived(getVolunteerReportPage({ ...range, page: pageNumber }));
	const report = $derived(pageData.then((d) => d.report));
	const feedbackByRole = $derived(pageData.then((d) => d.feedbackByRole));
	const byMember = $derived(pageData.then((d) => d.byMember));
	const byGroup = $derived(pageData.then((d) => d.byGroup));
	const stillInReview = $derived(pageData.then((d) => d.stillInReview));

	// Refresh once on mount. An approval on /staff/volunteer changes these totals,
	// but it can't refresh them from there — `refresh()` is keyed by argument and
	// the queue page doesn't know this page's date range. Arriving here after
	// approving something would otherwise show cached pre-approval numbers, which
	// is exactly the staleness the no-caching decision exists to avoid.
	//
	// onMount rather than $effect: an effect tracking `range` would fire a second
	// fetch on top of the one the $derived above already issues for a new range.
	onMount(() => {
		void getVolunteerReportPage({ ...range, page: pageNumber }).refresh();
	});

	function monthLabel(month: string): string {
		const [year, m] = month.split('-');
		const date = new Date(Date.UTC(Number(year), Number(m) - 1, 1));
		return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
	}

	/**
	 * The export mirrors whatever range the page is showing.
	 *
	 * Built by hand rather than with `URLSearchParams`: both values are already
	 * `YYYY-MM-DD` off a date input, and the mutable class is what
	 * `svelte/prefer-svelte-reactivity` objects to inside a `$derived`.
	 */
	const exportHref = $derived(
		[fromDate ? `from=${fromDate}` : '', toDate ? `to=${toDate}` : '']
			.filter(Boolean)
			.join('&')
			.replace(/^(.+)$/, '?$1')
			.replace(/^/, '/staff/reports/volunteering/export')
	);

	function percent(part: number, whole: number): string {
		if (whole === 0) return '—';
		return `${Math.round((part / whole) * 100)}%`;
	}
</script>

<PageHeader title={msg.staff_reports_volunteering_volunteering()} subtitle={msg.staff_reports()}>
	<!--
		A plain anchor rather than an Action: the endpoint returns a file, not a
		value, so it is a `+server.ts` and the browser has to navigate to it for
		`Content-Disposition` to mean anything. `rel="external"` keeps the router
		out of it for the same reason — and is what the navigation lint rule wants
		for an href it cannot statically resolve.
	-->
	<Button href={exportHref} size="sm" rel="external" download>
		<IconDownload size={18} />
		{msg.staff_export_csv()}
	</Button>
</PageHeader>

<PageContent>
	<DateRangeFilter
		bind:from={fromDate}
		bind:to={toDate}
		defaultFrom={yearStart}
		onchange={() => (pageNumber = 1)}
	/>

	{#await report then r}
		<!-- Approved hours only. That is the whole point of the review step: this
		     is the number that has to hold up to a funder. -->
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<StatCard
				title={msg.staff_approved_hours()}
				value={formatVolunteerHours(r.totals.totalMinutes)}
			/>
			<StatCard title={msg.staff_volunteers()} value={r.totals.volunteerCount} />
			<StatCard title={msg.staff_reports_volunteering_logs()} value={r.totals.logCount} />
			<!--
				Not an average. Everything else on this page is approved-only by
				design, so without this the report cannot say how much work is still
				waiting to become a number — and "the total is low" and "the queue is
				long" are different problems with different fixes.
			-->
			{#await stillInReview then pending}
				<StatCard title={msg.staff_reports_volunteering_still_review()} value={pending} />
			{/await}
		</div>

		<!--
			Two valuations, side by side, never added. They overlap: a donated
			engineer's hour is in both, so a sum double-counts it and is wrong for
			the grant reader and the accountant alike. The copy under them says so
			rather than trusting the layout to.
		-->
		<InfoCard title={msg.staff_reports_volunteering_what_time_was_worth()}>
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<div>
					<StatCard
						bare
						title={msg.staff_impact_value()}
						value={formatCents(r.contributed.impactValueCents)}
					/>
					<p class="mt-1 text-subtle text-xs">
						{msg.staff_reports_volunteering_every_approved_hour_at_hr({
							formatCents: formatCents(r.contributed.rateCents)
						})}
					</p>
				</div>
				<div>
					<StatCard
						bare
						title={msg.staff_reports_volunteering_contributed_services()}
						value={formatCents(r.contributed.recognizableServicesCents)}
					/>
					<p class="mt-1 text-subtle text-xs">
						{msg.staff_reports_volunteering_specialized_hours_only_each_at()}
					</p>
				</div>
			</div>
			<p class="mt-3 text-subtle text-sm">
				{msg.staff_reports_volunteering_these_two_answers_two_different({
					rateSource: r.contributed.rateSource
				})}
			</p>
			{#if r.contributed.unpricedSpecializedMinutes > 0}
				<p class="mt-2 text-sm text-warning">
					{msg.staff_reports_volunteering_specialized_time_sits_role_with({
						formatVolunteerHours: formatVolunteerHours(r.contributed.unpricedSpecializedMinutes)
					})}
				</p>
			{/if}
		</InfoCard>

		{#await byGroup then groups}
			{#if groups.length > 0}
				<!-- Only when something named a program. Hours given to CMC at large
				     are the rest of this page, so a "no program" row would be a
				     restatement of the total under a confusing label. -->
				<InfoCard title={msg.staff_reports_volunteering_hours_by_committee_club()}>
					<Table>
						{#snippet head()}
							<th>{msg.staff_reports_volunteering_program()}</th>
							<th class="text-right">{msg.staff_reports_volunteering_hours()}</th>
							<th class="text-right">{msg.staff_people()}</th>
						{/snippet}
						{#each groups as g (g.groupId)}
							<tr>
								<td class="cell-primary">{g.groupName}</td>
								<td class="text-right tabular-nums">{formatVolunteerHours(g.minutes)}</td>
								<td class="text-right tabular-nums">{g.volunteerCount}</td>
							</tr>
						{/each}
					</Table>
				</InfoCard>
			{/if}
		{/await}

		<InfoCard title={msg.staff_reports_volunteering_hours_by_role()}>
			{#if r.byRole.length === 0}
				<EmptyState description={msg.staff_reports_volunteering_description()} />
			{:else}
				<!--
					A bar list rather than a table: the question this answers is "where
					does the labour actually go", which is a shape, and four columns of
					digits make you compute it yourself.
				-->
				<ul class="flex flex-col gap-3">
					{#each r.byRole as row (row.volunteerRoleId)}
						{@const share =
							r.totals.totalMinutes === 0 ? 0 : (row.minutes / r.totals.totalMinutes) * 100}
						<li>
							<div class="mb-1 flex items-baseline justify-between gap-3 text-sm">
								<span class="truncate">
									{row.roleName}{#if !row.roleIsActive}<span class="ml-1 text-subtle"
											>{msg.staff_reports_volunteering_archived()}</span
										>{/if}{#if row.isSpecializedSkill}<Badge
											class="ml-2"
											variant={row.marketRateCents === null ? 'warning' : 'outline'}
											>{row.marketRateCents === null
												? msg.staff_reports_volunteering_specialized_unpriced()
												: msg.staff_reports_volunteering_specialized_hr({
														formatCents: formatCents(row.marketRateCents)
													})}</Badge
										>{/if}
								</span>
								<span class="whitespace-nowrap">
									{formatVolunteerHours(row.minutes)}
									<span class="text-subtle">{percent(row.minutes, r.totals.totalMinutes)}</span>
								</span>
							</div>
							<div class="h-2 w-full rounded-full bg-base-200">
								<div class="h-2 rounded-full bg-primary" style="width: {share}%"></div>
							</div>
						</li>
					{/each}
				</ul>
				<p class="mt-3 text-subtle text-xs">
					{msg.staff_reports_volunteering_approved_logs_only()}
				</p>
			{/if}
		</InfoCard>

		<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
			<InfoCard title={msg.staff_reports_volunteering_by_month()}>
				{#if r.byMonth.length === 0}
					<EmptyState description={msg.staff_reports_volunteering_description()} />
				{:else}
					<Table>
						{#snippet head()}
							<th>{msg.staff_reports_volunteering_month()}</th>
							<th class="cell-num">{msg.staff_reports_volunteering_hours()}</th>
							<th class="col-support cell-num">{msg.staff_reports_volunteering_logs()}</th>
						{/snippet}
						{#each r.byMonth as row (row.month)}
							<tr>
								<td class="cell-primary whitespace-nowrap">{monthLabel(row.month)}</td>
								<td class="cell-num">{formatVolunteerHours(row.minutes)}</td>
								<td class="col-support cell-num">{row.logCount}</td>
							</tr>
						{/each}
					</Table>
				{/if}
			</InfoCard>
		</div>
	{/await}

	<InfoCard title={msg.staff_reports_volunteering_by_member()}>
		<DataList
			result={byMember}
			empty={msg.staff_reports_volunteering_empty()}
			onpage={(p) => (pageNumber = p)}
		>
			{#snippet children(members)}
				<Table>
					{#snippet head()}
						<th>{msg.staff_member()}</th>
						<th class="cell-num">{msg.staff_reports_volunteering_hours()}</th>
						<th class="col-support cell-num">{msg.staff_reports_volunteering_logs()}</th>
						<th class="col-support whitespace-nowrap"
							>{msg.staff_reports_volunteering_last_worked()}</th
						>
					{/snippet}
					{#each members as m (m.userId)}
						<tr class="hover">
							<td class="cell-primary">
								<EntityIdentity ref={m.member} />
							</td>
							<td class="cell-num">{formatVolunteerHours(m.minutes)}</td>
							<td class="col-support cell-num">{m.logCount}</td>
							<td class="col-support whitespace-nowrap">{formatDateShortYear(m.lastWorkedOn)}</td>
						</tr>
					{/each}
				</Table>
			{/snippet}
		</DataList>
	</InfoCard>

	<!--
		Anonymous by design: this exists to fix briefings and setups, and names
		would just teach volunteers to answer politely. Not date-filtered like the
		hours tables above — the sample is small enough that slicing it hides the
		signal.
	-->
	{#await feedbackByRole then rollup}
		{#if rollup.length > 0}
			<InfoCard title={msg.staff_reports_volunteering_how_shifts_going()}>
				<Table>
					{#snippet head()}
						<th>{msg.staff_role()}</th>
						<th class="cell-num">{msg.staff_reports_volunteering_avg_rating()}</th>
						<th class="col-support cell-num">{msg.staff_reports_volunteering_set_up_succeed()}</th>
						<th class="col-support cell-num">{msg.staff_reports_volunteering_responses()}</th>
					{/snippet}

					{#each rollup as role (role.volunteerRoleId)}
						<tr data-feedback-role={role.volunteerRoleId}>
							<td class="cell-primary">
								<div class="truncate font-medium">{role.roleName}</div>
								{#if role.latestComments.length > 0}
									<div class="truncate text-subtle" title={role.latestComments[0].comment}>
										"{role.latestComments[0].comment}"
									</div>
								{/if}
							</td>
							<td class="cell-num">{role.averageRating.toFixed(1)} / 5</td>
							<td class="col-support cell-num">
								<span class:text-warning={role.setUpShare < 0.8}>
									{Math.round(role.setUpShare * 100)}%
								</span>
							</td>
							<td class="col-support cell-num">{role.responses}</td>
						</tr>
					{/each}
				</Table>
			</InfoCard>
		{/if}
	{/await}
</PageContent>
