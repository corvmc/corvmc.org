<script lang="ts">
	import CardTitle from '$lib/components/shared/Card/CardTitle.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import Table from '$lib/components/shared/Table.svelte';
	import DataList from '$lib/components/shared/DataList.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import { EntityIdentity } from '$lib/components/shared/entity';
	import Button from '$lib/components/shared/Button.svelte';
	import Action from '$lib/components/shared/Action.svelte';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import { Field, CheckboxGroup } from '$lib/components/shared/Form';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import ShiftFormFields from '$lib/components/shared/volunteer/ShiftFormFields.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { formatDateShort, toLocalDateTime } from '$lib/utils/format';
	import { DEFAULT_TIMEZONE, volunteerRoleGroups, volunteerRoleGroupLabels } from '$lib/config';
	import { IconArchive, IconArchiveOff, IconTrash, IconDeviceFloppy } from '@tabler/icons-svelte';
	import {
		getVolunteerRoleDetail,
		getRoleRequirements,
		getActiveCertifications,
		getInterestedVolunteers,
		getShifts,
		getFeedbackByRole,
		createShift,
		updateVolunteerRole,
		archiveVolunteerRole,
		restoreVolunteerRole,
		deleteVolunteerRole,
		setRoleCertifications
	} from '$lib/remote/volunteer.remote';

	const { fields } = updateVolunteerRole;

	let id = $derived(page.params.id!);
	let role = $derived(await getVolunteerRoleDetail(id));
	let requirements = $derived(getRoleRequirements(id));
	let certifications = $derived(getActiveCertifications());

	let pageNumber = $state(1);
	let interested = $derived(getInterestedVolunteers({ volunteerRoleId: id, page: pageNumber }));

	// Pinned once, not recomputed in the `$derived`. `refresh()` is keyed by
	// argument, so a `from` that ticks with the clock would mint a new key on every
	// re-evaluation and the refresh after creating a shift would miss its query.
	const from = new Date().toISOString();
	let shifts = $derived(getShifts({ volunteerRoleId: id, from }));
	let feedback = $derived(getFeedbackByRole());

	const groupOptions = volunteerRoleGroups.map((g) => ({
		value: g,
		label: volunteerRoleGroupLabels[g]
	}));

	function timeRange(start: Date, end: Date): string {
		const fmt = new Intl.DateTimeFormat('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			timeZone: DEFAULT_TIMEZONE
		});
		return `${fmt.format(start)}–${fmt.format(end)}`;
	}

	// Tomorrow, running for however long this role usually runs.
	const START_MS = Date.now() + 86_400_000;
	let shiftStart = $derived(toLocalDateTime(new Date(START_MS)));
	let shiftEnd = $derived(
		toLocalDateTime(new Date(START_MS + (role.defaultDurationMinutes ?? 4 * 60) * 60_000))
	);

	// Until there's an in-app way to mail volunteers, the useful move is to hand
	// staff the addresses for whatever they're looking at. Copies the page in
	// view, and says so, rather than implying it grabbed everyone.
	async function copyEmails(emails: string[]) {
		try {
			await navigator.clipboard.writeText(emails.join(', '));
			toast.success(`Copied ${emails.length} ${emails.length === 1 ? 'address' : 'addresses'}`);
		} catch {
			toast.error("Couldn't copy — your browser blocked clipboard access");
		}
	}
</script>

<!--
	Every `Action` sits outside the edit `<Form>`. `Button` renders a bits-ui
	`Button.Root`, which leaves `type` unset — so an action trigger nested in the
	form would default to `type="submit"` and post the role edit on click.
