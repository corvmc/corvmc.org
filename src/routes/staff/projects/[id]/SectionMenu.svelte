<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import { Field } from '$lib/components/ui/Form';
	import { IconDots } from '@tabler/icons-svelte';
	import {
		deleteSectionForm,
		renameSectionForm,
		reorderSectionsCommand
	} from '$lib/remote/tasks.remote';
	import { stepSection } from './task-order';
	import type { Section } from './task-view';

	/** One section's menu: rename, move, delete. Moving here is the keyboard's way to reorder. */
	let {
		projectId,
		section,
		sectionIds,
		taskCount
	}: { projectId: string; section: Section; sectionIds: string[]; taskCount: number } = $props();

	const rename = $derived(renameSectionForm.for(section.id));
	const remove = $derived(deleteSectionForm.for(section.id));
	const up = $derived(stepSection(sectionIds, section.id, -1));
	const down = $derived(stepSection(sectionIds, section.id, 1));
	const move = (order: string[]) => reorderSectionsCommand({ projectId, sectionIds: order });
</script>

<details class="dropdown dropdown-end">
	<summary class="btn btn-square btn-ghost btn-xs" aria-label="{section.name} section actions">
		<IconDots size={14} />
	</summary>
	<div class="dropdown-content dropdown-panel flex w-48 flex-col gap-1">
		<Action
			action={rename}
			label="Rename section"
			variant="ghost"
			size="sm"
			class="justify-start"
			modalTitle="Rename {section.name}"
			submitLabel="Rename"
			successToast="Renamed"
		>
			{#snippet form()}
				<input {...rename.fields.projectId.as('hidden', projectId)} />
				<input {...rename.fields.sectionId.as('hidden', section.id)} />
				<Field field={rename.fields.name} type="text" label="Name" value={section.name} />
			{/snippet}
		</Action>
		{#if up}
			<Action
				action={() => move(up)}
				label="Move section up"
				variant="ghost"
				size="sm"
				class="justify-start"
			/>
		{/if}
		{#if down}
			<Action
				action={() => move(down)}
				label="Move section down"
				variant="ghost"
				size="sm"
				class="justify-start"
			/>
		{/if}
		<Action
			action={remove}
			label="Delete section"
			variant="error"
			outline
			size="sm"
			class="justify-start"
			modalTitle="Delete {section.name}?"
			submitLabel="Delete section"
			successToast="Section deleted"
		>
			{#snippet form()}
				<input {...remove.fields.projectId.as('hidden', projectId)} />
				<input {...remove.fields.sectionId.as('hidden', section.id)} />
				<p class="text-sm">
					{taskCount === 0
						? 'It has no tasks.'
						: `Its ${taskCount === 1 ? 'task moves' : `${taskCount} tasks move`} to the top of the list, under no section. Nothing is deleted but the heading.`}
				</p>
			{/snippet}
		</Action>
	</div>
</details>
