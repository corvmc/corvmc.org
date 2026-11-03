<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * The duties that come with a work order (`work_task`), ticked on change
	 * rather than behind a Save. A duty is a level below a work order and not
	 * another one: `doneByUserId` is attribution, never credit, and nothing here
	 * touches hours.
	 */
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { setWorkTaskDone } from '#lib/remote/duty-lists.remote.js';

	type Task = {
		id: string;
		label: string;
		done: boolean;
	};

	let { tasks, shiftId }: { tasks: Task[]; shiftId: string } = $props();

	const done = $derived(tasks.filter((t) => t.done).length);
</script>

<InfoCard title={m.volunteer_shift_checklist_title()}>
	{#snippet header(title)}
		<CardTitle>
			{title}
			<span class="text-muted font-normal"
				>{m.volunteer_shift_checklist_text({ done, length: tasks.length })}</span
			>
		</CardTitle>
	{/snippet}

	<ul class="flex flex-col gap-1">
		{#each tasks as task (task.id)}
			<li>
				<Form
					remote={setWorkTaskDone.for(task.id)}
					onchange={(e: Event) => (e.currentTarget as HTMLFormElement).requestSubmit()}
				>
					<input {...setWorkTaskDone.for(task.id).fields.id.as('hidden', task.id)} />
					<input {...setWorkTaskDone.for(task.id).fields.shiftId.as('hidden', shiftId)} />
					<FormField
						field={setWorkTaskDone.for(task.id).fields.done}
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
