<script lang="ts">
	import RoleRequirementsCard from './RoleRequirementsCard.svelte';
	import RoleShiftsCard from './RoleShiftsCard.svelte';
	import RoleInterestedCard from './RoleInterestedCard.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { Field } from '$lib/components/ui/Form';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { volunteerRoleGroups, volunteerRoleGroupLabels } from '$lib/config';
	import { IconArchive, IconArchiveOff, IconTrash, IconDeviceFloppy } from '@tabler/icons-svelte';
	import {
		getStaffVolunteerRolePage,
		updateVolunteerRole,
		archiveVolunteerRole,
		restoreVolunteerRole,
		deleteVolunteerRole
	} from '$lib/remote/volunteer.remote';

	const { fields } = updateVolunteerRole;

	let id = $derived(page.params.id!);
	// One query, keyed by the role id alone. That is deliberate: `setRoleCertifications` refreshes
	// the requirements with `data.roleId` and `refreshRoleViews` refreshes the detail with a bare
	// `roleId`, so a wrapper keyed by the page number or the shift window could not be named from
	// either. The certification catalogue lives in RoleRequirementsCard for the same reason.
	const pageData = $derived(await getStaffVolunteerRolePage(id));
	const role = $derived(pageData.role);

	const requirementsList = $derived(pageData.requirements);
	const feedbackList = $derived(pageData.feedback);

	// Pinned once, not recomputed: `refresh()` is keyed by argument, so a `from` that ticked with
	// the clock would mint a new key on every re-evaluation and the refresh after creating a shift
	// would miss its query. RoleShiftsCard owns the query; the anchor stays here so it is stable.
	const from = new Date().toISOString();

	const groupOptions = volunteerRoleGroups.map((g) => ({
		value: g,
		label: volunteerRoleGroupLabels[g]
	}));
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

				<fieldset class="mt-2 rounded-box border border-base-300 p-4">
					<legend class="px-2 text-sm font-medium">Accounting</legend>
					<p class="mb-2 text-subtle">
						Every approved hour counts toward the collective's impact value, at the rate on the
						settings page. A <em>specialized skill</em> is narrower: work we would otherwise have had
						to pay for, which a financial statement can recognise as a contributed service — at what that
						skill costs, not at the impact rate. The two are reported side by side and never added together.
					</p>
					<div class="grid gap-3 sm:grid-cols-2">
						<!--
							A checkbox registers with a `b:` prefix and submits a real
							boolean, so the schema takes `.optional().default(false)` and
							an unchecked box arrives as false rather than failing as a
							missing required field.
						-->
						<Field
							field={fields.isSpecializedSkill}
							type="checkbox"
							label="Specialized skill"
							value={role.isSpecializedSkill}
							description="Work the collective would otherwise have paid for."
						/>
						<!--
							Posted by name rather than through `fields.x`, like the shift
							defaults above: an emptied `n:` number is dropped from the
							submission, which makes "cleared" arrive identical to
							"untouched" — and blank is a real answer here.
						-->
						<FormField
							name="marketRate"
							type="number"
							min="0"
							step="0.01"
							label="Market rate ($/hr)"
							value={role.marketRateCents === null ? '' : (role.marketRateCents / 100).toFixed(2)}
							description="Blank counts as zero, never as the impact rate — a report shows it as unpriced."
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
		<RoleRequirementsCard {role} held={requirementsList} />
	</div>

	<RoleShiftsCard {role} {from} />

	<RoleInterestedCard {role} />

	<!--
		Anonymous by design, the way the service builds it: feedback exists to fix
		briefings and setups, and attaching names would just teach volunteers to
		answer politely.
	-->
	{@const summary = feedbackList.find((f) => f.volunteerRoleId === id)}
	{#if summary}
		<InfoCard title="How it's going">
			<div class="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
				<span><span class="text-lg font-medium">{summary.averageRating.toFixed(1)}</span> / 5</span>
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
