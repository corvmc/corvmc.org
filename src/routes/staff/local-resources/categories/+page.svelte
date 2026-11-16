<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import {
		getLocalResourceCategories,
		createLocalResourceCategoryForm,
		updateLocalResourceCategoryForm,
		deleteLocalResourceCategoryForm
	} from '#lib/remote/local-resources.remote.js';

	/** Labels with an order, like equipment categories. A category in use cannot be deleted. */
	const categories = $derived(await getLocalResourceCategories());
	const createFields = createLocalResourceCategoryForm.fields;
	const editFields = updateLocalResourceCategoryForm.fields;
	const deleteFields = deleteLocalResourceCategoryForm.fields;
</script>

<PageHeader title={m.staff_categories_title()} subtitle={m.staff_local_resources_body()}>
	<Action
		action={createLocalResourceCategoryForm}
		label={m.staff_local_resources_categories_new_category_label()}
		modalTitle={m.staff_local_resources_categories_new_category_title()}
		successToast={m.staff_local_resources_categories_category_added_toast()}
	>
		{#snippet form()}
			<Field field={createFields.name} type="text" label={m.staff_name_label()} />
			<Field
				field={createFields.displayOrder}
				type="number"
				label={m.staff_order_2_label()}
				description={m.staff_local_resources_categories_lower_numbers_come_first_pu_body()}
			/>
		{/snippet}
	</Action>
</PageHeader>

<PageContent>
	{#if categories.length === 0}
		<EmptyState
			title={m.staff_no_categories_yet_title()}
			description={m.staff_local_resources_categories_instrument_shops_venues_rec_body()}
		/>
	{:else}
		<!-- A table with row actions, but each row is two short facts, so no card. -->
		<Table>
			{#snippet head()}
				<th class="col-support">{m.staff_order_2_label()}</th>
				<th class="cell-primary">{m.staff_name_label()}</th>
				<th class="col-support">{m.staff_listings_label()}</th>
				<th><span class="sr-only">{m.staff_actions_label()}</span></th>
			{/snippet}
			{#each categories as c (c.id)}
				<tr>
					<td class="col-support">{c.displayOrder}</td>
					<td class="cell-primary font-medium">{c.name}</td>
					<td class="col-support">{c.listings}</td>
					<td class="text-right whitespace-nowrap">
						<Action
							action={updateLocalResourceCategoryForm}
							label={m.staff_edit_label()}
							variant="ghost"
							size="xs"
							modalTitle={m.staff_edit_2_title({ name: c.name })}
							successToast={m.staff_saved_toast()}
						>
							{#snippet form()}
								<input {...editFields.id.as('hidden', c.id)} />
								<Field
									field={editFields.name}
									type="text"
									label={m.staff_name_label()}
									value={c.name}
								/>
								<Field
									field={editFields.displayOrder}
									type="number"
									label={m.staff_order_2_label()}
									value={c.displayOrder}
								/>
							{/snippet}
						</Action>
						{#if Number(c.listings) === 0}
							<Action
								action={deleteLocalResourceCategoryForm}
								label={m.staff_delete_label()}
								variant="ghost"
								size="xs"
								modalTitle={m.staff_local_resources_categories_delete_title({ name: c.name })}
								submitLabel={m.staff_delete_label()}
								successToast={m.staff_category_deleted_toast()}
							>
								{#snippet form()}
									<input {...deleteFields.id.as('hidden', c.id)} />
									<p>{m.staff_local_resources_categories_nothing_filed_under_text()}</p>
								{/snippet}
							</Action>
						{/if}
					</td>
				</tr>
			{/each}
		</Table>
	{/if}
</PageContent>
