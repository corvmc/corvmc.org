<script lang="ts">
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
	import { engagementLabel, type Task } from './task-view';

	/**
	 * The assignment picker's contents, loaded when it opens. Members, Open to
	 * volunteers, Contractor, and Unassign. Switching away from a contractor is
	 * the engagement's own Cancel, so while one is live only Contractor is offered.
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
	let engageWarning = $state(0);
	let unassignWarning = $state(0);

	const options = $derived(await getTaskAssignees({ projectId, workOrderId: task.id }));
	const engaged = $derived(task.mode === 'contractor' && task.engagement);
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
				description: m.via === 'staff' ? 'Staff' : 'Committee'
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

{#if engaged}
	<Alert type="info" class="mb-3 text-sm">
		{engaged.contractorName} is engaged ({engagementLabel(engaged)}). To hand this to members or
		volunteers, cancel or decline the engagement first.
		{#snippet action()}
			<Button href={resolve(`/staff/contractors/jobs/${engaged.id}`)} size="xs" variant="default">
				Open the engagement
			</Button>
		{/snippet}
	</Alert>
{:else}
	<TabBar
		dense
		class="mb-3"
		tabs={[
			{ key: 'members', label: 'Members' },
			{ key: 'open', label: 'Open to volunteers' },
			{ key: 'contractor', label: 'Contractor' }
		]}
		active={tab}
		onchange={(k) => (tab = k as Mode)}
	/>
{/if}

{#if tab === 'members' && !engaged}
	{#if task.people.length > 0}
		<ul class="mb-3 space-y-1 text-sm" aria-label="On it">
			{#each task.people as p (p.userId)}
				{@const drop = unassignMemberForm.for(`${place}:${task.id}:${p.userId}`)}
				<li class="flex items-center justify-between gap-2">
					<span>{p.name}</span>
					{#if p.status !== 'completed'}
						<Form remote={drop}>
							<input {...drop.fields.projectId.as('hidden', projectId)} />
							<input {...drop.fields.workOrderId.as('hidden', task.id)} />
							<input {...drop.fields.userId.as('hidden', p.userId)} />
							<SubmitButton label="Take off" variant="ghost" size="xs" />
						</Form>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	<Form
		remote={assign}
		onsuccess={(r) => {
			refused = (r?.refused ?? []).map((x) => ({ name: nameOf(x.userId), message: x.message }));
			picked.clear();
		}}
	>
		<input {...assign.fields.projectId.as('hidden', projectId)} />
		<input {...assign.fields.workOrderId.as('hidden', task.id)} />
		<Field
			field={assign.fields.volunteerRoleId}
			type="select"
			label="Role"
			options={roleOptions}
			value={task.volunteerRoleId ?? ''}
			placeholder="Pick a role"
			description="Their hours count under it."
		/>
		<SearchInput bind:value={search} size="sm" placeholder="Search staff and the committee" />
		<div onchange={track}>
			<CheckboxGroup
				field={assign.fields.userIds}
				options={memberOptions}
				legend="Put on it"
				description="Booked straight on as confirmed, not posted to the claim board. Naming more people than it has spots adds spots."
			/>
		</div>
		<SubmitButton label="Assign" size="sm" />
	</Form>
	{#if refused.length > 0}
		<Alert type="warning" class="mt-3 text-sm">
			Not put on it:
			{refused.map((r) => `${r.name} (${r.message})`).join('; ')}
		</Alert>
	{/if}
{:else if tab === 'open' && !engaged}
	<Form remote={open} onsuccess={onclose}>
		<input {...open.fields.projectId.as('hidden', projectId)} />
		<input {...open.fields.workOrderId.as('hidden', task.id)} />
		<Field
			field={open.fields.volunteerRoleId}
			type="select"
			label="Role"
			options={roleOptions}
			value={task.volunteerRoleId ?? ''}
			placeholder="Pick a role"
		/>
		<Field field={open.fields.capacity} type="number" label="Spots" value={task.capacity} />
		<p class="text-muted text-sm">
			Posts it to the claim board once it has a time; members with the role claim the spots. Anyone
			already on it stays.
		</p>
		<SubmitButton label="Open to volunteers" size="sm" />
	</Form>
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
			label="Contractor"
			options={contractorOptions}
			placeholder="Pick one"
		/>
		<MoneyField field={engage.fields.quotedCents} label="Quote, if they gave one" />
		{#if engageWarning > 0}
			<input {...engage.fields.confirm.as('hidden', true)} />
			<Alert type="warning" class="text-sm">
				{engageWarning === 1 ? 'One person is' : `${engageWarning} people are`} on this. Handing it to
				a contractor cancels their {engageWarning === 1 ? 'signup' : 'signups'} and tells them.
			</Alert>
		{/if}
		<p class="text-muted text-sm">
			Asks them; the quote, booking and invoice live on the engagement, and its cost joins this
			project's spend.
		</p>
		<SubmitButton
			label={engageWarning > 0 ? 'Engage and cancel signups' : 'Engage contractor'}
			size="sm"
		/>
	</Form>
{/if}

{#if !engaged && task.mode !== 'unassigned'}
	<div class="mt-4 border-t border-base-300 pt-3">
		<Form
			remote={unassign}
			onsuccess={(r) => {
				if (r?.status === 'needs_confirmation') unassignWarning = r.liveSignups;
				else onclose();
			}}
		>
			<input {...unassign.fields.projectId.as('hidden', projectId)} />
			<input {...unassign.fields.workOrderId.as('hidden', task.id)} />
			{#if unassignWarning > 0}
				<input {...unassign.fields.confirm.as('hidden', true)} />
				<Alert type="warning" class="mb-2 text-sm">
					{unassignWarning === 1 ? 'One person is' : `${unassignWarning} people are`} on this. Unassigning
					cancels their {unassignWarning === 1 ? 'signup' : 'signups'} and tells them.
				</Alert>
			{/if}
			<SubmitButton
				label={unassignWarning > 0 ? 'Unassign and cancel signups' : 'Unassign'}
				variant="error"
				outline
				size="sm"
			/>
		</Form>
	</div>
{/if}