-->
<PageHeader title={role.name} subtitle="Volunteer Role" backHref="/staff/volunteer/roles">
	<StatusBadge status={role.isActive ? 'active' : 'retired'} label />

	<!--
		Archive rather than delete is the normal retirement path: the role's hour
		logs stay resolvable in every report. Delete is offered only for a role
		nothing was ever logged against.
	-->
	{#if role.isActive}
		<Action
			action={archiveVolunteerRole}
			label="Archive"
			icon={archiveIcon}
			variant="ghost"
			size="sm"
			modalTitle="Archive {role.name}?"
			submitLabel="Archive"
			successToast="Role archived"
		>
			{#snippet form()}
				<input type="hidden" name="id" value={role.id} />
				<p class="text-sm">
					Members won't be able to log new hours against this role. Existing hours stay in the queue
					and in every report.
				</p>
			{/snippet}
		</Action>
	{:else}
		<Action
			action={restoreVolunteerRole}
			label="Restore"
			icon={unarchiveIcon}
			variant="ghost"
			size="sm"
			modalTitle="Restore {role.name}?"
			submitLabel="Restore"
			successToast="Role restored"
		>
			{#snippet form()}
				<input type="hidden" name="id" value={role.id} />
				<p class="text-sm">Members will be able to log hours against this again.</p>
			{/snippet}
		</Action>
	{/if}

	{#if role.logCount === 0}
		<Action
			action={deleteVolunteerRole}
			label="Delete"
			icon={trashIcon}
			variant="ghost"
			size="sm"
			class="text-error"
			modalTitle="Delete {role.name}?"
			submitLabel="Delete"
			submitVariant="error"
			successToast="Role deleted"
			onsuccess={() => goto(resolve('/staff/volunteer/roles'))}
		>
			{#snippet form()}
				<input type="hidden" name="id" value={role.id} />
				<p class="text-sm">
					Nothing has been logged against this role, so it can be removed outright.
				</p>
			{/snippet}
		</Action>
	{/if}
</PageHeader>

<PageContent width="3xl">
	<div class="grid gap-6 lg:grid-cols-2">
		<Form remote={updateVolunteerRole} guard successToast="Role updated">
			<input {...fields.id.as('hidden', role.id)} />
			<InfoCard title="Role Info">
				<Field field={fields.name} type="text" label="Name" value={role.name} />
				<Field
					field={fields.description}
					type="textarea"
					label="Job description"
					value={role.description ?? ''}
					description="Markdown. This is what members read on their volunteering page, so say what the job actually involves."
				/>
				<Field
					field={fields.group}
					type="select"
					label="Group"
					value={role.group}
					options={groupOptions}
				/>
				<Field
					field={fields.displayOrder}
					type="number"
					label="Display order"
					value={String(role.displayOrder)}
					description="Lower sorts first, within this group."
				/>

				<fieldset class="mt-2 rounded-box border border-base-300 p-4">
					<legend class="px-2 text-sm font-medium">Shift defaults</legend>
					<p class="mb-2 text-subtle">
						What the New Shift form starts with. Not a limit — either can be changed on the shift
						itself, and leaving them blank just means the form starts on its own defaults.
					</p>
					<!--
						Posted by name rather than through `fields.x`. A field registered as
						a number carries SvelteKit's `n:` prefix, and an emptied `n:` input is
						dropped from the submission entirely — which makes "cleared" arrive
						identical to "untouched". These two are the only fields where blank is
						a real answer, so they post as plain values and reach the schema as ''.
					-->
					<div class="grid gap-3 sm:grid-cols-2">
						<FormField
							name="defaultDurationMinutes"
							type="number"
							min="1"
							label="Usual length (minutes)"
							value={role.defaultDurationMinutes === null
								? ''
								: String(role.defaultDurationMinutes)}
						/>
						<FormField
							name="defaultCapacity"
							type="number"
							min="1"
							label="People needed"
							value={role.defaultCapacity === null ? '' : String(role.defaultCapacity)}
						/>
					</div>
				</fieldset>

				<div class="mt-2 flex justify-end">
					<SubmitButton shortcut="mod+s">
						{#snippet icon()}
							<IconDeviceFloppy size={20} />
						{/snippet}
					</SubmitButton>
				</div>
			</InfoCard>
		</Form>

		<!--
			Requirements are their own action rather than a field on the edit form:
			they post an array to a different remote, and folding them in would mean
			one form writing to two services.
		-->
		<InfoCard title="Requirements">
			{#snippet header(title)}
				<div class="flex items-center justify-between gap-2">
					<CardTitle>{title}</CardTitle>
					{#await certifications then certOptions}
						{#if certOptions.length > 0}
							<Action
								action={setRoleCertifications}
								label="Edit"
								variant="ghost"
								size="sm"
								modalTitle="What {role.name} requires"
								successToast="Requirements saved"
							>
								{#snippet form()}
									<input type="hidden" name="roleId" value={role.id} />
									<p class="text-muted">
										Someone must hold all of these before they can claim a shift for this role.
										Logging hours is never blocked — the review queue just flags it.
									</p>
									{#await requirements then held}
										<CheckboxGroup
											field={setRoleCertifications.fields.certificationIds}
											selected={held.map((c) => c.id)}
											options={certOptions.map((c) => ({
												value: c.id,
												label: c.name,
												description: c.issuedBy ?? 'Granted by CMC'
											}))}
										/>
									{/await}
								{/snippet}
							</Action>
						{/if}
					{/await}
				</div>
			{/snippet}

			{#await requirements then held}
				{#if held.length === 0}
					<p class="text-muted">Anyone can claim a shift for this role — no clearance needed.</p>
				{:else}
					<ul class="space-y-2 text-sm">
						{#each held as cert (cert.id)}
							<li>
								<span class="font-medium">{cert.name}</span>
								<span class="opacity-60">· {cert.issuedBy ?? 'Granted by CMC'}</span>
							</li>
						{/each}
					</ul>
				{/if}
			{/await}
		</InfoCard>
	</div>

	<InfoCard title="Upcoming Shifts">
		{#snippet header(title)}
			<div class="flex items-center justify-between gap-2">
				<CardTitle>{title}</CardTitle>
				{#if role.isActive}
					<Action
						action={createShift}
						label="New shift"
						variant="ghost"
						size="sm"
						modalTitle="Schedule a {role.name} shift"
						submitLabel="Create"
						successToast="Shift scheduled"
						onsuccess={() => getShifts({ volunteerRoleId: id, from }).refresh()}
					>
						{#snippet form()}
							<ShiftFormFields
								form={createShift}
								roleId={role.id}
								startsAt={shiftStart}
								endsAt={shiftEnd}
								capacity={String(role.defaultCapacity ?? 1)}
							/>
						{/snippet}
					</Action>
				{/if}
			</div>
		{/snippet}

		{#await shifts then rows}
			{#if rows.length === 0}
				<EmptyState description="Nothing scheduled for this role yet." />
			{:else}
				<Table>
					{#snippet head()}
						<th>When</th>
						<th class="col-support">Event</th>
						<th class="cell-num whitespace-nowrap">Claimed</th>
					{/snippet}

					{#each rows as shift (shift.id)}
						{@const href = resolve(`/staff/volunteer/shifts/${shift.id}`)}
						{@const short = shift.claimed < shift.capacity}
						<tr class="hover cursor-pointer" use:rowLink={href}>
							<td class="cell-primary whitespace-nowrap">
								<a {href} class="font-medium">{formatDateShort(shift.startsAt)}</a>
								<div class="text-subtle">
									{timeRange(shift.startsAt, shift.endsAt)}
								</div>
							</td>
							<td class="col-support">
								{#if shift.eventTitle}
									<span class="truncate">{shift.eventTitle}</span>
								{/if}
							</td>
							<td class="cell-num whitespace-nowrap">
								{shift.claimed}/{shift.capacity}
								{#if short}
									<span class="badge badge-warning badge-sm ml-2">short</span>
								{/if}
							</td>
						</tr>
					{/each}
				</Table>
			{/if}
		{/await}
	</InfoCard>

	<InfoCard title="Interested Members">
		{#snippet header(title)}
			<div class="flex items-center justify-between gap-2">
				{#await interested then r}
					<CardTitle>
						{title}
						<!-- The count that matters when the role is gated is how many could
						     actually take a shift, not how many said yes. -->
						{#if r.gated && r.rows.length > 0}
							<span class="text-muted font-normal">
								· {r.rows.filter((m) => m.missing.length === 0).length} of {r.rows.length} ready
							</span>
						{/if}
					</CardTitle>
				{/await}
				{#await interested then r}
					{#if r.rows.length > 0}
						<Button
							variant="ghost"
							size="sm"
							onclick={() => copyEmails(r.rows.map((m) => m.email))}
						>
							Copy emails on this page
						</Button>
					{/if}
				{/await}
			</div>
		{/snippet}

		{#await interested then r}
			{@const gated = r.gated}
			<DataList
				result={interested}
				empty="No one has picked this role yet."
				onpage={(p) => (pageNumber = p)}
			>
				{#snippet children(members)}
					<Table>
						{#snippet head()}
							{#if gated}
								<th class="w-px"><span class="sr-only">Cleared</span></th>
							{/if}
							<th>Member</th>
							<th class="col-support">Also interested in</th>
							<th class="col-extra whitespace-nowrap">Since</th>
						{/snippet}

						{#each members as member (member.userId)}
							{@const alsoIn = member.roleNames.filter((n) => n !== role.name)}
							<tr class="hover">
								{#if gated}
									<td class="w-px">
										<StatusBadge status={member.missing.length === 0 ? 'cleared' : 'uncleared'} />
									</td>
								{/if}
								<td class="cell-primary whitespace-nowrap">
									<EntityIdentity ref={member.member} />
									{#if gated && member.missing.length > 0}
										<div class="text-xs text-warning">
											needs {member.missing.map((c) => c.name).join(', ')}
										</div>
									{/if}
								</td>

								<td class="col-support">
									{#if alsoIn.length > 0}
										<div class="flex flex-wrap gap-1">
											{#each alsoIn as roleName (roleName)}
												<span class="badge badge-ghost badge-sm">{roleName}</span>
											{/each}
										</div>
									{/if}
								</td>

								<td class="col-extra whitespace-nowrap">{formatDateShort(member.since)}</td>
							</tr>
						{/each}
					</Table>
				{/snippet}
			</DataList>
		{/await}
	</InfoCard>

	<!--
		Anonymous by design, the way the service builds it: feedback exists to fix
		briefings and setups, and attaching names would just teach volunteers to
		answer politely.
	-->
	{#await feedback then all}
		{@const summary = all.find((f) => f.volunteerRoleId === id)}
		{#if summary}
			<InfoCard title="How it's going">
				<div class="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
					<span
						><span class="text-lg font-medium">{summary.averageRating.toFixed(1)}</span> / 5</span
					>
					<span>
						set up on arrival
						<span class="font-medium">{Math.round(summary.setUpShare * 100)}%</span>
					</span>
					<span class="opacity-60">
						{summary.responses}
						{summary.responses === 1 ? 'response' : 'responses'}
					</span>
				</div>

				{#if summary.latestComments.length > 0}
					<ul class="mt-3 space-y-2 text-sm">
						{#each summary.latestComments as c (c.submittedAt)}
							<li class="border-l-2 border-base-300 pl-3 italic opacity-80">
								“{c.comment}”
							</li>
						{/each}
					</ul>
				{/if}
			</InfoCard>
		{/if}
	{/await}
</PageContent>

{#snippet archiveIcon()}
	<IconArchive size={16} />
{/snippet}

{#snippet unarchiveIcon()}
	<IconArchiveOff size={16} />
{/snippet}

{#snippet trashIcon()}
	<IconTrash size={16} />
{/snippet}
