<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import { Field } from '$lib/components/ui/Form';
	import {
		getLocalResourceCategories,
		createLocalResourceCategoryForm,
		updateLocalResourceCategoryForm,
		deleteLocalResourceCategoryForm
	} from '$lib/remote/local-resources.remote';

	/** Labels with an order, like equipment categories. A category in use cannot be deleted. */
	const categories = $derived(await getLocalResourceCategories());
	const createFields = createLocalResourceCategoryForm.fields;
	const editFields = updateLocalResourceCategoryForm.fields;
	const deleteFields = deleteLocalResourceCategoryForm.fields;
</script>

<PageHeader title="Categories" subtitle="Local Resources" backHref="/staff/local-resources">
	<Action
		action={createLocalResourceCategoryForm}
		label="New category"
		modalTitle="New category"
		successToast="Category added"
	>
		{#snippet form()}
			<Field field={createFields.name} type="text" label="Name" />
			<Field
				field={createFields.displayOrder}
				type="number"
				label="Order"
				description="Lower numbers come first on the public page."
			/>
		{/snippet}
	</Action>
</PageHeader>

<PageContent>
	{#if categories.length === 0}
		<EmptyState
			title="No categories yet"
			description="Instrument shops, venues, record stores, rehearsal studios, repair techs."
		/>
	{:else}
		<!-- A table with row actions, but each row is two short facts, so no card. -->
		<Table>
			{#snippet head()}
				<th class="col-support">Order</th>
				<th class="cell-primary">Name</th>
				<th class="col-support">Listings</th>
				<th><span class="sr-only">Actions</span></th>
			{/snippet}
			{#each categories as c (c.id)}
				<tr>
					<td class="col-support">{c.displayOrder}</td>
					<td class="cell-primary font-medium">{c.name}</td>
					<td class="col-support">{c.listings}</td>
					<td class="text-right whitespace-nowrap">
						<Action
							action={updateLocalResourceCategoryForm}
							label="Edit"
							variant="ghost"
							size="xs"
							modalTitle="Edit {c.name}"
							successToast="Saved"
						>
							{#snippet form()}
								<input {...editFields.id.as('hidden', c.id)} />
								<Field field={editFields.name} type="text" label="Name" value={c.name} />
								<Field
									field={editFields.displayOrder}
									type="number"
									label="Order"
									value={c.displayOrder}
								/>
							{/snippet}
						</Action>
						{#if Number(c.listings) === 0}
							<Action
								action={deleteLocalResourceCategoryForm}
								label="Delete"
								variant="ghost"
								size="xs"
								modalTitle="Delete {c.name}"
								submitLabel="Delete"
								successToast="Category deleted"
							>
								{#snippet form()}
									<input {...deleteFields.id.as('hidden', c.id)} />
									<p>Nothing is filed under it.</p>
								{/snippet}
							</Action>
						{/if}
					</td>
				</tr>
			{/each}
		</Table>
	{/if}
</PageContent>
