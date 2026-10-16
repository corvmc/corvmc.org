<script lang="ts">
	/**
	 * The volunteer coordinator's dashboard.
	 *
	 * This route used to be a filtered table of hour logs — one of the six things below, and
	 * the only one that had a surface at all. The rest were spread across pages you had to
	 * already know to visit, so "what needs me today" had no answer anywhere in the panel
	 * (docs/reports/volunteer-workflow-findings.md#d1). The tables all still exist; they are
	 * children of this page now.
	 *
	 * The pattern, which `/staff/instructors` reached for first and
	 * `docs/development/ui-patterns.md#section-dashboards` now writes down:
	 *
	 * 1. one load-bearing query for the whole page;
	 * 2. cards ordered by who is being waited on — staff first, then a member;
	 * 3. a card is hidden when empty, so a visible card always means something;
	 * 4. the action is on the row, in a modal — no navigation to finish a task;
	 * 5. every card links to the table it summarises, which is the escape hatch.
	 */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { resolve } from '$app/paths';
	import NeedsConfirmingCard from './NeedsConfirmingCard.svelte';
	import ShortStaffedCard from './ShortStaffedCard.svelte';
	import HoursToReviewCard from './HoursToReviewCard.svelte';
	import PendingReviewCard from './PendingReviewCard.svelte';
	import CloseOutCard from './CloseOutCard.svelte';
	import NeedsSchedulingCard from './NeedsSchedulingCard.svelte';
	import ConfirmFixedCard from './ConfirmFixedCard.svelte';
	import LapsingCard from './LapsingCard.svelte';
	import NewWorkOrderAction from './NewWorkOrderAction.svelte';
	import LogHoursForMemberAction from '$lib/components/volunteer/LogHoursForMemberAction.svelte';
	import { DEFAULT_TIMEZONE } from '$lib/config';
	import { getVolunteerWorklist } from '$lib/remote/volunteer.remote';

	const work = $derived(await getVolunteerWorklist());

	// The day, then the size of the pile. A worklist that does not say which day
	// it is describing is a list; saying it is what makes it a shift.
	const today = new Intl.DateTimeFormat('en-US', {
		weekday: 'long',
		month: 'short',
		day: 'numeric',
		timeZone: DEFAULT_TIMEZONE
	}).format(new Date());

	const waiting = $derived(work.waitingCount + work.lapsing.length);
</script>

<PageHeader title="Volunteering">
	<!-- Not a sidebar row: roles are set up now and then, not worked daily (#1791). -->
	<Button variant="ghost" size="sm" href={resolve('/staff/volunteer/roles')}>Roles</Button>
	<LogHoursForMemberAction />
	<NewWorkOrderAction />
</PageHeader>

<PageContent>
	<p class="text-subtle text-sm">
		{today} ·
		{waiting === 0 ? 'nothing waiting' : `${waiting} ${waiting === 1 ? 'item' : 'items'} waiting`}
	</p>

	{#if work.waitingCount === 0 && work.lapsing.length === 0}
		<!--
			The correct rendering of a clear queue, and the reason every card below is
			hidden when empty: a card on screen has to mean somebody is waiting.
		-->
		<EmptyState
			title="Nothing waiting"
			description="All claims confirmed, all hours reviewed, no short shifts in the next two weeks."
		>
			<p class="font-semibold">Nothing waiting</p>
			<p>All claims confirmed, all hours reviewed, no short shifts in the next two weeks.</p>
			<div class="mt-4 flex flex-wrap justify-center gap-2">
				<Button href="/staff/volunteer/schedule" variant="ghost" size="sm">Schedule</Button>
				<Button href="/staff/volunteer/people" variant="ghost" size="sm">People</Button>
				<Button href="/staff/volunteer/report" variant="ghost" size="sm">Report</Button>
			</div>
		</EmptyState>
	{/if}

	<!-- Row-major, so priority order still reads left to right, then down. -->
	<div class="grid items-start gap-6 @5xl:grid-cols-2 [&>*]:min-w-0">
		{#if work.needsConfirming.length > 0}
			<NeedsConfirmingCard claims={work.needsConfirming} total={work.needsConfirmingTotal} />
		{/if}

		{#if work.shortStaffed.length > 0}
			<ShortStaffedCard shifts={work.shortStaffed} total={work.shortStaffedTotal} />
		{/if}

		{#if work.pendingHours.length > 0}
			<HoursToReviewCard logs={work.pendingHours} total={work.pendingHoursTotal} />
		{/if}

		{#if work.blockedVolunteers.length > 0}
			<PendingReviewCard rows={work.blockedVolunteers} total={work.blockedVolunteersTotal} />
		{/if}

		{#if work.unscheduled.length > 0}
			<NeedsSchedulingCard orders={work.unscheduled} total={work.unscheduledTotal} />
		{/if}

		{#if work.toConfirm.length > 0}
			<ConfirmFixedCard orders={work.toConfirm} total={work.toConfirmTotal} />
		{/if}

		{#if work.closeOut.length > 0}
			<CloseOutCard claims={work.closeOut} total={work.closeOutTotal} />
		{/if}

		{#if work.lapsing.length > 0}
			<LapsingCard rows={work.lapsing} total={work.lapsingTotal} />
		{/if}
	</div>
</PageContent>
