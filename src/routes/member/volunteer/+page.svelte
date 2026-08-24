<script lang="ts">
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import StatCard from '$lib/components/shared/StatCard.svelte';
	import Table from '$lib/components/shared/Table.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import Action from '$lib/components/shared/Action.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import OpenShifts from '$lib/components/shared/volunteer/OpenShifts.svelte';
	import InterestFields from '$lib/components/shared/volunteer/InterestFields.svelte';
	import ProfileFields from '$lib/components/shared/volunteer/ProfileFields.svelte';
	import { IconHeartHandshake, IconUserCog } from '@tabler/icons-svelte';
	import { formatDateShort, formatDateShortYear } from '$lib/utils/format';
	import {
		clubToday,
		formatVolunteerHours,
		DEFAULT_TIMEZONE,
		VOLUNTEER_HOUR_STEP
	} from '$lib/config';
	import { IconPencil, IconTrash } from '@tabler/icons-svelte';
	import {
		getActiveVolunteerRoles,
		getMyVolunteerAccess,
		getMyVolunteerHours,
		getMyVolunteerInterests,
		getMyVolunteerSummary,
		getOpenShifts,
		getUnloggedShifts,
		saveVolunteerInterests,
		updateVolunteerProfile,
		submitVolunteerHours,
		editVolunteerHours,
		withdrawVolunteerHours
	} from '$lib/remote/volunteer.remote';

	// The gate. This query redirects an un-onboarded member to /member/volunteer/start
	// and a blocked one to /blocked, server-side — so the page never renders for
	// either and needs no client-side check of its own. It also carries the data
	// behind the two header modals.
	let access = $derived(getMyVolunteerAccess());
	let roles = $derived(getActiveVolunteerRoles());
	let interests = $derived(getMyVolunteerInterests());
	let openShifts = $derived(getOpenShifts());
	let unloggedShifts = $derived(getUnloggedShifts());
	let logs = $derived(getMyVolunteerHours());
	let summary = $derived(getMyVolunteerSummary());

	// Club time, not UTC: after 5pm PT the UTC date is already tomorrow, and the
	// service rejects a future date — so a UTC-defaulted input offered a value
	// that could not be submitted.
	const today = clubToday();

	function toDateInput(date: Date): string {
		return new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE }).format(new Date(date));
	}

	function toHoursInput(minutes: number): string {
		return String(minutes / 60);
	}

	/** Shift duration → the hours input, rounded to the quarter-hour step. */
	function shiftHours(startsAt: Date, endsAt: Date): string {
		const hours = (endsAt.getTime() - startsAt.getTime()) / 3_600_000;
		return String(Math.round(hours * 4) / 4);
	}
</script>

