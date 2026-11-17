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
	import {
		cancelBandReservation,
		getBandReservationDetail
	} from '#lib/remote/reservations.remote.js';
	import { resolve } from '$app/paths';
	import { routeParams } from '#lib/route-params.svelte.js';
	import DoorCodeHeld from '#lib/components/reservations/booking/DoorCodeHeld.svelte';
	import ReservationCharges from '#lib/components/reservations/ReservationCharges.svelte';
	import ReservationPaymentState from '#lib/components/reservations/ReservationPaymentState.svelte';
	import DoorCode from '#lib/components/reservations/DoorCode.svelte';

	const params = routeParams('slug', 'id');

	// Declared above the awaited query: a declaration after a top-level await is
	// async-gated, which would compile every `fields.X.as()` into an async derived.
	const { fields: cancelFields } = cancelBandReservation;

	const slug = $derived(params.slug);
	// One query for the page. The band comes from the layout context above, so
	// nothing here fans a second remote call out of a child component.
	const res = $derived(await getBandReservationDetail({ slug, reservationId: params.id }));

	const cancel = $derived(cancelBandReservation.for(res.id));
</script>

<PageHeader width="md" title={m.band_slug_reservations_id_session_title()} />
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
			<Fact label={m.band_slug_reservations_id_booked_by_label()}
				><EntityChip ref={res.bookedBy} /></Fact
			>
		{/if}
		{#if res.status === 'cancelled'}
			<Fact label={m.band_slug_reservations_id_cancelled_label()} wrap
				>{res.cancellationReason ?? m.band_slug_reservations_id_no_reason_was_recorded_text()}</Fact
			>
		{/if}
		{#if res.notes}
			<Fact label={m.band_notes_label()} wrap>{res.notes}</Fact>
		{/if}
		<ReservationCharges
			hourlyRateCents={res.hourlyRateCents}
			durationHours={res.durationHours}
			totalCents={res.totalCents}
			creditsUsed={res.creditsUsed}
		/>
	</DefinitionList>

	<ReservationPaymentState
		track={res.track}
		trackDetail={res.trackDetail}
		cashDueCents={res.cashDueCents}
	/>

	{#if res.canPay}
		<!-- The band's own pay page, so checkout returns the payer here (#3131). -->
		<Button
			href={resolve('/band/[slug]/reservations/[id]/pay', { slug, id: res.id })}
			variant="primary"
			class="w-full"
		>
			{m.band_slug_reservations_id_pay_session_label()}
		</Button>
	{/if}

	{#if res.status === 'confirmed'}
		<!-- A card only when there is a code to frame. Four of the five branches
		     were a single paragraph inside an `InfoCard` titled "Door Code",
		     which is a box around one sentence (#1061, #1077). -->
		{#if res.codeWithheld}
			<DoorCodeHeld dueOn={res.paymentDueOn} bookerName={res.bookedBy.title} />
		{:else if res.lockCode && res.lockSyncedAt}
			<InfoCard title={m.band_slug_reservations_id_door_code_title()}>
				<DoorCode code={res.lockCode} startsAt={res.startsAt} endsAt={res.endsAt}>
					<p class="text-muted">
						{m.band_slug_reservations_id_enter_code_door_keypad_works_text()}
					</p>
				</DoorCode>
			</InfoCard>
		{:else if res.fallbackCode}
			<!-- The session's own code has not reached the lock. The break-glass
			     code was synced long ago, so it opens the door even now, and it
			     is shown rather than asked for — see #780. -->
			<InfoCard title={m.band_slug_reservations_id_door_code_title()}>
				<DoorCode
					code={res.fallbackCode}
					startsAt={res.startsAt}
					endsAt={res.endsAt}
					kind="fallback"
				>
					<p class="text-muted">
						{m.band_slug_reservations_id_we_couldn_t_confirm_session_text()}
					</p>
				</DoorCode>
			</InfoCard>
		{:else if res.inAccessWindow}
			<!-- The session is running and nothing here opens the door. Standing
			     outside is the failure mode, so this one is loud. -->
			<Alert type="error">
				<ParaglideMessage
					message={m.band_slug_reservations_id_session_s_code_hasn_t_body}
					inputs={{}}
					>{#snippet a({ children })}<a class="link" href={resolve('contact')}
							>{@render children?.()}</a
						>{/snippet}</ParaglideMessage
				>
			</Alert>
		{:else if res.lockCode}
			<p class="text-muted">
				{m.band_slug_reservations_id_code_issued_but_door_hasn_text()}
			</p>
		{:else}
			<p class="text-muted">{m.reservations_door_code_pending_text()}</p>
		{/if}
	{/if}

	{#if res.canCancel}
		<Form remote={cancel} onsuccess={() => toast.success(m.band_slug_reservations_id_toast())}>
			<input {...cancelFields.slug.as('hidden', slug)} />
			<input {...cancelFields.reservationId.as('hidden', res.id)} />
			<SubmitButton
				label={m.band_slug_reservations_id_cancel_session_label()}
				variant="error"
				outline
				class="w-full"
			/>
		</Form>
	{/if}
</PageContent>
