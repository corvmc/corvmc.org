<script lang="ts">
	import SearchInput from '$lib/components/shared/Form/SearchInput.svelte';
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
	import CardTitle from '$lib/components/shared/Card/CardTitle.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import Modal from '$lib/components/shared/Modal.svelte';
	import {
		submitLoanRequest as submitRequest,
		getMemberEquipment,
		getMemberEquipmentMeta
	} from '$lib/remote/equipment.remote';

	const { fields } = submitRequest;
	import Form from '$lib/components/shared/Form/Form.svelte';
	import { Field, Select } from '$lib/components/shared/Form';
	import Badge from '$lib/components/shared/Badge.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import { toast } from 'svelte-sonner';
	import { IconCircleCheck, IconAlertCircle, IconAlertTriangle } from '@tabler/icons-svelte';
	import { estimateLoanCost } from '$lib/config';
	import type { PricingTier } from '$lib/server/db/schema/equipment';
	import { formatCents } from '$lib/utils/format';

	let search = $state('');
	let categoryId = $state('');

	let searchDebounced = $state('');
	let filters = $derived({
		search: searchDebounced || undefined,
		categoryId: categoryId || undefined
	});

	let equipmentResult = $derived(getMemberEquipment(filters));
	let meta = $derived(await getMemberEquipmentMeta());

	let showRequestModal = $state(false);
	let selectedEquipmentId = $state<string | undefined>(undefined);
	let selectedEquipmentName = $state('');
	let selectedPricingTier = $state<PricingTier>('major');
	let isFreeForm = $state(false);

	let pickupDateValue = $state('');
	let returnDateValue = $state('');

	let costEstimate = $derived.by(() => {
		if (isFreeForm || !pickupDateValue || !returnDateValue) return null;
		const pickup = new Date(pickupDateValue);
		const returnDate = new Date(returnDateValue);
		if (returnDate <= pickup) return null;
		return estimateLoanCost(pickup, returnDate, selectedPricingTier, meta.isSustainingMember);
	});

	function openRequest(equipmentId: string, name: string, pricingTier: string) {
		selectedEquipmentId = equipmentId;
		selectedEquipmentName = name;
		selectedPricingTier = (pricingTier as PricingTier) ?? 'major';
		isFreeForm = false;
		pickupDateValue = '';
		returnDateValue = '';
		showRequestModal = true;
	}

	function openFreeFormRequest() {
		selectedEquipmentId = undefined;
		selectedEquipmentName = '';
		isFreeForm = true;
		pickupDateValue = '';
		returnDateValue = '';
		showRequestModal = true;
	}

	function priceLabel(tier: string): string {
		return tier === 'major' ? '$5/day' : '$1/day';
	}

	function hasActiveFilters(): boolean {
		return !!(searchDebounced || categoryId);
	}

	function clearFilters() {
		search = '';
		searchDebounced = '';
		categoryId = '';
	}
</script>

