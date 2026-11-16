<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * What a task waits on and what waits on it (#2625), with add and remove.
	 * Blocked is derived from the open tasks it waits on; a done one is struck
	 * through rather than dropped, since it is why the task was free to start.
	 */
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { resolve } from '$app/paths';
	import { IconX } from '@tabler/icons-svelte';
	import { addTaskDependency, removeTaskDependency } from '#lib/remote/volunteer.remote.js';

	type Linked = { id: string; label: string; open: boolean };
	let {
		taskId,
		waitsOn,
		neededFor,
		options,
		editable
	}: {
		taskId: string;
		waitsOn: Linked[];
		neededFor: Linked[];
		options: { id: string; label: string }[];
		/** Open tasks take new edges; a closed one keeps its history. */
		editable: boolean;
	} = $props();

	const add = $derived(addTaskDependency.for(taskId));
	const choices = $derived(options.map((o) => ({ value: o.id, label: o.label })));
</script>

<InfoCard title={m.volunteer_task_dependencies_waits_on_title()} testid="waits-on">
	{#if waitsOn.length === 0}
		<p class="text-subtle text-sm">{m.volunteer_task_dependencies_nothing_text()}</p>
	{:else}
		<ul class="flex flex-col gap-1">
			{#each waitsOn as t (t.id)}
				{@const drop = removeTaskDependency.for(`${taskId}:${t.id}`)}
				<li class="flex items-center justify-between gap-2 text-sm" data-dependency={t.id}>
					<a
						class="link"
						class:line-through={!t.open}
						class:text-subtle={!t.open}
						href={resolve('/staff/tasks/[id]', { id: t.id })}>{t.label}</a
					>
					{#if editable}
						<Action
							action={drop}
							label={m.volunteer_task_dependencies_remove_label({ label: t.label })}
							iconOnly
							icon={removeIcon}
							variant="ghost"
							size="xs"
							modalTitle={m.volunteer_task_dependencies_remove_title()}
							submitLabel={m.volunteer_task_dependencies_remove_submit_label()}
							successToast={m.volunteer_task_dependencies_removed_toast()}
						>
							{#snippet form()}
								<input {...drop.fields.workOrderId.as('hidden', taskId)} />
								<input {...drop.fields.dependsOnId.as('hidden', t.id)} />
							{/snippet}
						</Action>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if editable && choices.length > 0}
		<div class="mt-3">
			<Action
				action={add}
				label={m.volunteer_task_dependencies_add_label()}
				data-testid="add-dependency"
				variant="ghost"
				size="sm"
				modalTitle={m.volunteer_task_dependencies_add_title()}
				submitLabel={m.volunteer_task_dependencies_add_submit_label()}
				successToast={m.volunteer_task_dependencies_added_toast()}
			>
				{#snippet form()}
					<input {...add.fields.workOrderId.as('hidden', taskId)} />
					<Field
						field={add.fields.dependsOnId}
						type="select"
						label={m.volunteer_task_dependencies_task_label()}
						options={choices}
					/>
				{/snippet}
			</Action>
		</div>
	{/if}
</InfoCard>

{#if neededFor.length > 0}
	<InfoCard title={m.volunteer_task_dependencies_needed_for_title()} testid="needed-for">
		<ul class="flex flex-col gap-1">
			{#each neededFor as t (t.id)}
				<li class="text-sm" data-dependent={t.id}>
					<a
						class="link"
						class:line-through={!t.open}
						class:text-subtle={!t.open}
						href={resolve('/staff/tasks/[id]', { id: t.id })}>{t.label}</a
					>
				</li>
			{/each}
		</ul>
	</InfoCard>
{/if}

{#snippet removeIcon()}
	<IconX size={14} />
{/snippet}