<PageHeader title="Volunteering" subtitle="Member">
	<!--
		Set-and-forget, so both are ghost buttons: Log Hours is the one people come
		back for. Interests used to be a form sitting open in the middle of the
		page, which pushed the shift board below the fold on every visit — and it
		belongs beside the board, since OpenShifts orders by exactly this set.
	-->
	{#await Promise.all([roles, interests, access]) then [roleOptions, myInterests, me]}
		{#if roleOptions.length > 0}
			<Action
				action={saveVolunteerInterests}
				label="Interests"
				icon={heartIcon}
				variant="ghost"
				size="sm"
				modalTitle="What you can help with"
				submitLabel="Save"
				successToast="Saved — we'll be in touch"
			>
				{#snippet form()}
					<InterestFields
						fields={saveVolunteerInterests.fields}
						{roleOptions}
						selected={myInterests}
						availability={me.availability}
					/>
				{/snippet}
			</Action>
		{/if}

		<Action
			action={updateVolunteerProfile}
			label="Profile"
			icon={profileIcon}
			variant="ghost"
			size="sm"
			modalTitle="Your volunteer profile"
			submitLabel="Save"
			successToast="Profile updated"
		>
			{#snippet form()}
				<ProfileFields
					fields={updateVolunteerProfile.fields}
					firstName={me.firstName}
					lastName={me.lastName}
					pronouns={me.pronouns}
					phone={me.phone}
					email={me.email}
				/>
			{/snippet}
		</Action>
	{/await}

	{#await roles then roleOptions}
		{#if roleOptions.length > 0}
			<Action
				action={submitVolunteerHours}
				label="Log Hours"
				modalTitle="Log volunteer hours"
				submitLabel="Submit for review"
				successToast="Hours submitted for review"
			>
				{#snippet form()}
					<FormField
						name="volunteerRoleId"
						label="What did you help with?"
						type="select"
						options={roleOptions.map((r) => ({ value: r.id, label: r.name }))}
					/>
					<FormField name="workedOn" label="Date" type="date" value={today} max={today} />
					<FormField
						name="hours"
						label="Hours"
						type="number"
						step={VOLUNTEER_HOUR_STEP}
						min="0.25"
						description="To the nearest quarter hour."
					/>
					<FormField
						name="description"
						label="What you did"
						type="textarea"
						description="A sentence is plenty — it's what staff read when reviewing."
					/>
				{/snippet}
			</Action>
		{/if}
	{/await}
</PageHeader>

<PageContent width="3xl">
	{#await summary then s}
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
			<StatCard title="Approved hours" value={formatVolunteerHours(s.approvedMinutes)} />
			<StatCard title="This year" value={formatVolunteerHours(s.approvedMinutesThisYear)} />
			<StatCard title="Awaiting review" value={formatVolunteerHours(s.pendingMinutes)} />
		</div>
	{/await}

	<!--
		Shifts first: a dated "we need someone on Saturday" is more actionable than
		a standing "I'd help with this", and the board is ordered so the roles they
		already said yes to surface at the top.
	-->
	<!--
		Completed shifts with no hour log yet. The member confirms rather than
		composes: role, date, and duration come from the shift, and the log lands
		in the queue marked as scheduled so staff can approve it on sight.
	-->
	{#await unloggedShifts then unlogged}
		{#if unlogged.length > 0}
			<InfoCard title="Log your shift hours" class="border-l-4 border-primary">
				<ul class="flex flex-col gap-3">
					{#each unlogged as done (done.signupId)}
						<li class="flex flex-wrap items-center justify-between gap-3">
							<div class="min-w-0">
								<span class="font-medium">{done.roleName}</span>
								<span class="text-muted"> — {formatDateShort(done.startsAt)}</span>
							</div>
							<Action
								action={submitVolunteerHours.for(done.signupId)}
								label="Log these hours"
								variant="primary"
								size="sm"
								modalTitle="Log hours for {done.roleName}"
								submitLabel="Submit for review"
								successToast="Hours submitted for review"
							>
								{#snippet form()}
									<input type="hidden" name="shiftId" value={done.shiftId} />
									<input type="hidden" name="volunteerRoleId" value={done.volunteerRoleId} />
									<FormField
										name="workedOn"
										label="Date"
										type="date"
										value={toDateInput(done.startsAt)}
										max={today}
									/>
									<FormField
										name="hours"
										label="Hours"
										type="number"
										step={VOLUNTEER_HOUR_STEP}
										min="0.25"
										value={shiftHours(done.startsAt, done.endsAt)}
										description="Pre-filled from the shift — adjust if you stayed longer or left early."
									/>
									<FormField
										name="description"
										label="What you did"
										type="textarea"
										value="Worked the {done.roleName} shift"
									/>
								{/snippet}
							</Action>
						</li>
					{/each}
				</ul>
			</InfoCard>
		{/if}
	{/await}

	{#await openShifts then shifts}
		<OpenShifts {shifts} />
	{/await}

	{#await logs then rows}
		<InfoCard title="Your hours">
			{#if rows.length === 0}
				<EmptyState
					title="No hours logged yet"
					description="Once you've helped out, log the time here and staff will review it."
				/>
			{:else}
				<Table>
					{#snippet head()}
						<th class="w-px"><span class="sr-only">Status</span></th>
						<th>Role</th>
						<th class="col-support cell-num">Hours</th>
						<th class="col-support whitespace-nowrap">Date</th>
						<th class="w-px"><span class="sr-only">Actions</span></th>
					{/snippet}

					{#each rows as log (log.id)}
						<tr>
							<td class="w-px"><StatusBadge status={log.status} /></td>
							<td class="cell-primary">
								<div class="truncate font-medium">{log.roleName}</div>
								<div class="truncate text-subtle" title={log.description}>
									{log.description}
								</div>
								{#if log.status === 'rejected' && log.reviewNotes}
									<div class="mt-1 text-xs text-error">{log.reviewNotes}</div>
								{/if}
							</td>
							<td class="col-support cell-num">{formatVolunteerHours(log.minutes)}</td>
							<td class="col-support whitespace-nowrap">{formatDateShortYear(log.workedOn)}</td>
							<td class="w-px">
								<!-- Editing and withdrawing both close the moment staff act on it. -->
								{#if log.status === 'pending'}
									{#await roles then roleOptions}
										<div class="flex justify-end gap-1">
											<Action
												action={editVolunteerHours.for(log.id)}
												label="Edit"
												iconOnly
												icon={pencilIcon}
												variant="ghost"
												size="sm"
												modalTitle="Edit hours"
												successToast="Hours updated"
											>
												{#snippet form()}
													<input type="hidden" name="id" value={log.id} />
													<FormField
														name="volunteerRoleId"
														label="What did you help with?"
														type="select"
														value={log.volunteerRoleId}
														options={roleOptions.map((r) => ({ value: r.id, label: r.name }))}
													/>
													<FormField
														name="workedOn"
														label="Date"
														type="date"
														value={toDateInput(log.workedOn)}
														max={today}
													/>
													<FormField
														name="hours"
														label="Hours"
														type="number"
														step={VOLUNTEER_HOUR_STEP}
														min="0.25"
														value={toHoursInput(log.minutes)}
													/>
													<FormField
														name="description"
														label="What you did"
														type="textarea"
														value={log.description}
													/>
												{/snippet}
											</Action>

											<Action
												action={withdrawVolunteerHours.for(log.id)}
												label="Withdraw"
												iconOnly
												icon={trashIcon}
												variant="ghost"
												size="sm"
												class="text-error"
												modalTitle="Withdraw these hours?"
												submitLabel="Withdraw"
												successToast="Hours withdrawn"
											>
												{#snippet form()}
													<input type="hidden" name="id" value={log.id} />
													<p class="text-sm">
														{formatVolunteerHours(log.minutes)} of {log.roleName} on
														{formatDateShort(log.workedOn)} will be deleted. You can log it again later.
													</p>
												{/snippet}
											</Action>
										</div>
									{/await}
								{/if}
							</td>
						</tr>
					{/each}
				</Table>
			{/if}
		</InfoCard>
	{/await}
</PageContent>

{#snippet heartIcon()}
	<IconHeartHandshake size={16} />
{/snippet}

{#snippet profileIcon()}
	<IconUserCog size={16} />
{/snippet}

{#snippet pencilIcon()}
	<IconPencil size={16} />
{/snippet}

{#snippet trashIcon()}
	<IconTrash size={16} />
{/snippet}
