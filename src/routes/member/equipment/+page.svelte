<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { page } from '$app/state';
	import SearchInput from '#lib/components/ui/Form/SearchInput.svelte';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Modal from '#lib/components/ui/Modal.svelte';
	import {
		submitLoanRequest as submitRequest,
		getMemberEquipmentPage
	} from '#lib/remote/inventory.remote.js';

	const { fields } = submitRequest;
	import Form from '#lib/components/ui/Form/Form.svelte';
	import { Field, Select } from '#lib/components/ui/Form/index.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { toast } from 'svelte-sonner';
	import { estimateLoanCost } from '#lib/config.js';
	import type { PricingTier } from '#lib/server/db/schema/inventory.js';
	import { formatCents } from '#lib/utils/format.js';

	let search = $state('');
	let categoryId = $state('');

	let searchDebounced = $state('');
	let filters = $derived({
		search: searchDebounced || undefined,
		categoryId: categoryId || undefined
	});

	// One query for the list and the page's own facts (credit balance, sustaining status, the
	// category filter).
	const pageData = $derived(await getMemberEquipmentPage(filters));
	const equipment = $derived(pageData.equipment);
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

	/**
	 * Opened from a scanned sticker. The asset page has the item id and no form
	 * to put it in, so it links here with `?request=<itemId>` and this finds the
	 * catalog row to fill the modal from (#1073). Fires once: `opened` stops the
	 * effect reopening it after the member closes it.
	 */
	let opened = $state(false);
	$effect(() => {
		const wanted = page.url.searchParams.get('request');
		if (!wanted || opened) return;
		const match = equipment.find((r) => r.id === wanted);
		if (!match) return;
		opened = true;
		openRequest(match.id, match.name, match.pricingTier);
	});

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

<PageHeader title={m.member_equipment_equipment_catalog()}>
	<div class="flex items-center gap-3">
		<!-- Equipment credits are stored in cents, the same as every other amount
		     the ledger holds — `checkoutLoan` spends them against a cents total.
		     Printed raw, a $25 balance read as "2500 credits", which is either a
		     fortune or a currency nobody could name. -->
		{#if meta.creditBalance > 0}
			<Badge variant="info" size="md"
				>{m.member_equipment_credit({ formatCents: formatCents(meta.creditBalance) })}</Badge
			>
		{/if}
		<Button href="/member/equipment/loans" variant="ghost" size="sm"
			>{m.member_equipment_my_loans()}</Button
		>
	</div>
</PageHeader>
<PageContent>
	<div class="mb-4 flex flex-wrap items-end gap-2">
		<SearchInput
			bind:value={search}
			placeholder={m.member_equipment_placeholder()}
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
			<option value="">{m.member_all_categories()}</option>
			{#each meta.categories as cat (cat.id)}
				<option value={cat.id}>{cat.name}</option>
			{/each}
		</Select>
		{#if hasActiveFilters()}
			<Button variant="ghost" size="sm" onclick={clearFilters}>{m.member_equipment_clear()}</Button>
		{/if}
	</div>

	{#if equipment.length === 0}
		<EmptyState message={m.member_equipment_message()} />
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
										{m.member_equipment_available({ availableQuantity: eq.availableQuantity })}
									</Badge>
								</div>
								<div class="mt-2 card-actions">
									<Button
										variant="default"
										size="xs"
										disabled={eq.availableQuantity <= 0}
										onclick={() => openRequest(eq.id, eq.name, eq.pricingTier)}
									>
										{m.member_equipment_request()}
									</Button>
								</div>
							</CardBody>
						</Card>
					{/each}
				</div>
			</div>
		{/each}
	{/if}

	<div class="border-t pt-4">
		<p class="mb-2 text-muted">{m.member_equipment_can_t_find_what_need()}</p>
		<Button variant="default" size="sm" outline onclick={openFreeFormRequest}
			>{m.member_equipment_describe_request()}</Button
		>
	</div>
</PageContent>

<Modal
	bind:open={showRequestModal}
	title={isFreeForm
		? m.member_equipment_free_form_equipment_request()
		: m.member_equipment_request_2({ selectedEquipmentName })}
	maxWidth="max-w-md"
>
	<Form
		remote={submitRequest}
		onsuccess={() => {
			toast.success(m.member_equipment_toast());
			showRequestModal = false;
			goto(resolve('member/equipment/loans'));
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
			<Field
				field={submitRequest.fields.requestedPickupDate}
				type="date"
				label={m.member_equipment_preferred_pickup_date()}
				required
			/>
		</div>
		<div
			oninput={(e: Event) => {
				returnDateValue = (e.target as HTMLInputElement).value;
			}}
		>
			<Field
				field={submitRequest.fields.estimatedReturnDate}
				type="date"
				label={m.member_equipment_estimated_return_date()}
				required
			/>
		</div>
		{#if !isFreeForm}
			<Field
				field={submitRequest.fields.quantity}
				submitAs="text"
				type="number"
				value={1}
				label={m.member_equipment_quantity()}
			/>
		{/if}
		{#if costEstimate != null}
			<div class="rounded-lg bg-info/10 px-4 py-3 text-sm">
				{#if costEstimate === 0}
					<span class="font-medium">{m.member_equipment_free_sustaining_members()}</span>
				{:else}
					<ParaglideMessage
						message={m.member_equipment_estimated_cost}
						inputs={{ formatCents: formatCents(costEstimate) }}
						>{#snippet span({ children })}<span class="font-semibold">{@render children?.()}</span
							>{/snippet}</ParaglideMessage
					>
				{/if}
			</div>
		{:else if isFreeForm && pickupDateValue && returnDateValue}
			<div class="rounded-lg bg-base-200 px-4 py-3 text-muted">
				{m.member_equipment_cost_will_determined_when_equipment()}
			</div>
		{/if}
		<Field
			field={submitRequest.fields.memberNotes}
			type="textarea"
			label={isFreeForm
				? m.member_equipment_describe_what_need()
				: m.member_equipment_notes_optional()}
			required={isFreeForm}
		/>
		<div class="modal-action">
			<Button type="button" variant="ghost" onclick={() => (showRequestModal = false)}
				>{m.member_cancel()}</Button
			>
			<SubmitButton label={m.member_equipment_submit_request()} />
		</div>
	</Form>
</Modal>
