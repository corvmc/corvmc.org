<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import OverflowMenu from '#lib/components/ui/OverflowMenu.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import {
		deleteSectionForm,
		renameSectionForm,
		reorderSectionsCommand
	} from '#lib/remote/tasks.remote.js';

	/** One section's menu on a project's task table: rename, move, delete (#2653). */
	let {
		projectId,
		section,
		sectionIds,
		taskCount,
		onsuccess
	}: {
		projectId: string;
		section: { id: string; name: string };
		/** Every section of the project, in order. */
		sectionIds: string[];
		taskCount: number;
		onsuccess: () => void;
	} = $props();

	const rename = $derived(renameSectionForm.for(section.id));
	const remove = $derived(deleteSectionForm.for(section.id));
	const at = $derived(sectionIds.indexOf(section.id));

	/** The order with this section moved by `delta`, or null at an end. */
	function stepped(delta: -1 | 1): string[] | null {
		const to = at + delta;
		if (at < 0 || to < 0 || to >= sectionIds.length) return null;
		const order = [...sectionIds];
		[order[at], order[to]] = [order[to], order[at]];
		return order;
	}
	const up = $derived(stepped(-1));
	const down = $derived(stepped(1));
	const move = async (order: string[]) => {
		await reorderSectionsCommand({ projectId, sectionIds: order });
		onsuccess();
	};
</script>

<OverflowMenu label={m.staff_tasks_section_menu_label({ name: section.name })}>
	<Action
		action={rename}
		label={m.staff_tasks_rename_section_label()}
		modalTitle={m.staff_tasks_rename_section_title({ name: section.name })}
		submitLabel={m.staff_tasks_rename_label()}
		successToast={m.staff_tasks_section_renamed_toast()}
		{onsuccess}
	>
		{#snippet form()}
			<input {...rename.fields.projectId.as('hidden', projectId)} />
			<input {...rename.fields.sectionId.as('hidden', section.id)} />
			<Field
				field={rename.fields.name}
				type="text"
				label={m.staff_name_label()}
				value={section.name}
			/>
		{/snippet}
	</Action>
	{#if up}
		<Action action={() => move(up)} label={m.staff_tasks_move_section_up_label()} />
	{/if}
	{#if down}
		<Action action={() => move(down)} label={m.staff_tasks_move_section_down_label()} />
	{/if}
	<Action
		action={remove}
		label={m.staff_tasks_delete_section_label()}
		modalTitle={m.staff_delete_2_title({ name: section.name })}
		submitLabel={m.staff_tasks_delete_section_label()}
		submitVariant="error"
		successToast={m.staff_tasks_section_deleted_toast()}
		{onsuccess}
	>
		{#snippet form()}
			<input {...remove.fields.projectId.as('hidden', projectId)} />
			<input {...remove.fields.sectionId.as('hidden', section.id)} />
			<p class="text-sm">
				{taskCount === 0
					? m.staff_tasks_section_empty_text()
					: m.staff_tasks_section_tasks_move_text({ count: taskCount })}
			</p>
		{/snippet}
	</Action>
</OverflowMenu>