<PageHeader title="Equipment Catalog">
	<div class="flex items-center gap-3">
		{#if meta.creditBalance > 0}
			<Badge variant="info" size="md">{meta.creditBalance} credits</Badge>
		{/if}
		<Button href="/member/equipment/loans" variant="ghost" size="sm">My Loans</Button>
	</div>
</PageHeader>
<PageContent>
	<div class="flex flex-wrap items-end gap-2 mb-4">
		<SearchInput
			bind:value={search}
			placeholder="Search equipment..."
			onsearch={(q) => {
				searchDebounced = q;
			}}
		/>
		<Select
			size="sm"
			value={categoryId}
			onchange={(e: Event) => {
				categoryId = (e.currentTarget as HTMLSelectElement).value;
			}}
		>
			<option value="">All categories</option>
			{#each meta.categories as cat (cat.id)}
				<option value={cat.id}>{cat.name}</option>
			{/each}
		</Select>
		{#if hasActiveFilters()}
			<Button variant="ghost" size="sm" onclick={clearFilters}>Clear</Button>
		{/if}
	</div>

	{#await equipmentResult}
		<div class="flex justify-center py-12">
			<span class="loading loading-spinner loading-lg"></span>
		</div>
	{:then equipment}
		{#if equipment.length === 0}
			<EmptyState message="No equipment available." />
		{:else}
			{@const groups = equipment.reduce<Record<string, typeof equipment>>((acc, eq) => {
				const key = eq.categoryName;
				(acc[key] ??= []).push(eq);
				return acc;
			}, {})}
			{#each Object.entries(groups) as [groupName, items] (groupName)}
				<div class="mb-6">
					<h3 class="text-muted font-semibold mb-2">{groupName}</h3>
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{#each items as eq (eq.id)}
							<div class="card bg-base-100 border shadow-sm">
								<CardBody padding="sm">
									<CardTitle size="sm">{eq.name}</CardTitle>
									{#if eq.description}
										<p class="text-subtle line-clamp-2">{eq.description}</p>
									{/if}
									<div class="flex flex-wrap items-center gap-1 mt-1">
										<span class="tooltip" data-tip={eq.condition}>
											{#if eq.condition === 'good'}
												<IconCircleCheck size={14} class="text-success" />
											{:else if eq.condition === 'fair'}
												<IconAlertCircle size={14} class="text-warning" />
											{:else}
												<IconAlertTriangle size={14} class="text-error" />
											{/if}
										</span>
										<Badge variant="ghost" size="xs">{priceLabel(eq.pricingTier)}</Badge>
										<span class="badge badge-xs" class:badge-error={eq.availableQuantity <= 0}>
											{eq.availableQuantity} available
										</span>
									</div>
									<div class="card-actions mt-2">
										<Button
											variant="default"
											size="xs"
											disabled={eq.availableQuantity <= 0}
											onclick={() => openRequest(eq.id, eq.name, eq.pricingTier)}
										>
											Request
										</Button>
									</div>
								</CardBody>
							</div>
						{/each}
					</div>
				</div>
			{/each}
		{/if}
	{/await}

	<div class="border-t pt-4">
		<p class="text-muted mb-2">Can't find what you need?</p>
		<Button variant="default" size="sm" outline onclick={openFreeFormRequest}
			>Describe Your Request</Button
		>
	</div>
</PageContent>

<Modal
	bind:open={showRequestModal}
	title={isFreeForm ? 'Free-form Equipment Request' : `Request: ${selectedEquipmentName}`}
	maxWidth="max-w-md"
>
	<Form
		remote={submitRequest}
		onsuccess={() => {
			toast.success('Request submitted! Staff will confirm your pickup.');
			showRequestModal = false;
			goto(resolve('/member/equipment/loans'));
		}}
	>
		{#if !isFreeForm}
			<input {...fields.equipmentId.as('hidden', selectedEquipmentId!)} />
		{/if}
		<div
			oninput={(e: Event) => {
				pickupDateValue = (e.target as HTMLInputElement).value;
			}}
		>
			<Field name="requestedPickupDate" type="date" label="Preferred Pickup Date" required />
		</div>
		<div
			oninput={(e: Event) => {
				returnDateValue = (e.target as HTMLInputElement).value;
			}}
		>
			<Field name="estimatedReturnDate" type="date" label="Estimated Return Date" required />
		</div>
		{#if !isFreeForm}
			<Field name="quantity" type="number" value={1} label="Quantity" />
		{/if}
		{#if costEstimate != null}
			<div class="rounded-lg bg-info/10 px-4 py-3 text-sm">
				{#if costEstimate === 0}
					<span class="font-medium">Free for sustaining members</span>
				{:else}
					Estimated cost: <span class="font-semibold">{formatCents(costEstimate)}</span>
				{/if}
			</div>
		{:else if isFreeForm && pickupDateValue && returnDateValue}
			<div class="rounded-lg bg-base-200 px-4 py-3 text-muted">
				Cost will be determined when equipment is assigned
			</div>
		{/if}
		<Field
			name="memberNotes"
			type="textarea"
			label={isFreeForm ? 'Describe what you need' : 'Notes (optional)'}
			required={isFreeForm}
		/>
		<div class="modal-action">
			<Button type="button" variant="ghost" onclick={() => (showRequestModal = false)}
				>Cancel</Button
			>
			<SubmitButton label="Submit Request" />
		</div>
	</Form>
</Modal>
