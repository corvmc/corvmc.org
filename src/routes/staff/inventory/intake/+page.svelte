<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { withQuery } from '#lib/utils/with-query.js';
	import { goto } from '$app/navigation';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import MemberPicker from '#lib/components/ui/MemberPicker.svelte';
	import MoneyField from '#lib/components/ui/Form/MoneyField.svelte';
	import LocationField from '#lib/components/inventory/LocationField.svelte';
	import IntakeLines from './IntakeLines.svelte';
	import { getIntakePage, recordIntake } from '#lib/remote/inventory.remote.js';
	import { page } from '$app/state';
	import { acquisitionKinds, acquisitionKindLabels, clubToday } from '#lib/config.js';
	import { toast } from 'svelte-sonner';
	import { formatDate } from '#lib/utils/format.js';

	/**
	 * Entering a whole arrival in one sitting.
	 *
	 * **A page, not a modal**, and that is a deliberate exception to "create
	 * forms live in modals": this is a *session*. It wants a URL to come back
	 * to, it does not fit `max-w-lg`, and a stocktake of the building is half an
	 * hour of typing that a misclick outside a dialog must not discard.
	 *
	 * One query for the page (`no-concurrent-remote-queries`); `LocationField`
	 * owns its own, the way `CategoryOptions` does.
	 */
	const orderId = page.url.searchParams.get('order') ?? undefined;
	// Prefilled when a staffer came from the gear request itself, editable
	// either way — an arrival nobody navigated here for can still be linked.
	let suggestionId = $state(page.url.searchParams.get('suggestion') ?? '');

	/** One query, composed on the server — see `getIntakePage`. */
	const data = $derived(await getIntakePage({ orderId }));
	const items = $derived(data.items);
	const { fields } = recordIntake;

	type Unit = { assetTag: string; serialNumber: string; condition: string };
	type Line = { itemId: string; quantity: number; unitCost: string; units: Unit[] };

	/**
	 * Receiving an order *is* intake, prefilled.
	 *
	 * `/staff/inventory/orders/[id]` links here with `?order=`, and the lines
	 * arrive filled in with whatever is still outstanding. That is why orders sit
	 * after intake in the build order: there is no second receiving screen to
	 * keep in step, and the goods land through the same code as every other
	 * arrival, so the ledger cannot fork on whether something was ordered first.
	 *
	 * Seeded once, then owned by the editor — a `$derived` would throw away
	 * whatever the operator had typed every time the page query refreshed.
	 */
	// svelte-ignore state_referenced_locally
	let lines = $state<Line[]>(
		data.order?.lines.filter((l) => l.outstanding > 0).length
			? data.order.lines
					.filter((l) => l.outstanding > 0)
					.map((l) => ({
						itemId: l.itemId,
						quantity: l.outstanding,
						unitCost: l.unitCostCents == null ? '' : (l.unitCostCents / 100).toFixed(2),
						units: []
					}))
			: [{ itemId: '', quantity: 1, unitCost: '', units: [] }]
	);

	// An arrival against an order is a purchase by definition; a walk-in stocktake
	// entry is not, so the default depends on how the page was reached.
	let kind = $state<(typeof acquisitionKinds)[number]>(orderId ? 'purchase' : 'opening_balance');
	let donorUserId = $state('');
	let donorName = $state('');
	let paidByUserId = $state('');
	let paidByName = $state('');

	/** Only a gift owes the FASB disclosure — the same allow-list as receiving. */
	const isGift = $derived(kind === 'donation' || kind === 'grant');
</script>

<PageHeader
	width="3xl"
	title={orderId ? m.staff_inventory_intake_receive_order() : m.staff_receive_stock()}
	subtitle={m.staff_inventory()}
	parent={orderId
		? [
				{ label: m.staff_order(), href: withQuery(resolve('/staff/inventory'), 'show=on-order') },
				{ label: m.staff_order_2(), href: resolve('/staff/inventory/orders/[id]', { id: orderId }) }
			]
		: []}
/>

