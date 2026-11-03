<script lang="ts">
	import { m as msg } from '$lib/paraglide/messages.js';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import TabBar from '$lib/components/ui/TabBar.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import CheckboxGroup from '$lib/components/ui/Form/CheckboxGroup.svelte';
	import { Field, MoneyField } from '$lib/components/ui/Form';
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
	} from '$lib/remote/tasks.remote';
	import { contractorJobStatusLabels, type ContractorJobStatus } from '$lib/config';
	import { engagementLabel, type Task } from './task-view';

	/**
	 * The assignment picker's contents, loaded when it opens. Members, Open to
	 * volunteers, Contractor, and Unassign. Switching away from people or a
	 * contractor warns first; confirming takes the people off or cancels the
	 * engagement through its own Cancel, then switches.
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
				description: m.via === 'staff' ? msg.staff_staff() : msg.staff_committee()
			}))
	);
	const nameOf = (id: string) => options.members.find((m) => m.userId === id)?.name ?? 'Someone';

	const assign = $derived(assignMembersForm.for(`${place}:${task.id}`));
	const open = $derived(openTaskForm.for(`${place}:${task.id}`));
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
		{msg.staff_projects_id_assign_picker_body_did_work_stays_theirs({
			contractorName: engaged.contractorName,
			engagementLabel: engagementLabel(engaged)
		})}
		{#snippet action()}
			<Button
				href="{resolve(`/staff/projects/${projectId}/tasks/${task.id}`)}#engagement-{engaged.id}"
				size="xs"
				variant="default"
			>
				{msg.staff_projects_id_assign_picker_body_open_engagement()}
			</Button>
		{/snippet}
	</Alert>
{:else}
	<TabBar
		dense
		class="mb-3"
		tabs={[
			{ key: 'members', label: msg.staff_members() },
			{ key: 'open', label: msg.staff_projects_id_assign_picker_body_open_volunteers() },
			{ key: 'contractor', label: msg.staff_contractor() }
		]}
		active={tab}
		onchange={(k) => (tab = k as Mode)}
	/>

	{#if tab === 'members'}
		{#if task.people.length > 0}
			<ul class="mb-3 space-y-1 text-sm" aria-label={msg.staff_text_2()}>
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
									label={msg.staff_projects_id_assign_picker_body_take_off()}
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
				label={msg.staff_role()}
				options={roleOptions}
				value={task.volunteerRoleId ?? ''}
				placeholder={msg.staff_projects_id_assign_picker_body_pick_role()}
				description={msg.staff_projects_id_assign_picker_body_their_hours_count_under()}
			/>
			<SearchInput
				bind:value={search}
				size="sm"
				placeholder={msg.staff_projects_id_assign_picker_body_search_staff_committee()}
			/>
			<div onchange={track}>
				<CheckboxGroup
					field={assign.fields.userIds}
					options={memberOptions}
					legend={msg.staff_projects_id_assign_picker_body_legend()}
					description={msg.staff_projects_id_assign_picker_body_booked_straight_as_conf()}
				/>
			</div>
			{#if assignWarning}
				<input {...assign.fields.confirm.as('hidden', true)} />
				<Alert type="warning" class="text-sm">{consequence(assignWarning)}</Alert>
			{/if}
			<SubmitButton
				label={assignWarning
					? msg.staff_projects_id_assign_picker_body_assign_cancel_engagemen()
					: msg.staff_assign()}
				size="sm"
			/>
		</Form>
		{#if warned.length > 0}
			<!-- Assigned regardless; each warning is on the task's log. -->
			<Alert type="warning" class="mt-3 text-sm">
				{msg.staff_projects_id_assign_picker_body_assigned_over_warnings({
					join: warned.map((w) => `${w.name} (${w.warnings.join(' ')})`).join('; ')
				})}
			</Alert>
		{/if}
		{#if refused.length > 0}
			<!-- Only a profile under review, a full task or a closed one refuses. -->
			<Alert type="error" class="mt-3 text-sm">
				{msg.staff_projects_id_assign_picker_body_could_not_put({
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
				label={msg.staff_role()}
				options={roleOptions}
				value={task.volunteerRoleId ?? ''}
				placeholder={msg.staff_projects_id_assign_picker_body_pick_role()}
			/>
			<Field
				field={open.fields.capacity}
				type="number"
				label={msg.staff_projects_id_assign_picker_body_spots()}
				value={task.capacity}
			/>
			<p class="text-muted text-sm">
				{msg.staff_projects_id_assign_picker_body_posts_claim_board_once()}
			</p>
			{#if openWarning}
				<input {...open.fields.confirm.as('hidden', true)} />
				<Alert type="warning" class="text-sm">{consequence(openWarning)}</Alert>
			{/if}
			<SubmitButton
				label={openWarning
					? msg.staff_projects_id_assign_picker_body_open_cancel_engagement()
					: msg.staff_projects_id_assign_picker_body_open_volunteers()}
				size="sm"
			/>
		</Form>
	{:else if live}
		<Alert type="info" class="text-sm">
			{msg.staff_projects_id_assign_picker_body_engaged_members_open_ca({
				contractorName: live.contractorName,
				engagementLabel: engagementLabel(live)
			})}
			{#snippet action()}
				<Button
					href="{resolve(`/staff/projects/${projectId}/tasks/${task.id}`)}#engagement-{live.id}"
					size="xs"
					variant="default"
				>
					{msg.staff_projects_id_assign_picker_body_open_engagement()}
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
				label={msg.staff_contractor()}
				options={contractorOptions}
				placeholder={msg.staff_projects_id_assign_picker_body_pick_one()}
			/>
			<MoneyField
				field={engage.fields.quotedCents}
				label={msg.staff_projects_id_assign_picker_body_quote_if_they_gave_one()}
			/>
			{#if engageWarning > 0}
				<input {...engage.fields.confirm.as('hidden', true)} />
				<Alert type="warning" class="text-sm">
					{msg.staff_projects_id_assign_picker_engage_warning({ count: engageWarning })}
				</Alert>
			{/if}
			<p class="text-muted text-sm">
				{msg.staff_projects_id_assign_picker_body_asks_them_quote_booking()}
			</p>
			<SubmitButton
				label={engageWarning > 0
					? msg.staff_projects_id_assign_picker_body_engage_cancel_signups()
					: msg.staff_engage_contractor()}
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
						? msg.staff_projects_id_assign_picker_body_confirm_unassign()
						: msg.staff_projects_id_assign_picker_body_unassign()}
					variant="error"
					outline
					size="sm"
				/>
			</Form>
		</div>
	{/if}
{/if}
