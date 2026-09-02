<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import StatCard from '$lib/components/ui/StatCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import OpenShifts from '$lib/components/volunteer/OpenShifts.svelte';
	import InterestFields from '$lib/components/volunteer/InterestFields.svelte';
	import ProfileFields from '$lib/components/volunteer/ProfileFields.svelte';
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
		getMemberVolunteerPage,
		saveVolunteerInterests,
		updateVolunteerProfile,
		submitVolunteerHours,
		editVolunteerHours,
		withdrawVolunteerHours
	} from '$lib/remote/volunteer.remote';

	// One query, seven `.then()` views off it. The gate is still the gate: inside the wrapper
	// `getMyVolunteerAccess` is awaited first, so its server-side redirect — an un-onboarded member
	// to /member/volunteer/start, a blocked one to /blocked — still happens ahead of the rest
	// rather than racing it. The page needs no client-side check of its own.
	const pageData = $derived(getMemberVolunteerPage());

	const access = $derived(pageData.then((d) => d.access));
	const roles = $derived(pageData.then((d) => d.roles));
	const interests = $derived(pageData.then((d) => d.interests));
	const openShifts = $derived(pageData.then((d) => d.openShifts));
	const unloggedShifts = $derived(pageData.then((d) => d.unloggedShifts));
	const logs = $derived(pageData.then((d) => d.logs));
	const summary = $derived(pageData.then((d) => d.summary));
	// `getMyCertifications` existed and had no caller anywhere, so a member could be told a
	// shift needed a clearance and had no page saying which ones they already hold
	// (docs/reports/volunteer-workflow-findings.md#d4).
	const certifications = $derived(pageData.then((d) => d.certifications));

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
	/**
	 * The pre-filled hours, when the shift had a window to derive them from.
	 *
	 * Work orders have none — nobody booked a time — so there is nothing to
	 * pre-fill and the member types what they actually did. An empty field is the
	 * honest default; a guess would be a number they might not check.
	 */
	function shiftHours(startsAt: Date | null, endsAt: Date | null): string {
		if (!startsAt || !endsAt) return '';
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
								{#if done.startsAt}
									<span class="text-muted"> — {formatDateShort(done.startsAt)}</span>
								{/if}
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
										value={done.startsAt ? toDateInput(done.startsAt) : today}
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

	{#await certifications then held}
		{@const current = held.filter((c) => c.state === 'current' || c.state === 'expiring')}
		{#if current.length > 0}
			<InfoCard title="What you're cleared for">
				<ul class="flex flex-col gap-2">
					{#each current as record (record.id)}
						<li class="flex flex-wrap items-center justify-between gap-2">
							<span class="font-medium">{record.certificationName}</span>
							{#if record.expiresAt}
								<span class:text-warning={record.state === 'expiring'} class="text-subtle">
									{record.state === 'expiring' ? 'expires' : 'valid until'}
									{formatDateShortYear(record.expiresAt)}
								</span>
							{:else}
								<span class="text-subtle">no expiry</span>
							{/if}
						</li>
					{/each}
				</ul>
			</InfoCard>
		{/if}
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
