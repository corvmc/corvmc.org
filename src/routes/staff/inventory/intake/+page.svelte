<script lang="ts">
	import { goto } from '$app/navigation';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { Field } from '$lib/components/ui/Form';
	import MemberPicker from '$lib/components/ui/MemberPicker.svelte';
	import MoneyField from '$lib/components/ui/Form/MoneyField.svelte';
	import LocationField from '$lib/components/inventory/LocationField.svelte';
	import IntakeLines from './IntakeLines.svelte';
	import { getIntakePage, recordIntake } from '$lib/remote/inventory.remote';
	import { page } from '$app/state';
	import { acquisitionKinds, acquisitionKindLabels, clubToday } from '$lib/config';
	import { toast } from 'svelte-sonner';
	import { formatDate } from '$lib/utils/format';

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
	title={orderId ? 'Receive an order' : 'Intake'}
	subtitle="Inventory"
	backHref={orderId ? `/staff/inventory/orders/${orderId}` : '/staff/inventory'}
/>

<PageContent width="3xl">
	{#if data.order}
		<Alert type="info" class="mb-4">
			Receiving against {data.order.supplierName ?? 'an order'}. Partial deliveries are normal —
			record what actually turned up and the order stays open for the rest.
		</Alert>
	{:else}
		<Alert type="info" class="mb-4">
			One trip, one receipt, however many things came off it. Everything here lands on a single
			acquisition, so the provenance stays together.
		</Alert>
	{/if}

	{#if data.pledges.length > 0}
		<!-- Who said they would bring what. Linking the gear request, or naming
		     the donor on a donation that includes the item, closes the pledge. -->
		<InfoCard title="Promised by donors" class="mb-6">
			<ul class="flex flex-col gap-2">
				{#each data.pledges as p (p.id)}
					<li class="flex flex-wrap justify-between gap-2">
						<span><strong>{p.entryName}</strong> — {p.donorName}</span>
						<span class="text-subtle">until {formatDate(p.expiresAt)}</span>
					</li>
				{/each}
			</ul>
		</InfoCard>
	{/if}

	<Form
		remote={recordIntake}
		onsuccess={(result) => {
			if (!result) return;
			toast.success(`${result.unitCount || result.lineCount} recorded`);
			goto(`/staff/inventory/acquisitions/${result.acquisitionId}`);
		}}
	>
		{#if orderId}
			<!-- What links the acquisition this writes back to the promise it
			     fulfils, and what bumps the order's received quantities. -->
			<input {...fields.purchaseOrderId.as('hidden', orderId)} />
		{/if}
		<div class="space-y-6">
			<InfoCard title="The trip">
				<div class="grid gap-3 md:grid-cols-2">
					<Field
						field={fields.kind}
						type="select"
						label="How it arrived"
						bind:value={kind}
						options={acquisitionKinds.map((k) => ({ value: k, label: acquisitionKindLabels[k] }))}
					/>
					<Field
						field={fields.occurredAt}
						type="date"
						label="When it arrived"
						value={clubToday()}
						description={kind === 'opening_balance'
							? 'A guess is fine — nothing counts an opening balance as spending.'
							: undefined}
					/>
				</div>

				{#if kind !== 'opening_balance'}
					<Field
						field={fields.sourceName}
						type="text"
						label={kind === 'purchase' ? 'Supplier' : 'Donor / grantor'}
					/>
				{/if}
				<Field field={fields.reference} type="text" label="Reference / receipt no." />

				{#if data.plannedGear.length > 0}
					<Field
						field={fields.suggestionId}
						type="select"
						label="Fulfils a gear request"
						bind:value={suggestionId}
						placeholder="Nothing in particular"
						options={data.plannedGear.map((g) => ({
							value: g.id,
							label: `${g.title} (${g.voteCount} ${g.voteCount === 1 ? 'vote' : 'votes'})`
						}))}
						description="Marks the request Done and tells whoever asked for it that it arrived."
					/>
				{/if}

				<MoneyField
					field={fields.totalCents}
					label="Receipt total"
					description="What the paperwork says. Enough on its own — the lines below can wait for someone who can read the picture."
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
						label="Donated by"
					/>
				{/if}

				{#if kind === 'purchase'}
					<MemberPicker
						field={fields.paidByUserId}
						bind:value={paidByUserId}
						bind:name={paidByName}
						label="Paid by, and owed it back (leave blank if the collective paid)"
					/>
				{/if}

				<LocationField field={fields.locationId} label="Where it is going" />
				<Field field={fields.notes} type="textarea" label="Notes" />

				{#if isGift}
					<Alert type="warning" class="mt-3">
						A gift owes a fair-value basis and an intended use for the ASU 2020-07 disclosure.
						Record the arrival here, then add them on the acquisition page it opens.
					</Alert>
				{/if}
			</InfoCard>

			<InfoCard title="What arrived">
				<IntakeLines {items} bind:lines />
				{#if lines.length === 0}
					<p class="mt-2 text-subtle">
						Optional. Record the total and the receipt now; whoever itemises it later adds the lines
						from the image.
					</p>
				{/if}
			</InfoCard>

			<div>
				<SubmitButton label="Record this arrival" />
			</div>
		</div>
	</Form>
</PageContent>
