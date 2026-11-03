<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import RoleRequirementsCard from './RoleRequirementsCard.svelte';
	import RoleShiftsCard from './RoleShiftsCard.svelte';
	import RoleInterestedCard from './RoleInterestedCard.svelte';
	import RoleGrantsCard from './RoleGrantsCard.svelte';
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
	import FreeformTagInput from '$lib/components/ui/FreeformTagInput.svelte';
	import { volunteerRoleGroups, volunteerRoleGroupLabels } from '$lib/config';
	import { IconArchive, IconArchiveOff, IconTrash, IconDeviceFloppy } from '@tabler/icons-svelte';
	import {
		getStaffVolunteerRolePage,
		updateVolunteerRole,
		archiveVolunteerRole,
		restoreVolunteerRole,
		deleteVolunteerRole,
		getVolunteerRoleHistory
	} from '$lib/remote/volunteer.remote';
	import { ActivityFeedCard, feedItemRow } from '$lib/components/ui/ActivityFeed';

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

	/** Seeded once, then owned by the tag input. */
	// svelte-ignore state_referenced_locally
	let skillMatches = $state<string[]>(role.skillMatches ?? []);

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
<PageHeader
	width="3xl"
	title={role.name}
	subtitle={m.staff_volunteer_roles_id_subtitle()}
	parent={{ label: m.staff_roles(), href: resolve('/staff/volunteer/roles') }}
