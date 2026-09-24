<script lang="ts">
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Pagination from '$lib/components/ui/Pagination.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { formatDate } from '$lib/utils/format';
	import {
		getRecurringWorkPage,
		createRecurringWork,
		retireRecurringWork
	} from '$lib/remote/maintenance-schedules.remote';

	const page = $derived(await getRecurringWorkPage());
	const roleOptions = $derived(page.roles.map((r) => ({ value: r.id, label: r.name })));
	const projectOptions = $derived([
		{ value: '', label: 'None' },
		...page.projects.map((p) => ({ value: p.id, label: p.name }))
	]);

	const now = Date.now();
	const defaultFirstDue = new Date(now + 7 * 86_400_000).toISOString().slice(0, 10);

	function every(days: number): string {
		if (days === 1) return 'Daily';
		if (days === 7) return 'Weekly';
		if (days % 7 === 0) return `Every ${days / 7} weeks`;
		return `Every ${days} days`;
	}
</script>

<PageHeader title="Recurring Work" subtitle="Staff" backHref="/staff/volunteer">
	{#if page.roles.length > 0}
		<Action
			action={createRecurringWork}
			label="New Recurring Work"
			modalTitle="New recurring work"
			submitLabel="Create"
			successToast="Recurring work created"
		>
			{#snippet form()}
				<FormField name="name" label="Name" type="text" placeholder="Monthly deep clean" />
				<FormField
					name="volunteerRoleId"
					label="Role"
					type="select"
					options={roleOptions}
					value={roleOptions[0]?.value}
				/>
				<FormField
					name="intervalDays"
					label="Repeat every (days)"
					type="number"
					value="30"
					description="Counted from when the last one closed, so a late one pushes the next one back."
				/>
				<FormField name="firstDueOn" label="First one due" type="date" value={defaultFirstDue} />
				<FormField name="capacity" label="How many people" type="number" value="1" />
				<FormField name="projectId" label="Project" type="select" options={projectOptions} />
				<FormField name="notes" label="Notes" type="textarea" />
			{/snippet}
		</Action>
	{/if}
</PageHeader>

<PageContent>
	{#if page.schedules.length === 0}
		<EmptyState
			title="No recurring work yet"
			description="A monthly deep clean or a quarterly PA check. The next work order is written only when the open one is closed, so they never pile up."
		/>
	{:else}
		<InfoCard title="Recurring work">
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Name</th>
					<th>Repeats</th>
					<th>Next due</th>
					<th>On it</th>
					<th>Last closed</th>
					<th><span class="sr-only">Actions</span></th>
				{/snippet}

				{#each page.schedules as s (s.id)}
					<tr>
						<td>
							<StatusBadge status={s.retiredAt ? 'archived' : 'active'} label />
						</td>
						<td>
							{#if s.openWorkOrderId}
								<a
									class="link font-medium"
									href={resolve('/staff/volunteer/shifts/[id]', { id: s.openWorkOrderId })}
									>{s.name}</a
								>
							{:else}
								<div class="font-medium">{s.name}</div>
							{/if}
							<div class="text-sm text-base-content/60">
								{s.roleName}{#if s.projectName}
									· {s.projectName}{/if}
							</div>
						</td>
						<td class="whitespace-nowrap">{every(s.intervalDays)}</td>
						<td class="whitespace-nowrap">
							{#if s.openDueAt}
								<span class:text-error={s.openDueAt.getTime() < now}>{formatDate(s.openDueAt)}</span
								>
							{:else}
								<span class="text-subtle">—</span>
							{/if}
						</td>
						<td>
							{#if s.assignees.length > 0}
								{s.assignees.join(', ')}
							{:else if s.openWorkOrderId}
								<!-- The open occurrence's page is where somebody gets invited. -->
								<a
									class="link text-subtle"
									href={resolve('/staff/volunteer/shifts/[id]', { id: s.openWorkOrderId })}
									>Nobody yet</a
								>
							{:else}
								<span class="text-subtle">—</span>
							{/if}
						</td>
						<td class="whitespace-nowrap">
							{#if s.lastClosedAt}
								{formatDate(s.lastClosedAt)}
							{:else}
								<span class="text-subtle">Never</span>
							{/if}
						</td>
						<td class="text-right">
							{#if !s.retiredAt}
								<Action
									action={retireRecurringWork.for(s.id)}
									label="Retire"
									variant="ghost"
									size="sm"
									modalTitle="Retire recurring work"
									submitLabel="Retire"
									submitVariant="error"
									successToast="Retired"
								>
									{#snippet form()}
										{@const fields = retireRecurringWork.for(s.id).fields}
										<input {...fields.id.as('hidden', s.id)} />
										<p>
											Stop writing new <strong>{s.name}</strong> work orders? The open one stays in the
											queue until someone closes it.
										</p>
									{/snippet}
								</Action>
							{/if}
						</td>
					</tr>
				{/each}
			</Table>
			<Pagination total={page.schedules.length} unit="schedules" />
		</InfoCard>
	{/if}
</PageContent>
