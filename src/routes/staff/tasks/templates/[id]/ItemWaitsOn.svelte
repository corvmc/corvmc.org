<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * The items one template item waits on (#2625), with add and remove. Applying
	 * the template makes each of these a task dependency on the stamped tasks.
	 */
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { IconX } from '@tabler/icons-svelte';
	import {
		addDutyListItemDependency,
		removeDutyListItemDependency
	} from '#lib/remote/duty-lists.remote.js';

	type Item = { id: string; label: string };
	let {
		item,
		waitsOn,
		others
	}: {
		item: Item;
		/** The items it waits on, by name. */
		waitsOn: Item[];
		/** The template's other items, which it could wait on. */
		others: Item[];
	} = $props();

	const add = $derived(addDutyListItemDependency.for(item.id));
	const choices = $derived(
		others
			.filter((o) => !waitsOn.some((w) => w.id === o.id))
			.map((o) => ({ value: o.id, label: o.label }))
	);
</script>

<div class="mt-1 flex flex-wrap items-center gap-1 text-xs" data-testid="item-waits-on">
	{#if waitsOn.length > 0}
		<span class="text-subtle">{m.staff_project_templates_id_waits_on_text()}</span>
		{#each waitsOn as on (on.id)}
			{@const drop = removeDutyListItemDependency.for(`${item.id}:${on.id}`)}
			<span class="inline-flex items-center gap-0.5" data-depends-on={on.id}>
				{on.label}
				<Action
					action={drop}
					label={m.staff_project_templates_id_stop_waiting_label({ label: on.label })}
					iconOnly
					icon={removeIcon}
					variant="ghost"
					size="xs"
					modalTitle={m.staff_project_templates_id_stop_waiting_title()}
					submitLabel={m.staff_project_templates_id_stop_waiting_submit_label()}
					successToast={m.staff_saved_toast()}
				>
					{#snippet form()}
						<input {...drop.fields.itemId.as('hidden', item.id)} />
						<input {...drop.fields.dependsOnItemId.as('hidden', on.id)} />
					{/snippet}
				</Action>
			</span>
		{/each}
	{/if}
	{#if choices.length > 0}
		<Action
			action={add}
			label={m.staff_project_templates_id_wait_on_label()}
			variant="ghost"
			size="xs"
			data-testid="add-item-dependency"
			modalTitle={m.staff_project_templates_id_wait_on_title({ label: item.label })}
			submitLabel={m.staff_project_templates_id_wait_on_submit_label()}
			successToast={m.staff_saved_toast()}
		>
			{#snippet form()}
				<input {...add.fields.itemId.as('hidden', item.id)} />
				<Field
					field={add.fields.dependsOnItemId}
					type="select"
					label={m.staff_project_templates_id_item_label()}
					options={choices}
				/>
			{/snippet}
		</Action>
	{/if}
</div>

{#snippet removeIcon()}
	<IconX size={12} />
{/snippet}