>
	<StatusBadge status={role.isActive ? 'active' : 'retired'} label />

	<!--
		Archive rather than delete is the normal retirement path: the role's hour
		logs stay resolvable in every report. Delete is offered only for a role
		nothing was ever logged against.
	-->
	{#if role.isActive}
		<Action
			action={archiveVolunteerRole}
			label={m.staff_archive()}
			data-testid="role-archive"
			icon={archiveIcon}
			variant="ghost"
			size="sm"
			modalTitle={m.staff_archive_2({ name: role.name })}
			submitLabel={m.staff_archive()}
			successToast={m.staff_volunteer_roles_id_role_archived()}
		>
			{#snippet form()}
				<input type="hidden" name="id" value={role.id} />
				<p class="text-sm">
					{m.staff_volunteer_roles_id_members_won_t_able_log()}
				</p>
			{/snippet}
		</Action>
	{:else}
		<Action
			action={restoreVolunteerRole}
			label={m.staff_restore()}
			data-testid="role-restore"
			icon={unarchiveIcon}
			variant="ghost"
			size="sm"
			modalTitle={m.staff_restore_2({ name: role.name })}
			submitLabel={m.staff_restore()}
			successToast={m.staff_volunteer_roles_id_role_restored()}
		>
			{#snippet form()}
				<input type="hidden" name="id" value={role.id} />
				<p class="text-sm">{m.staff_volunteer_roles_id_members_will_able_log_hours()}</p>
			{/snippet}
		</Action>
	{/if}

	{#if role.logCount === 0}
		<Action
			action={deleteVolunteerRole}
			label={m.staff_delete()}
			data-testid="role-delete"
			icon={trashIcon}
			variant="ghost"
			size="sm"
			class="text-error"
			modalTitle={m.staff_delete_2({ name: role.name })}
			submitLabel={m.staff_delete()}
			submitVariant="error"
			successToast={m.staff_volunteer_roles_id_role_deleted()}
			onsuccess={() => goto(resolve('/staff/volunteer/roles'))}
		>
			{#snippet form()}
				<input type="hidden" name="id" value={role.id} />
				<p class="text-sm">
					{m.staff_volunteer_roles_id_nothing_has_been_logged_against()}
				</p>
			{/snippet}
		</Action>
	{/if}
</PageHeader>

<PageContent width="3xl">
	<div class="grid gap-6 lg:grid-cols-2">
		<Form
			remote={updateVolunteerRole}
			guard
			successToast={m.staff_volunteer_roles_id_role_updated()}
		>
			<input {...fields.id.as('hidden', role.id)} />
			<InfoCard title={m.staff_volunteer_roles_id_role_info()}>
				<Field field={fields.name} type="text" label={m.staff_name()} value={role.name} />
				<Field
					field={fields.description}
					type="textarea"
					label={m.staff_job_description()}
					value={role.description ?? ''}
					description={m.staff_volunteer_roles_id_markdown_what_members_read_their()}
				/>
				<Field
					field={fields.group}
					type="select"
					label={m.staff_group()}
					value={role.group}
					options={groupOptions}
				/>
				<Field
					field={fields.displayOrder}
					type="number"
					label={m.staff_display_order()}
					value={String(role.displayOrder)}
					description={m.staff_volunteer_roles_id_lower_sorts_first_within_group()}
				/>

				<fieldset class="mt-2 rounded-box border border-base-300 p-4">
					<legend class="px-2 text-sm font-medium"
						>{m.staff_volunteer_roles_id_shift_defaults()}</legend
					>
					<p class="mb-2 text-subtle">
						{m.staff_volunteer_roles_id_what_new_shift_form_starts()}
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
							label={m.staff_volunteer_roles_id_usual_length_minutes()}
							value={role.defaultDurationMinutes === null
								? ''
								: String(role.defaultDurationMinutes)}
						/>
						<FormField
							name="defaultCapacity"
							type="number"
							min="1"
							label={m.staff_volunteer_roles_id_people_needed()}
							value={role.defaultCapacity === null ? '' : String(role.defaultCapacity)}
						/>
					</div>
				</fieldset>

				<fieldset class="mt-2 rounded-box border border-base-300 p-4">
					<legend class="px-2 text-sm font-medium">{m.staff_volunteer_roles_id_accounting()}</legend
					>
					<p class="mb-2 text-subtle">
						<ParaglideMessage
							message={m.staff_volunteer_roles_id_every_approved_hour_counts_toward}
							inputs={{
								staff_volunteer_roles_id_specialized_skill:
									m.staff_volunteer_roles_id_specialized_skill()
							}}
							>{#snippet em({ children })}<em>{@render children?.()}</em
								>{/snippet}</ParaglideMessage
						>
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
							label={m.staff_volunteer_roles_id_specialized_skill_2()}
							value={role.isSpecializedSkill}
							description={m.staff_volunteer_roles_id_work_collective_would_otherwise_hav()}
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
							label={m.staff_volunteer_roles_id_market_rate_hr()}
							value={role.marketRateCents === null ? '' : (role.marketRateCents / 100).toFixed(2)}
							description={m.staff_volunteer_roles_id_blank_counts_as_zero_never()}
						/>
					</div>
				</fieldset>

				<input {...fields.skillMatches.as('hidden', JSON.stringify(skillMatches))} />
				<FormField
					field={fields.skillMatches}
					label={m.staff_volunteer_roles_id_skills_suit_role()}
					description={m.staff_volunteer_roles_id_member_skill_tags_as_members()}
				>
					<FreeformTagInput
						bind:value={skillMatches}
						suggestions={pageData.skillSuggestions}
						placeholder={m.staff_volunteer_roles_id_placeholder()}
					/>
				</FormField>

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
		<div class="flex flex-col gap-6">
			<RoleRequirementsCard {role} held={requirementsList} />
			<RoleGrantsCard {role} held={pageData.grants} />
		</div>
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
		<InfoCard title={m.staff_volunteer_roles_id_how_s_going()}>
			<div class="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
				<span><span class="text-lg font-medium">{summary.averageRating.toFixed(1)}</span> / 5</span>
				<span>
					<ParaglideMessage
						message={m.staff_volunteer_roles_id_set_up_arrival}
						inputs={{ round: Math.round(summary.setUpShare * 100) }}
						>{#snippet span({ children })}<span class="font-medium">{@render children?.()}</span
							>{/snippet}</ParaglideMessage
					>
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

	<ActivityFeedCard
		title={m.staff_history()}
		query={(limit) => getVolunteerRoleHistory(limit ? { id, limit } : { id })}
		toRow={feedItemRow}
		empty={{ title: m.staff_no_recorded_changes() }}
	/>
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
