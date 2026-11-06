<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import { EntityChip, EntityIdentity } from '#lib/components/ui/entity/index.js';
	import Form from '#lib/components/ui/Form/index.js';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { toast } from 'svelte-sonner';
	import { formatDollars } from '#lib/utils/format.js';
	import {
		cancelBandReservation,
		getBandReservationDetail
	} from '#lib/remote/reservations.remote.js';
	import { resolve } from '$app/paths';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('slug', 'id');

	// Declared above the awaited query: a declaration after a top-level await is
	// async-gated, which would compile every `fields.X.as()` into an async derived.
	const { fields: cancelFields } = cancelBandReservation;

	const slug = $derived(params.slug);
	// One query for the page. The band comes from the layout context above, so
	// nothing here fans a second remote call out of a child component.
	const res = $derived(await getBandReservationDetail({ slug, reservationId: params.id }));

	const cancel = $derived(cancelBandReservation.for(res.id));
	const durationLabel = $derived(
		m.band_slug_reservations_id_hours({ durationHours: res.durationHours })
	);
	// `paidAt` set ⇒ paid; null with `cashDueCents > 0` ⇒ cash owed; null with 0
	// ⇒ comped or fully credit-settled. See the schema comment on the column.
	const cashDue = $derived(res.cashDueCents ?? 0);
</script>

<PageHeader width="md" title={m.band_slug_reservations_id_session()} />
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
			<Fact label={m.band_slug_reservations_id_booked_by()}><EntityChip ref={res.bookedBy} /></Fact>
		{/if}
		{#if res.status === 'cancelled'}
			<Fact label={m.band_slug_reservations_id_cancelled()} wrap
				>{res.cancellationReason ?? m.band_slug_reservations_id_no_reason_was_recorded()}</Fact
			>
		{/if}
		{#if res.notes}
			<Fact label={m.band_notes()} wrap>{res.notes}</Fact>
		{/if}
		<Fact label={m.band_slug_reservations_id_rate()}
			>{m.band_slug_reservations_id_hour({
				formatDollars: formatDollars(res.hourlyRateCents),
				durationLabel
			})}</Fact
		>
		{#if res.creditsUsed}
			<Fact label={m.band_slug_reservations_id_free_hours_applied()}>{res.creditsUsed}</Fact>
		{/if}
		<Fact label={m.band_slug_reservations_id_total()} class="font-medium"
			>${formatDollars(res.totalCents)}</Fact
		>
	</DefinitionList>

	<!-- Where the money stands, in a sentence. A three-row grid and one line of
	     prose is not a section; it was an `InfoCard` titled "Payment" around a
	     hand-written `<dl>` (#1077). -->
	<p>
		{#if res.refundedAt}
			{m.band_slug_reservations_id_refunded()}
		{:else if res.paidAt}
			{m.band_slug_reservations_id_paid_full()}
		{:else if res.cashDueCents === 0}
			{m.band_slug_reservations_id_settled_nothing_owed_at_door()}
		{:else if cashDue > 0}
			<span class="font-medium"
				>{m.band_slug_reservations_id_due_at_door({ formatDollars: formatDollars(cashDue) })}</span
			>
		{:else}
			{m.band_slug_reservations_id_not_yet_paid()}
		{/if}
	</p>

	{#if res.canPay}
		<!-- The checkout takes this row: it authorizes on `createdByUserId`, and a
		     band booking appears in its booker's own list. Only the booker saw
		     what was owed and no way to settle it (#1077). -->
		<Button href="/member/reservations/{res.id}/pay" variant="primary" class="w-full">
			{m.band_slug_reservations_id_pay_session()}
		</Button>
	{:else if !res.isBooker && !res.paidAt && !res.refundedAt}
		<!-- Whoever booked pays, from their own reservation page; the act sees
		     what it owes without being handed someone else's checkout. -->
		<p class="text-subtle">
			{m.band_slug_reservations_id_booked_session_can_settle({ title: res.bookedBy.title })}
		</p>
	{/if}

	{#if res.status === 'confirmed'}
		<!-- A card only when there is a code to frame. Four of the five branches
		     were a single paragraph inside an `InfoCard` titled "Door Code",
		     which is a box around one sentence (#1061, #1077). -->
		{#if res.lockCode && res.lockSyncedAt}
			<InfoCard title={m.band_slug_reservations_id_door_code()}>
				<p class="font-mono text-4xl font-bold tracking-[0.3em]">{res.lockCode}</p>
				<p class="text-muted">
					{m.band_slug_reservations_id_enter_code_door_keypad_works()}
				</p>
			</InfoCard>
		{:else if res.fallbackCode}
			<!-- The session's own code has not reached the lock. The break-glass
			     code was synced long ago, so it opens the door even now, and it
			     is shown rather than asked for — see #780. -->
			<InfoCard title={m.band_slug_reservations_id_door_code()}>
				<p class="font-mono text-4xl font-bold tracking-[0.3em]">{res.fallbackCode}</p>
				<p class="text-muted">
					{m.band_slug_reservations_id_we_couldn_t_confirm_session()}
				</p>
			</InfoCard>
		{:else if res.inAccessWindow}
			<!-- The session is running and nothing here opens the door. Standing
			     outside is the failure mode, so this one is loud. -->
			<Alert type="error">
				<ParaglideMessage message={m.band_slug_reservations_id_session_s_code_hasn_t} inputs={{}}
					>{#snippet a({ children })}<a class="link" href={resolve('contact')}
							>{@render children?.()}</a
						>{/snippet}</ParaglideMessage
				>
			</Alert>
		{:else if res.lockCode}
			<p class="text-muted">
				{m.band_slug_reservations_id_code_issued_but_door_hasn()}
			</p>
		{:else}
			<p class="text-muted">{m.band_slug_reservations_id_door_code_appears_here_day()}</p>
		{/if}
	{/if}

	{#if res.canCancel}
		<Form remote={cancel} onsuccess={() => toast.success(m.band_slug_reservations_id_toast())}>
			<input {...cancelFields.slug.as('hidden', slug)} />
			<input {...cancelFields.reservationId.as('hidden', res.id)} />
			<SubmitButton
				label={m.band_slug_reservations_id_cancel_session()}
				variant="error"
				outline
				class="w-full"
			/>
		</Form>
	{/if}
</PageContent>
