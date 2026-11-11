<script lang="ts">
	import { m as msg } from '#lib/paraglide/messages.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import TabBar from '#lib/components/ui/TabBar.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import SearchInput from '#lib/components/ui/Form/SearchInput.svelte';
	import CheckboxGroup from '#lib/components/ui/Form/CheckboxGroup.svelte';
	import { Field, MoneyField } from '#lib/components/ui/Form/index.js';
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import {
		assignMembersForm,
		engageContractorForm,
		getTaskAssignees,
		openTaskForm,
		unassignMemberForm,
		unassignTaskForm
	} from '#lib/remote/tasks.remote.js';
	import { contractorJobStatusLabels, type ContractorJobStatus } from '#lib/config.js';
	import { toLocalDateTime } from '#lib/utils/format.js';
	import { engagementLabel, type Task } from './task-view';

	/**
	 * The assignment picker's contents, loaded when it opens: assign members,
	 * open a shift, engage a contractor, or unassign (#2518). A task can be both
	 * assigned and have shifts. Moving to or from a contractor warns first;
	 * confirming takes the people off or cancels the engagement, then switches.
	 */
	let {
		task,
		projectId,
		place,
		onclose
	}: { task: Task; projectId: string; place: string; onclose: () => void } = $props();

	type Mode = 'members' | 'open' | 'contractor';
	let tab = $state<Mode>(untrack(() => (task.mode === 'unassigned' ? 'members' : task.mode)));
	let search = $state('');
	const picked = new SvelteSet<string>();
	let refused = $state<{ name: string; message: string }[]>([]);
	let warned = $state<{ name: string; warnings: string[] }[]>([]);
	type Warning = {
		liveSignups: number;
		engagement: { contractorName: string; status: ContractorJobStatus } | null;
	};
	let assignWarning = $state<Warning | null>(null);
	let openWarning = $state<Warning | null>(null);
	let engageWarning = $state(0);
	let unassignWarning = $state<Warning | null>(null);

	/** What confirming a switch does, in one sentence. */
	function consequence(w: Warning): string {
		const parts: string[] = [];
		if (w.engagement) {
			const { contractorName, status } = w.engagement;
			parts.push(`cancels ${contractorName}'s engagement (${contractorJobStatusLabels[status]})`);
		}
		if (w.liveSignups > 0) {
			const n = w.liveSignups;
			parts.push(`takes ${n === 1 ? 'one person' : `${n} people`} off it and tells them`);
		}
		return `This ${parts.join(' and ')}.`;
	}

	const options = $derived(await getTaskAssignees({ projectId, workOrderId: task.id }));
	const engaged = $derived(task.mode === 'contractor' && task.engagement);
	const live = $derived(
		engaged && (engaged.status === 'asked' || engaged.status === 'booked') ? engaged : null
	);
	const onIt = $derived(new Set(task.people.map((p) => p.userId)));
	const roleOptions = $derived(options.roles.map((r) => ({ value: r.id, label: r.name })));
	const contractorOptions = $derived(
		options.contractors.map((c) => ({ value: c.id, label: c.name }))
	);
	const memberOptions = $derived(
		options.members
			.filter((m) => !onIt.has(m.userId))
			.filter(
				(m) => picked.has(m.userId) || m.name.toLowerCase().includes(search.trim().toLowerCase())
			)
			.map((m) => ({
				value: m.userId,
				label: m.name,
				description: m.via === 'staff' ? msg.staff_staff_body() : msg.staff_committee_body()
			}))
	);
	const nameOf = (id: string) => options.members.find((m) => m.userId === id)?.name ?? 'Someone';

	const assign = $derived(assignMembersForm.for(`${place}:${task.id}`));
	const open = $derived(openTaskForm.for(`${place}:${task.id}`));
	// The deadline itself where there is one, otherwise tomorrow; two hours long.
	const start = $derived(task.dueAt ?? new Date(Date.now() + 86_400_000));
	const engage = $derived(engageContractorForm.for(`${place}:${task.id}`));
	const unassign = $derived(unassignTaskForm.for(`${place}:${task.id}`));

	function track(e: Event) {
		const box = e.target as HTMLInputElement;
		if (box.type !== 'checkbox') return;
		if (box.checked) picked.add(box.value);
		else picked.delete(box.value);
	}
</script>

