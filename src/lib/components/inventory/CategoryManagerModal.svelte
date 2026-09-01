<script lang="ts">
	import Modal from '$lib/components/ui/Modal.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { Field } from '$lib/components/ui/Form';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { RemoveCategoryAction } from '$lib/components/actions';
	import { addCategory, editCategory, getEquipmentCategories } from '$lib/remote/inventory.remote';
	import { pricingTiers } from '$lib/config';
	import type { PricingTier } from '$lib/server/db/schema/inventory';

	/**
	 * Managing equipment categories — the table, the add/edit form, and the query behind both.
	 *
	 * It owns `getEquipmentCategories` rather than taking the list as a prop, so `/staff/inventory`
	 * is left holding one query. That is not just tidiness: the query is unparameterized and the
	 * category mutations refresh it by name, so folding it into the page's filter-keyed query
	 * would have left it stale after every add or edit.
	 */
	const { fields: editCategoryFields } = editCategory;

	let { open = $bindable(false) }: { open?: boolean } = $props();

	let editingCategory = $state<null | {
		id: string;
		name: string;
		displayOrder: number;
		pricingTier: PricingTier;
	}>(null);

	const categories = $derived(await getEquipmentCategories());

	function refreshCategories() {
		editingCategory = null;
		void getEquipmentCategories().refresh();
	}

	// `editCategory` and `addCategory` have different inputs, and `RemoteForm` is
	// invariant in that parameter, so the ternary has no common type. Hoisted
	// because an eslint comment cannot live inside an attribute list. See the
	// note in Action.svelte.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const categoryForm = $derived(editingCategory?.id ? (editCategory as any) : addCategory);
</script>

<Modal bind:open title="Manage Categories" maxWidth="max-w-lg">
	<div class="mb-4">
		{#if categories.length === 0}
			<EmptyState description="No categories" />
		{:else}
			<Table>
				{#snippet head()}
					<th>Name</th>
					<th class="col-support">Pricing tier</th>
					<th class="col-support cell-num">Order</th>
					<th class="w-px"><span class="sr-only">Actions</span></th>
				{/snippet}
				{#each categories as cat (cat.id)}
					<tr>
						<td class="cell-primary truncate">{cat.name}</td>
						<td class="col-support"><Badge size="sm" variant="outline">{cat.pricingTier}</Badge></td
						>
						<td class="col-support cell-num">{cat.displayOrder}</td>
						<td class="w-px text-right">
							<Button
								variant="ghost"
								size="xs"
								onclick={() =>
									(editingCategory = {
										id: cat.id,
										name: cat.name,
										displayOrder: cat.displayOrder,
										pricingTier: cat.pricingTier as PricingTier
									})}>Edit</Button
							>
							<RemoveCategoryAction categoryId={cat.id} name={cat.name} />
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	</div>

	<div class="space-y-3 border-t pt-4">
		<h4 class="text-sm font-semibold">{editingCategory?.id ? 'Edit' : 'Add'} Category</h4>
		{#if !editingCategory}
			<Button
				type="button"
				variant="default"
				size="sm"
				outline
				onclick={() =>
					(editingCategory = {
						id: '',
						name: '',
						displayOrder: 0,
						pricingTier: 'accessory' as PricingTier
					})}
			>
				+ New Category
			</Button>
		{:else}
			<Form
				remote={categoryForm}
				successToast={editingCategory.id ? 'Category updated' : 'Category added'}
				onsuccess={refreshCategories}
				class="space-y-3"
			>
				{#if editingCategory.id}
					<input {...editCategoryFields.id.as('hidden', editingCategory.id)} />
				{/if}
				<div class="grid grid-cols-3 gap-3">
					<Field
						name="name"
						type="text"
						label="Name"
						class="col-span-2"
						value={editingCategory.name}
					/>
					<Field
						name="displayOrder"
						type="number"
						label="Order"
						value={editingCategory.displayOrder}
					/>
				</div>
				<Field
					name="pricingTier"
					type="select"
					label="Pricing Tier"
					value={editingCategory.pricingTier}
					options={pricingTiers.map((t) => ({
						value: t,
						label: `${t} (${t === 'major' ? '$5/day' : '$1/day'})`
					}))}
				/>
				<div class="flex gap-2">
					<Button type="button" variant="ghost" size="sm" onclick={() => (editingCategory = null)}
						>Cancel</Button
					>
					<SubmitButton label={editingCategory.id ? 'Save' : 'Add'} variant="primary" size="sm" />
				</div>
			</Form>
		{/if}
	</div>
</Modal>
