<script lang="ts">
	/**
	 * The member's volunteering dashboard: a next-action stack beside a board.
	 *
	 * It used to be one page doing six jobs — three stat tiles, a prefill prompt,
	 * the board, a clearances list, the whole hour history, and two forms behind
	 * header modals. Everything was on it, so nothing on it was the next thing to
	 * do. The left column is now only what is owed or pending; the history moved
	 * to its own screen and is a single summary row here.
	 *
	 * The gate is still the gate: inside the wrapper `getMyVolunteerAccess` is
	 * awaited first, so its server-side redirect — an un-onboarded member to
	 * /start, a blocked one to /blocked — happens ahead of the rest rather than
	 * racing it. The page needs no client-side check of its own.
	 */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import ProfileFields from '$lib/components/volunteer/ProfileFields.svelte';
	import OpenShifts from '$lib/components/volunteer/OpenShifts.svelte';
	import MyShiftCard from '$lib/components/volunteer/MyShiftCard.svelte';
	import LogHoursAction from '$lib/components/volunteer/LogHoursAction.svelte';
	import { resolve } from '$app/paths';
	import { formatDateShort } from '$lib/utils/format';
	import { formatVolunteerHours, DEFAULT_TIMEZONE } from '$lib/config';
	import { getMemberVolunteerPage, updateVolunteerProfile } from '$lib/remote/volunteer.remote';

	const pageData = $derived(await getMemberVolunteerPage());

	function toDateInput(date: Date | null): string {
		// An unscheduled work order has no date of its own, so the log defaults to
		// today and the member adjusts it — the same thing a free entry does.
		return new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE }).format(
			date ? new Date(date) : new Date()
		);
	}

	/**
	 * Shift duration → the hours input, rounded to the quarter-hour step.
	 *
	 * Empty for an unscheduled work order: there is no window to infer from, and
	 * guessing a number the member then has to correct is worse than asking.
	 */
	function shiftHours(startsAt: Date | null, endsAt: Date | null): string {
		if (!startsAt || !endsAt) return '';
		const hours = (endsAt.getTime() - startsAt.getTime()) / 3_600_000;
		return String(Math.round(hours * 4) / 4);
	}

	// Everything they are on that has not been worked yet, plus anything worked
	// that still owes hours or feedback. A shift from March is history.
	//
	// An unscheduled work order has no window at all — it is work somebody needs
	// to do with no time booked for it — so it is never "old", and stays until it
	// is resolved or dropped.
	const liveShifts = $derived(
		pageData.myShifts.filter(
			(s) =>
				s.status !== 'completed' || !s.endsAt || s.endsAt > new Date(Date.now() - 14 * 86_400_000)
		)
	);

	const returned = $derived(pageData.logs.filter((l) => l.status === 'rejected').length);
	const expiring = $derived(
		pageData.certifications.filter((c) => c.state === 'expiring' || c.state === 'expired')
	);
</script>

<PageHeader title="Volunteering" subtitle="Member">
	<Button href={resolve('/member/volunteer/interests')} variant="ghost" size="sm">Interests</Button>
	<Button href={resolve('/member/volunteer/hours')} variant="ghost" size="sm">Hours</Button>
	<LogHoursAction roles={pageData.roles} label="Log Hours" />
	<!--
		Not in the redesign's three header actions, and kept anyway: it is the only
		way to correct a name or a phone number on the volunteer record, and the
		screens that replaced this page's modals do not cover it. Dropping a page's
		last door to a capability is a regression however tidy the result looks.
	-->
	<Action
		action={updateVolunteerProfile}
		label="Profile"
		variant="ghost"
		size="sm"
		modalTitle="Your volunteer profile"
		submitLabel="Save"
		successToast="Profile updated"
	>
		{#snippet form()}
			<ProfileFields
				fields={updateVolunteerProfile.fields}
				firstName={pageData.access.firstName}
				lastName={pageData.access.lastName}
				pronouns={pageData.access.pronouns}
				phone={pageData.access.phone}
				email={pageData.access.email}
			/>
		{/snippet}
	</Action>
</PageHeader>

<PageContent width="5xl">
	<div class="grid gap-6 lg:grid-cols-2">
		<div class="flex flex-col gap-6">
			{#if pageData.unloggedShifts.length > 0}
				<!--
					The only accented card on the page, because it is the only one that
					is genuinely owed: they did the work, and the record does not exist
					until they say what it was.
				-->
				<InfoCard title="Hours to log" class="border-l-4 border-warning">
					<ul class="flex flex-col gap-3">
						{#each pageData.unloggedShifts as owed (owed.signupId)}
							<li class="flex flex-wrap items-center justify-between gap-2">
								<div class="min-w-0">
									<div class="font-medium">{owed.roleName}</div>
									<div class="text-subtle text-sm">
										{#if owed.startsAt}
											{formatDateShort(owed.startsAt)} · {shiftHours(owed.startsAt, owed.endsAt)} hrs
										{:else}
											No time was booked for this — say how long it took.
										{/if}
									</div>
									<div class="text-subtle text-xs">Add what you did to file it.</div>
								</div>
								<LogHoursAction
									mode="shift"
									variant="primary"
									label="Log these hours"
									shift={{
										signupId: owed.signupId,
										shiftId: owed.shiftId,
										volunteerRoleId: owed.volunteerRoleId,
										roleName: owed.roleName,
										startsAt: owed.startsAt,
										hours: shiftHours(owed.startsAt, owed.endsAt),
										workedOn: toDateInput(owed.startsAt)
									}}
								/>
							</li>
						{/each}
					</ul>
				</InfoCard>
			{/if}

			<InfoCard title="Your shifts">
				{#if liveShifts.length === 0}
					<EmptyState
						title="You're not on any shifts"
						description="Claim one from the list beside this."
					/>
				{:else}
					<ul class="flex flex-col gap-3">
						{#each liveShifts as shift (shift.signupId)}
							<li><MyShiftCard {shift} /></li>
						{/each}
					</ul>
				{/if}
			</InfoCard>

			<!--
				Three rows, each a link into the screen that owns the thing. They
				replace three stat tiles and a full table: a number you cannot act on
				is decoration, and a number that takes you somewhere is navigation.
			-->
			<InfoCard title="Where you're at">
				<ul class="divide-y divide-base-300 text-sm">
					<li class="flex items-center justify-between gap-2 py-2">
						<span>
							{formatVolunteerHours(pageData.summary.approvedMinutes)} filed
							{#if returned > 0}
								<span class="text-warning">· {returned} returned</span>
							{/if}
						</span>
						<a href={resolve('/member/volunteer/hours')} class="link">Your hours →</a>
					</li>
					<li class="flex items-center justify-between gap-2 py-2">
						<span>
							{pageData.interests.length}
							{pageData.interests.length === 1 ? 'role' : 'roles'} selected
						</span>
						<a href={resolve('/member/volunteer/interests')} class="link">Interests →</a>
					</li>
					{#if expiring.length > 0}
						<li class="flex items-center justify-between gap-2 py-2">
							<span class="text-warning">
								{expiring[0].certificationName}
								{expiring[0].state === 'expired' ? 'has lapsed' : 'expires soon'}
							</span>
							<span class="text-subtle text-xs">Staff renew these</span>
						</li>
					{/if}
				</ul>
			</InfoCard>
		</div>

		<OpenShifts shifts={pageData.openShifts} hasInterests={pageData.interests.length > 0} />
	</div>
</PageContent>
