<script lang="ts">
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import {
		submitLoanRequest as submitRequest,
		getMemberEquipmentPage
	} from '$lib/remote/inventory.remote';

	const { fields } = submitRequest;
	import Form from '$lib/components/ui/Form/Form.svelte';
	import { Field, Select } from '$lib/components/ui/Form';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { toast } from 'svelte-sonner';
	import { estimateLoanCost } from '$lib/config';
	import type { PricingTier } from '$lib/server/db/schema/inventory';
	import { formatCents } from '$lib/utils/format';

	let search = $state('');
	let categoryId = $state('');

	let searchDebounced = $state('');
	let filters = $derived({
		search: searchDebounced || undefined,
		categoryId: categoryId || undefined
	});

	// One query for the list and the page's own facts (credit balance, sustaining status, the
	// category filter). `equipmentResult` stays a promise for the {#await} below.
	const pageData = $derived(await getMemberEquipmentPage(filters));
	const equipmentResult = $derived(pageData.equipment);
	const meta = $derived(pageData.meta);

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

	function openRequest(itemId: string, name: string, pricingTier: string) {
		selectedEquipmentId = itemId;
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
		<!-- Equipment credits are stored in cents, the same as every other amount
		     the ledger holds — `checkoutLoan` spends them against a cents total.
		     Printed raw, a $25 balance read as "2500 credits", which is either a
		     fortune or a currency nobody could name. -->
		{#if meta.creditBalance > 0}
			<Badge variant="info" size="md">{formatCents(meta.creditBalance)} credit</Badge>
		{/if}
		<Button href="/member/equipment/loans" variant="ghost" size="sm">My Loans</Button>
	</div>
</PageHeader>
<PageContent>
	<div class="mb-4 flex flex-wrap items-end gap-2">
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
			<span class="loading loading-lg loading-spinner"></span>
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
					<h3 class="mb-2 text-muted font-semibold">{groupName}</h3>
					<div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{#each items as eq (eq.id)}
							<Card class="border">
								<CardBody padding="sm">
									<CardTitle size="sm">{eq.name}</CardTitle>
									{#if eq.description}
										<p class="line-clamp-2 text-subtle">{eq.description}</p>
									{/if}
									<div class="mt-1 flex flex-wrap items-center gap-1">
										<!-- Condition moved to the individual unit: four Twin Reverbs are
										     one catalog row and four records, and one of them is the beat-up
										     one. Which unit you get is decided at checkout. -->
										<Badge variant="ghost" size="xs">{priceLabel(eq.pricingTier)}</Badge>
										<Badge variant={eq.availableQuantity <= 0 ? 'error' : 'ghost'} size="xs">
											{eq.availableQuantity} available
										</Badge>
									</div>
									<div class="mt-2 card-actions">
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
							</Card>
						{/each}
					</div>
				</div>
			{/each}
		{/if}
	{/await}

	<div class="border-t pt-4">
		<p class="mb-2 text-muted">Can't find what you need?</p>
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
			<input {...fields.itemId.as('hidden', selectedEquipmentId!)} />
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
