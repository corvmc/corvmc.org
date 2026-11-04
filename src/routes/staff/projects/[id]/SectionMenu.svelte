<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { IconDots } from '@tabler/icons-svelte';
	import {
		deleteSectionForm,
		renameSectionForm,
		reorderSectionsCommand
	} from '#lib/remote/tasks.remote.js';
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
	<summary
		class="btn btn-square btn-ghost btn-xs"
		aria-label={m.staff_projects_id_section_menu_aria_label({ name: section.name })}
	>
		<IconDots size={14} />
	</summary>
	<div class="dropdown-content dropdown-panel flex w-48 flex-col gap-1">
		<Action
			action={rename}
			label={m.staff_projects_id_section_menu_rename_section()}
			variant="ghost"
			size="sm"
			class="justify-start"
			modalTitle={m.staff_projects_id_section_menu_rename({ name: section.name })}
			submitLabel={m.staff_projects_id_section_menu_rename_2()}
			successToast={m.staff_projects_id_section_menu_renamed()}
		>
			{#snippet form()}
				<input {...rename.fields.projectId.as('hidden', projectId)} />
				<input {...rename.fields.sectionId.as('hidden', section.id)} />
				<Field field={rename.fields.name} type="text" label={m.staff_name()} value={section.name} />
			{/snippet}
		</Action>
		{#if up}
			<Action
				action={() => move(up)}
				label={m.staff_projects_id_section_menu_move_section_up()}
				variant="ghost"
				size="sm"
				class="justify-start"
			/>
		{/if}
		{#if down}
			<Action
				action={() => move(down)}
				label={m.staff_projects_id_section_menu_move_section_down()}
				variant="ghost"
				size="sm"
				class="justify-start"
			/>
		{/if}
		<Action
			action={remove}
			label={m.staff_projects_id_section_menu_delete_section()}
			variant="error"
			outline
			size="sm"
			class="justify-start"
			modalTitle={m.staff_delete_2({ name: section.name })}
			submitLabel={m.staff_projects_id_section_menu_delete_section()}
			successToast={m.staff_projects_id_section_menu_section_deleted()}
		>
			{#snippet form()}
				<input {...remove.fields.projectId.as('hidden', projectId)} />
				<input {...remove.fields.sectionId.as('hidden', section.id)} />
				<p class="text-sm">
					{taskCount === 0
						? m.staff_projects_id_section_menu_has_no_tasks()
						: m.staff_projects_id_section_menu_tasks_move({ count: taskCount })}
				</p>
			{/snippet}
		</Action>
	</div>
</details>