<PageContent width="3xl">
	{#if data.order}
		<Alert type="info" class="mb-4">
			{m.staff_inventory_intake_receiving_against_partial_deliveries({
				supplierName: data.order.supplierName ?? m.staff_inventory_intake_order()
			})}
		</Alert>
	{:else}
		<Alert type="info" class="mb-4">
			{m.staff_inventory_intake_one_trip_one_receipt_however()}
		</Alert>
	{/if}

	{#if data.pledges.length > 0}
		<!-- Who said they would bring what. Linking the gear request, or naming
		     the donor on a donation that includes the item, closes the pledge. -->
		<InfoCard title={m.staff_inventory_intake_promised_by_donors()} class="mb-6">
			<ul class="flex flex-col gap-2">
				{#each data.pledges as p (p.id)}
					<li class="flex flex-wrap justify-between gap-2">
						<span><strong>{p.entryName}</strong> — {p.donorName}</span>
						<span class="text-subtle"
							>{m.staff_inventory_intake_until({ formatDate: formatDate(p.expiresAt) })}</span
						>
					</li>
				{/each}
			</ul>
		</InfoCard>
	{/if}

	<Form
		remote={recordIntake}
		onsuccess={(result) => {
			if (!result) return;
			toast.success(
				m.staff_inventory_intake_toast({ value: result.unitCount || result.lineCount })
			);
			goto(`/staff/inventory/acquisitions/${result.acquisitionId}`);
		}}
	>
		{#if orderId}
			<!-- What links the acquisition this writes back to the promise it
			     fulfils, and what bumps the order's received quantities. -->
			<input {...fields.purchaseOrderId.as('hidden', orderId)} />
		{/if}
		<div class="space-y-6">
			<InfoCard title={m.staff_inventory_intake_trip()}>
				<div class="grid gap-3 md:grid-cols-2">
					<Field
						field={fields.kind}
						type="select"
						label={m.staff_how_arrived()}
						bind:value={kind}
						options={acquisitionKinds.map((k) => ({ value: k, label: acquisitionKindLabels[k] }))}
					/>
					<Field
						field={fields.occurredAt}
						type="date"
						label={m.staff_when_arrived()}
						value={clubToday()}
						description={kind === 'opening_balance'
							? m.staff_inventory_intake_guess_fine_nothing_counts_opening()
							: undefined}
					/>
				</div>

				{#if kind !== 'opening_balance'}
					<Field
						field={fields.sourceName}
						type="text"
						label={kind === 'purchase' ? m.staff_supplier() : m.staff_donor_grantor()}
					/>
				{/if}
				<Field field={fields.reference} type="text" label={m.staff_reference_receipt_no()} />

				{#if data.plannedGear.length > 0}
					<Field
						field={fields.suggestionId}
						type="select"
						label={m.staff_inventory_intake_fulfils_gear_request()}
						bind:value={suggestionId}
						placeholder={m.staff_inventory_intake_placeholder()}
						options={data.plannedGear.map((g) => ({
							value: g.id,
							label: `${g.title} (${g.voteCount} ${g.voteCount === 1 ? 'vote' : 'votes'})`
						}))}
						description={m.staff_inventory_intake_marks_request_done_tells_whoever()}
					/>
				{/if}

				<MoneyField
					field={fields.totalCents}
					label={m.staff_receipt_total()}
					description={m.staff_inventory_intake_what_paperwork_says_enough_its()}
				/>

				{#if isGift}
					<!-- A member who bought supplies and waived the money is a donor,
					     not a creditor. `paidByUserId` below is the opposite claim and
					     the schema warns against conflating them, so the two pickers
					     never appear together. -->
					<MemberPicker
						field={fields.donorUserId}
						bind:value={donorUserId}
						bind:name={donorName}
						label={m.staff_donated_by()}
					/>
				{/if}

				{#if kind === 'purchase'}
					<MemberPicker
						field={fields.paidByUserId}
						bind:value={paidByUserId}
						bind:name={paidByName}
						label={m.staff_inventory_intake_paid_by_owed_back_leave()}
					/>
				{/if}

				<LocationField field={fields.locationId} label={m.staff_inventory_intake_where_going()} />
				<Field field={fields.notes} type="textarea" label={m.staff_notes()} />

				{#if isGift}
					<Alert type="warning" class="mt-3">
						{m.staff_inventory_intake_gift_owes_fair_value_basis()}
					</Alert>
				{/if}
			</InfoCard>

			<InfoCard title={m.staff_what_arrived()}>
				<IntakeLines {items} bind:lines />
				{#if lines.length === 0}
					<p class="mt-2 text-subtle">
						{m.staff_inventory_intake_optional_record_total_receipt_now()}
					</p>
				{/if}
			</InfoCard>

			<div>
				<SubmitButton label={m.staff_inventory_intake_record_arrival()} />
			</div>
		</div>
	</Form>
</PageContent>
