<script lang="ts">
	import DoorCheckIn from '$lib/components/reservations/DoorCheckIn.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import { EntityChip, EntityIdentity } from '$lib/components/ui/entity';
	import Form from '$lib/components/ui/Form';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import { toast } from 'svelte-sonner';
	import { formatDollars } from '$lib/utils/format';
	import { cancelBandReservation, getBandReservationDetail } from '$lib/remote/reservations.remote';
	import { page } from '$app/state';

	// Declared above the awaited query: a declaration after a top-level await is
	// async-gated, which would compile every `fields.X.as()` into an async derived.
	const { fields: cancelFields } = cancelBandReservation;

	const slug = $derived(page.params.slug!);
	// One query for the page. The band comes from the layout context above, so
	// nothing here fans a second remote call out of a child component.
	const res = $derived(await getBandReservationDetail({ slug, reservationId: page.params.id! }));

	const cancel = $derived(cancelBandReservation.for(res.id));
	const durationLabel = $derived(`${res.durationHours} hour${res.durationHours === 1 ? '' : 's'}`);
	// `paidAt` set ⇒ paid; null with `cashDueCents > 0` ⇒ cash owed; null with 0
	// ⇒ comped or fully credit-settled. See the schema comment on the column.
	const cashDue = $derived(res.cashDueCents ?? 0);
</script>

<PageHeader width="md" title="Session" />
<PageContent width="md">
	<!--
		The shape #1061 settled on the member's twin of this page: the ref the
		query already built, rendered once, over a `DefinitionList`. This was an
		`hgroup` of `formatDateLong` and `formatTimeRange` inside a `Card`, with
		`res.ref` unused (#1077).
	-->
	<EntityIdentity ref={res.ref} size="lg" status />

	<!-- No When/Time facts: `toReservationRef` builds the title out of exactly
	     those, so the identity above already reads them out. -->
	<DefinitionList>
		{#if res.bookedBy.id}
			<Fact label="Booked by"><EntityChip ref={res.bookedBy} /></Fact>
		{/if}
		{#if res.status === 'cancelled'}
			<Fact label="Cancelled" wrap>{res.cancellationReason ?? 'No reason was recorded.'}</Fact>
		{/if}
		{#if res.notes}
			<Fact label="Notes" wrap>{res.notes}</Fact>
		{/if}
		<Fact label="Rate">${formatDollars(res.hourlyRateCents)}/hour · {durationLabel}</Fact>
		{#if res.creditsUsed}
			<Fact label="Free hours applied">{res.creditsUsed}</Fact>
		{/if}
		<Fact label="Total" class="font-medium">${formatDollars(res.totalCents)}</Fact>
	</DefinitionList>

	<!-- Where the money stands, in a sentence. A three-row grid and one line of
	     prose is not a section; it was an `InfoCard` titled "Payment" around a
	     hand-written `<dl>` (#1077). -->
	<p>
		{#if res.refundedAt}
			Refunded.
		{:else if res.paidAt}
			Paid in full.
		{:else if res.cashDueCents === 0}
			Settled — nothing owed at the door.
		{:else if cashDue > 0}
			<span class="font-medium">${formatDollars(cashDue)} due at the door.</span>
		{:else}
			Not yet paid.
		{/if}
	</p>

	{#if res.canPay}
		<!-- The checkout takes this row: it authorizes on `createdByUserId`, and a
		     band booking appears in its booker's own list. Only the booker saw
		     what was owed and no way to settle it (#1077). -->
		<Button href="/member/reservations/{res.id}/pay" variant="primary" class="w-full">
			Pay for this session
		</Button>
	{:else if !res.isBooker && !res.paidAt && !res.refundedAt}
		<!-- Whoever booked pays, from their own reservation page; the act sees
		     what it owes without being handed someone else's checkout. -->
		<p class="text-subtle">{res.bookedBy.title} booked this session and can settle it.</p>
	{/if}

	{#if res.status === 'confirmed'}
		<DoorCheckIn now={res.inAccessWindow} />
	{/if}

	{#if res.canCancel}
		<Form remote={cancel} onsuccess={() => toast.success('Reservation cancelled')}>
			<input {...cancelFields.slug.as('hidden', slug)} />
			<input {...cancelFields.reservationId.as('hidden', res.id)} />
			<SubmitButton label="Cancel this session" variant="error" outline class="w-full" />
		</Form>
	{/if}
</PageContent>
