<script lang="ts">
	import { resolve } from '$app/paths';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { formatDateShort } from '$lib/utils/format';
	import {
		getCommitteeOpenItems,
		takeDeliverable,
		resolveDeliverable,
		tickDeliverableTask,
		reassignDeliverableForm
	} from '$lib/remote/deliverables.remote';

	/**
	 * What this committee owes, on every show, soonest first (#1701). Anyone on the
	 * roster sees it; members whose committee keeps its work orders can take an
	 * item, tick it, call it done, or hand it to another committee.
	 */
	let { slug }: { slug: string } = $props();

	const data = $derived(await getCommitteeOpenItems(slug));
	const handTo = $derived([
		{ value: '', label: 'Staff' },
		...data.committees.map((c) => ({ value: c.id, label: c.name }))
	]);
</script>

<InfoCard title="Open items">
	{#if data.items.length === 0}
		<EmptyState description="Nothing owed on any show right now." />
	{:else}
		<Table>
			{#snippet head()}
				<th>Item</th>
				<th>Show</th>
				<th>Due</th>
				<th>Who</th>
				{#if data.canKeep}<th class="w-px"><span class="sr-only">Actions</span></th>{/if}
			{/snippet}
			{#each data.items as item (item.id)}
				{@const mine = item.assignees.some((a) => a.userId === data.viewerId)}
				<tr>
					<td class="cell-primary">
						{item.title}
						{#if item.tasks.length > 0}
							<ul class="mt-1 flex flex-col gap-0.5 font-normal">
								{#each item.tasks as task (task.id)}
									<li>
										{#if data.canKeep}
											<Form
												remote={tickDeliverableTask.for(task.id)}
												onchange={(e: Event) =>
													(e.currentTarget as HTMLFormElement).requestSubmit()}
											>
												<input type="hidden" name="taskId" value={task.id} />
												<input type="hidden" name="slug" value={slug} />
												<FormField
													name="done"
													type="checkbox"
													checkboxLabel={task.label}
													value={task.done}
													class={task.done ? 'text-subtle line-through' : ''}
												/>
											</Form>
										{:else}
											<span class={task.done ? 'text-subtle line-through' : ''}>{task.label}</span>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					</td>
					<td>
						{#if item.eventId}
							<a class="link" href={resolve(`/events/${item.eventId}`)}>{item.eventTitle}</a>
							{#if item.eventStartsAt}
								<div class="text-muted text-sm">{formatDateShort(item.eventStartsAt)}</div>
							{/if}
						{:else}
							—
						{/if}
					</td>
					<td class="whitespace-nowrap">
						{#if item.dueAt}
							{#if item.state === 'overdue'}
								<Badge variant="error" size="sm">Overdue · {formatDateShort(item.dueAt)}</Badge>
							{:else}
								{formatDateShort(item.dueAt)}
							{/if}
						{:else}
							—
						{/if}
					</td>
					<td>
						{item.assignees.length > 0
							? item.assignees.map((a) => a.name).join(', ')
							: 'Nobody yet'}
					</td>
					{#if data.canKeep}
						<td class="w-px">
							<div class="flex w-max justify-end gap-2">
								{#if !mine}
									<Action
										action={takeDeliverable.for(item.id)}
										label="Take it"
										aria-label={`Take ${item.title}`}
										variant="ghost"
										size="xs"
										successToast="It's yours"
									>
										{#snippet form()}
											<input type="hidden" name="id" value={item.id} />
											<input type="hidden" name="slug" value={slug} />
										{/snippet}
									</Action>
								{/if}
								<Action
									action={resolveDeliverable.for(item.id)}
									label="Done anyway"
									aria-label={`Mark ${item.title} done`}
									variant="ghost"
									size="xs"
									confirm={`Mark “${item.title}” done, whatever the show says?`}
									successToast="Marked done"
								>
									{#snippet form()}
										<input type="hidden" name="id" value={item.id} />
										<input type="hidden" name="slug" value={slug} />
									{/snippet}
								</Action>
								<Action
									action={reassignDeliverableForm.for(item.id)}
									label="Hand on"
									aria-label={`Hand ${item.title} to another committee`}
									modalTitle="Hand to another committee"
									submitLabel="Hand on"
									variant="ghost"
									size="xs"
									successToast="Handed on"
								>
									{#snippet form()}
										<input type="hidden" name="id" value={item.id} />
										<input type="hidden" name="slug" value={slug} />
										<FormField name="groupId" label="To" type="select" options={handTo} />
									{/snippet}
								</Action>
							</div>
						</td>
					{/if}
				</tr>
			{/each}
		</Table>
	{/if}
</InfoCard>
