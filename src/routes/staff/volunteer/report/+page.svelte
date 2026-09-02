<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { formatDateShortYear } from '$lib/utils/format';
	import { formatVolunteerHours } from '$lib/config';
	import { getVolunteerReportPage } from '$lib/remote/volunteer.remote';

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
		const href = `${resolve('/staff/volunteer/report')}${search ? `?${search}` : ''}`;
		if (location.pathname + location.search !== href) {
			void goto(href, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});

	let range = $derived({ from: fromDate || undefined, to: toDate || undefined });
	const pageData = $derived(getVolunteerReportPage({ ...range, page: pageNumber }));
	const report = $derived(pageData.then((d) => d.report));
	const feedbackByRole = $derived(pageData.then((d) => d.feedbackByRole));
	const byMember = $derived(pageData.then((d) => d.byMember));
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

	const activeFilterCount = $derived((fromDate !== yearStart ? 1 : 0) + (toDate ? 1 : 0));

	function clearFilters() {
		fromDate = yearStart;
		toDate = '';
		pageNumber = 1;
	}

	function monthLabel(month: string): string {
		const [year, m] = month.split('-');
		const date = new Date(Number(year), Number(m) - 1, 1);
		return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
	}

	function percent(part: number, whole: number): string {
		if (whole === 0) return '—';
		return `${Math.round((part / whole) * 100)}%`;
	}
</script>

<PageHeader title="Report" subtitle="Volunteering" backHref="/staff/volunteer" />

<PageContent>
	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<div class="flex flex-wrap items-center gap-2">
				<label class="text-muted" for="report-from">From</label>
				<input
					id="report-from"
					type="date"
					class="input input-sm"
					value={fromDate}
					onchange={(e) => {
						fromDate = (e.currentTarget as HTMLInputElement).value;
						pageNumber = 1;
					}}
				/>
				<label class="text-muted" for="report-to">To</label>
				<input
					id="report-to"
					type="date"
					class="input input-sm"
					value={toDate}
					onchange={(e) => {
						toDate = (e.currentTarget as HTMLInputElement).value;
						pageNumber = 1;
					}}
				/>
			</div>
		{/snippet}
	</FilterBar>

	{#await report then r}
		<!-- Approved hours only. That is the whole point of the review step: this
		     is the number that has to hold up to a funder. -->
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
			<StatCard title="Approved hours" value={formatVolunteerHours(r.totals.totalMinutes)} />
			<StatCard title="Volunteers" value={r.totals.volunteerCount} />
			<StatCard title="Logs" value={r.totals.logCount} />
			<!--
				Not an average. Everything else on this page is approved-only by
				design, so without this the report cannot say how much work is still
				waiting to become a number — and "the total is low" and "the queue is
				long" are different problems with different fixes.
			-->
			{#await stillInReview then pending}
				<StatCard title="Still in review" value={pending} />
			{/await}
		</div>

		<InfoCard title="Hours by role">
			{#if r.byRole.length === 0}
				<EmptyState description="No approved hours in this range." />
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
											>(archived)</span
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
				<p class="mt-3 text-subtle text-xs">Approved logs only.</p>
			{/if}
		</InfoCard>

		<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
			<InfoCard title="By month">
				{#if r.byMonth.length === 0}
					<EmptyState description="No approved hours in this range." />
				{:else}
					<Table>
						{#snippet head()}
							<th>Month</th>
							<th class="cell-num">Hours</th>
							<th class="col-support cell-num">Logs</th>
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

	<InfoCard title="By member">
		<DataList
			result={byMember}
			empty="No approved hours in this range"
			onpage={(p) => (pageNumber = p)}
		>
			{#snippet children(members)}
				<Table>
					{#snippet head()}
						<th>Member</th>
						<th class="cell-num">Hours</th>
						<th class="col-support cell-num">Logs</th>
						<th class="col-support whitespace-nowrap">Last worked</th>
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
			<InfoCard title="How shifts are going">
				<Table>
					{#snippet head()}
						<th>Role</th>
						<th class="cell-num">Avg rating</th>
						<th class="col-support cell-num">Set up to succeed</th>
						<th class="col-support cell-num">Responses</th>
					{/snippet}

					{#each rollup as role (role.volunteerRoleId)}
						<tr>
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
