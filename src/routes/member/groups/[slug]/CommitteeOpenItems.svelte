<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { formatDateShort } from '$lib/utils/format';
	import { toast } from 'svelte-sonner';
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

	/** Taking it goes through over a missing profile or clearance; say what it went over. */
	function warnOver(result?: unknown) {
		const warnings = (result as { warnings?: string[] } | undefined)?.warnings ?? [];
		if (warnings.length > 0)
			toast.warning(m.member_groups_slug_committee_open_items_toast({ join: warnings.join(' ') }));
	}

	const data = $derived(await getCommitteeOpenItems(slug));
	const handTo = $derived([
		{ value: '', label: m.member_groups_slug_committee_open_items_staff() },
		...data.committees.map((c) => ({ value: c.id, label: c.name }))
	]);
</script>

<InfoCard title={m.member_open_items()}>
	{#if data.items.length === 0}
		<EmptyState description={m.member_groups_slug_committee_open_items_description()} />
	{:else}
		<Table>
			{#snippet head()}
				<th>{m.member_item()}</th>
				<th>{m.member_show()}</th>
				<th>{m.member_due()}</th>
				<th>{m.member_groups_slug_committee_open_items_who()}</th>
				{#if data.canKeep}<th class="w-px"><span class="sr-only">{m.member_actions()}</span></th
					>{/if}
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
								<Badge variant="error" size="sm"
									>{m.member_groups_slug_committee_open_items_overdue({
										formatDateShort: formatDateShort(item.dueAt)
									})}</Badge
								>
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
							: m.member_groups_slug_committee_open_items_nobody_yet()}
					</td>
					{#if data.canKeep}
						<td class="w-px">
							<div class="flex w-max justify-end gap-2">
								{#if !mine}
									<Action
										action={takeDeliverable.for(item.id)}
										label={m.member_groups_slug_committee_open_items_take()}
										aria-label={m.member_groups_slug_committee_open_items_take_2({
											title: item.title
										})}
										variant="ghost"
										size="xs"
										successToast={m.member_groups_slug_committee_open_items_s_yours()}
										onsuccess={warnOver}
									>
										{#snippet form()}
											<input type="hidden" name="id" value={item.id} />
											<input type="hidden" name="slug" value={slug} />
										{/snippet}
									</Action>
								{/if}
								<Action
									action={resolveDeliverable.for(item.id)}
									label={m.member_groups_slug_committee_open_items_done_anyway()}
									aria-label={m.member_groups_slug_committee_open_items_mark_done({
										title: item.title
									})}
									variant="ghost"
									size="xs"
									modalTitle={m.member_groups_slug_committee_open_items_mark_done_2({
										title: item.title
									})}
									submitLabel={m.member_groups_slug_committee_open_items_done_anyway()}
									successToast={m.member_groups_slug_committee_open_items_marked_done()}
								>
									{#snippet form()}
										<input type="hidden" name="id" value={item.id} />
										<input type="hidden" name="slug" value={slug} />
										<FormField
											name="reason"
											label={m.member_groups_slug_committee_open_items_why()}
											type="textarea"
											required={item.doneWhen !== null}
										/>
									{/snippet}
								</Action>
								<Action
									action={reassignDeliverableForm.for(item.id)}
									label={m.member_groups_slug_committee_open_items_hand()}
									aria-label={m.member_groups_slug_committee_open_items_hand_another_committ({
										title: item.title
									})}
									modalTitle={m.member_groups_slug_committee_open_items_hand_another_committ_2()}
									submitLabel={m.member_groups_slug_committee_open_items_hand()}
									variant="ghost"
									size="xs"
									successToast={m.member_groups_slug_committee_open_items_handed()}
								>
									{#snippet form()}
										<input type="hidden" name="id" value={item.id} />
										<input type="hidden" name="slug" value={slug} />
										<FormField
											name="groupId"
											label={m.member_text()}
											type="select"
											options={handTo}
										/>
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
