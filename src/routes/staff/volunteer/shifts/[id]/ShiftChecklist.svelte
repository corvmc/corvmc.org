<script lang="ts">
	/**
	 * The checklist that comes with a work order.
	 *
	 * `applyDutyList` has always written these rows — a duty list item carries its
	 * `tasks[]`, and stamping the list onto an event turns each one into a
	 * `work_task`. Nothing read them back: `listWorkTasks` had no callers and
	 * `setWorkTaskDone` was a remote form no page called, so a duty list promised
	 * "Confirm the lineup", "Collect tech riders", "Send load-in details" and then
	 * showed none of it to the person accountable for doing them.
	 *
	 * A task is a level *below* a work order and deliberately not another one:
	 * `doneByUserId` is attribution, never credit, and nothing here touches hours.
	 * Nobody signs up for "take the trash out" or logs four minutes against it.
	 *
	 * Ticking submits on change rather than behind a Save — a checklist with a
	 * save button is a checklist people forget to save.
	 */
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { setWorkTaskDone } from '$lib/remote/duty-lists.remote';

	type Task = {
		id: string;
		label: string;
		done: boolean;
	};

	let { tasks, shiftId }: { tasks: Task[]; shiftId: string } = $props();

	const done = $derived(tasks.filter((t) => t.done).length);
</script>

<InfoCard title="Checklist">
	{#snippet header(title)}
		<CardTitle>
			{title}
			<span class="text-muted font-normal">· {done} of {tasks.length}</span>
		</CardTitle>
	{/snippet}

	<ul class="flex flex-col gap-1">
		{#each tasks as task (task.id)}
			<li>
				<Form
					remote={setWorkTaskDone.for(task.id)}
					onchange={(e: Event) => (e.currentTarget as HTMLFormElement).requestSubmit()}
				>
					<input type="hidden" name="id" value={task.id} />
					<input type="hidden" name="shiftId" value={shiftId} />
					<FormField
						name="done"
						type="checkbox"
						checkboxLabel={task.label}
						value={task.done}
						class={task.done ? 'text-subtle line-through' : ''}
					/>
				</Form>
			</li>
		{/each}
	</ul>
</InfoCard>