{#if engaged && !live}
	<!-- Finished work stays the contractor's: its cost is on the record. -->
	<Alert type="info" class="text-sm">
		{msg.staff_projects_id_assign_picker_body_did_work_stays_theirs_body({
			contractorName: engaged.contractorName,
			engagementLabel: engagementLabel(engaged)
		})}
		{#snippet action()}
			<Button
				href="{resolve(`staff/projects/${projectId}/tasks/${task.id}`)}#engagement-{engaged.id}"
				size="xs"
				variant="default"
			>
				{msg.staff_projects_id_assign_picker_body_open_engagement_label()}
			</Button>
		{/snippet}
	</Alert>
{:else}
	<TabBar
		dense
		class="mb-3"
		tabs={[
			{ key: 'members', label: msg.staff_members_label() },
			{ key: 'open', label: msg.staff_projects_id_assign_picker_body_open_volunteers_label() },
			{ key: 'contractor', label: msg.staff_contractor_label() }
		]}
		active={tab}
		onchange={(k) => (tab = k as Mode)}
	/>

	{#if tab === 'members'}
		{#if task.people.length > 0}
			<ul class="mb-3 space-y-1 text-sm" aria-label={msg.staff_text_2_label()}>
				{#each task.people as p (p.userId)}
					{@const drop = unassignMemberForm.for(`${place}:${task.id}:${p.userId}`)}
					<li class="flex items-center justify-between gap-2">
						<span>{p.name}</span>
						{#if p.status !== 'completed'}
							<Form remote={drop}>
								<input {...drop.fields.projectId.as('hidden', projectId)} />
								<input {...drop.fields.workOrderId.as('hidden', task.id)} />
								<input {...drop.fields.userId.as('hidden', p.userId)} />
								<SubmitButton
									label={msg.staff_projects_id_assign_picker_body_take_off_label()}
									variant="ghost"
									size="xs"
								/>
							</Form>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		<Form
			remote={assign}
			onsuccess={(r) => {
				if (r?.status === 'needs_confirmation') {
					assignWarning = r;
					return;
				}
				assignWarning = null;
				refused = (r?.refused ?? []).map((x) => ({ name: nameOf(x.userId), message: x.message }));
				warned = (r?.warned ?? []).map((x) => ({ name: nameOf(x.userId), warnings: x.warnings }));
				picked.clear();
			}}
		>
			<input {...assign.fields.projectId.as('hidden', projectId)} />
			<input {...assign.fields.workOrderId.as('hidden', task.id)} />
			<Field
				field={assign.fields.volunteerRoleId}
				type="select"
				label={msg.staff_role_label()}
				options={roleOptions}
				value={task.volunteerRoleId ?? ''}
				placeholder={msg.staff_projects_id_assign_picker_body_pick_role_placeholder()}
				description={msg.staff_projects_id_assign_picker_body_their_hours_count_under_body()}
			/>
			<SearchInput
				bind:value={search}
				size="sm"
				placeholder={msg.staff_projects_id_assign_picker_body_search_staff_committee_placeholder()}
			/>
			<div onchange={track}>
				<CheckboxGroup
					field={assign.fields.userIds}
					options={memberOptions}
					legend={msg.staff_projects_id_assign_picker_body_legend_title()}
					description={msg.staff_projects_id_assign_picker_body_booked_straight_as_conf_body()}
				/>
			</div>
			{#if assignWarning}
				<input {...assign.fields.confirm.as('hidden', true)} />
				<Alert type="warning" class="text-sm">{consequence(assignWarning)}</Alert>
			{/if}
			<SubmitButton
				label={assignWarning
					? msg.staff_projects_id_assign_picker_body_assign_cancel_engagemen_label()
					: msg.staff_assign_label()}
				size="sm"
			/>
		</Form>
		{#if warned.length > 0}
			<!-- Assigned regardless; each warning is on the task's log. -->
			<Alert type="warning" class="mt-3 text-sm">
				{msg.staff_projects_id_assign_picker_body_assigned_over_warnings_body({
					join: warned.map((w) => `${w.name} (${w.warnings.join(' ')})`).join('; ')
				})}
			</Alert>
		{/if}
		{#if refused.length > 0}
			<!-- Only a profile under review, a full task or a closed one refuses. -->
			<Alert type="error" class="mt-3 text-sm">
				{msg.staff_projects_id_assign_picker_body_could_not_put_body({
					join: refused.map((r) => `${r.name} (${r.message})`).join('; ')
				})}
			</Alert>
		{/if}
	{:else if tab === 'open'}
		<Form
			remote={open}
			onsuccess={(r) => {
				if (r?.status === 'needs_confirmation') openWarning = r;
				else onclose();
			}}
		>
			<input {...open.fields.projectId.as('hidden', projectId)} />
			<input {...open.fields.workOrderId.as('hidden', task.id)} />
			<Field
				field={open.fields.volunteerRoleId}
				type="select"
				label={msg.staff_role_label()}
				options={roleOptions}
				value={task.volunteerRoleId ?? ''}
				placeholder={msg.staff_projects_id_assign_picker_body_pick_role_placeholder()}
			/>
			<Field
				field={open.fields.startsAt}
				type="datetime-local"
				label={msg.volunteer_shift_form_fields_starts_label()}
				value={toLocalDateTime(start)}
			/>
			<Field
				field={open.fields.endsAt}
				type="datetime-local"
				label={msg.volunteer_shift_form_fields_ends_label()}
				value={toLocalDateTime(new Date(start.getTime() + 2 * 3_600_000))}
			/>
			<Field
				field={open.fields.capacity}
				type="number"
				label={msg.volunteer_shift_form_fields_people_needed_label()}
				value={task.capacity}
			/>
			<p class="text-muted text-sm">
				{msg.staff_projects_id_assign_picker_body_posts_claim_board_once_text()}
			</p>
			{#if openWarning}
				<input {...open.fields.confirm.as('hidden', true)} />
				<Alert type="warning" class="text-sm">{consequence(openWarning)}</Alert>
			{/if}
			<SubmitButton
				label={openWarning
					? msg.staff_projects_id_assign_picker_body_open_cancel_engagement_label()
					: msg.staff_projects_id_assign_picker_body_open_volunteers_label()}
				size="sm"
			/>
		</Form>
	{:else if live}
		<Alert type="info" class="text-sm">
			{msg.staff_projects_id_assign_picker_body_engaged_members_open_ca_body({
				contractorName: live.contractorName,
				engagementLabel: engagementLabel(live)
			})}
			{#snippet action()}
				<Button
					href="{resolve(`staff/projects/${projectId}/tasks/${task.id}`)}#engagement-{live.id}"
					size="xs"
					variant="default"
				>
					{msg.staff_projects_id_assign_picker_body_open_engagement_label()}
				</Button>
			{/snippet}
		</Alert>
	{:else}
		<Form
			remote={engage}
			onsuccess={(r) => {
				if (r?.status === 'needs_confirmation') engageWarning = r.liveSignups;
				else onclose();
			}}
		>
			<input {...engage.fields.projectId.as('hidden', projectId)} />
			<input {...engage.fields.workOrderId.as('hidden', task.id)} />
			<Field
				field={engage.fields.contractorId}
				type="select"
				label={msg.staff_contractor_label()}
				options={contractorOptions}
				placeholder={msg.staff_projects_id_assign_picker_body_pick_one_placeholder()}
			/>
			<MoneyField
				field={engage.fields.quotedCents}
				label={msg.staff_projects_id_assign_picker_body_quote_if_they_gave_one_label()}
			/>
			{#if engageWarning > 0}
				<input {...engage.fields.confirm.as('hidden', true)} />
				<Alert type="warning" class="text-sm">
					{msg.staff_projects_id_assign_picker_engage_warning_body({ count: engageWarning })}
				</Alert>
			{/if}
			<p class="text-muted text-sm">
				{msg.staff_projects_id_assign_picker_body_asks_them_quote_booking_text()}
			</p>
			<SubmitButton
				label={engageWarning > 0
					? msg.staff_projects_id_assign_picker_body_engage_cancel_signups_label()
					: msg.staff_engage_contractor_label()}
				size="sm"
			/>
		</Form>
	{/if}

	{#if task.mode !== 'unassigned'}
		<div class="mt-4 border-t border-base-300 pt-3">
			<Form
				remote={unassign}
				onsuccess={(r) => {
					if (r?.status === 'needs_confirmation') unassignWarning = r;
					else onclose();
				}}
			>
				<input {...unassign.fields.projectId.as('hidden', projectId)} />
				<input {...unassign.fields.workOrderId.as('hidden', task.id)} />
				{#if unassignWarning}
					<input {...unassign.fields.confirm.as('hidden', true)} />
					<Alert type="warning" class="mb-2 text-sm">{consequence(unassignWarning)}</Alert>
				{/if}
				<SubmitButton
					label={unassignWarning
						? msg.staff_projects_id_assign_picker_body_confirm_unassign_label()
						: msg.staff_projects_id_assign_picker_body_unassign_label()}
					variant="error"
					outline
					size="sm"
				/>
			</Form>
		</div>
	{/if}
{/if}
