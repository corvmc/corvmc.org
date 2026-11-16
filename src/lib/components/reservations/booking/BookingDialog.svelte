<script lang="ts" module>
	/** Who a booking is for, with what decides its terms and its recurring option. */
	export type Booker =
		| { kind: 'user'; isSustaining: boolean }
		| { kind: 'group'; slug: string; name: string; hasSustainingMember: boolean }
		| { kind: 'instructor' };

	/** A booker's key in the For select. */
	export function bookerKey(b: Booker): string {
		return b.kind === 'group' ? `group:${b.slug}` : b.kind;
	}

	/**
	 * Me first, then each band, then Teaching. `initial` is a band slug; a band
	 * not on the list (a staff viewer) starts on Me, since its guard would refuse.
	 */
	export function bookersFor(opts: {
		isSustaining: boolean;
		bands: { slug: string; name: string; hasSustainingMember: boolean }[];
		isInstructor: boolean;
	}): Booker[] {
		return [
			{ kind: 'user', isSustaining: opts.isSustaining },
			...opts.bands.map((b) => ({ kind: 'group' as const, ...b })),
			...(opts.isInstructor ? [{ kind: 'instructor' as const }] : [])
		];
	}
</script>

<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { toast } from 'svelte-sonner';
	import { IconCalendarPlus } from '@tabler/icons-svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import * as Form from '#lib/components/ui/Form/index.js';
	import DateTimeStep from './DateTimeStep.svelte';
	import ConfirmStep from './ConfirmStep.svelte';
	import PaymentStep from './PaymentStep.svelte';
	import BookingConflict from './BookingConflict.svelte';
	import PaymentDue, { type FeeGate } from './PaymentDue.svelte';
	import {
		bookAndPayReservation,
		bookBandReservation,
		bookInstructorReservation
	} from '#lib/remote/reservations.remote.js';
	import { goToCheckout } from '#lib/utils/checkout-navigation.js';

	/**
	 * The one booking form. For picks the booker, and with it the remote: each
	 * keeps its own guard, terms and settlement. `Action` remounts the steps
	 * when the remote changes, so dates and times start over for the new terms.
	 */
	let {
		bookers,
		initial,
		needsPhone = false,
		feeGate,
		onbooked,
		...rest
	}: {
		bookers: Booker[];
		/** A band slug to open on, from that band's own page. */
		initial?: string;
		needsPhone?: boolean;
		/** The booking member's own outstanding fees (#2859), whoever the booking is for. */
		feeGate?: FeeGate;
		onbooked?: () => void;
		[key: string]: unknown;
	} = $props();

	// The page's band preselected once; the member's choice after that is theirs.
	// svelte-ignore state_referenced_locally
	let chosen = $state(
		bookers.some((b) => b.kind === 'group' && b.slug === initial) ? `group:${initial}` : 'user'
	);
	const booker = $derived(bookers.find((b) => bookerKey(b) === chosen) ?? bookers[0]);
	const remote = $derived(
		booker.kind === 'group'
			? bookBandReservation
			: booker.kind === 'instructor'
				? bookInstructorReservation
				: bookAndPayReservation
	);

	const options = $derived(
		bookers.map((b) => ({
			value: bookerKey(b),
			label:
				b.kind === 'group'
					? b.name
					: b.kind === 'instructor'
						? m.reservations_booking_booking_dialog_teaching_label()
						: m.reservations_booking_booking_dialog_me_label()
		}))
	);

	// Bumped when a slot conflict sends the wizard back to step 1, so the
	// Date/Time step reloads availability without the slot just taken.
	let reloadToken = $state(0);

	async function booked(result: unknown) {
		const r = result as { waitlisted?: boolean; redirectUrl?: string } | undefined;
		if (r?.redirectUrl) return goToCheckout(r.redirectUrl);
		if (r?.waitlisted) toast.info(m.reservations_booking_booking_dialog_waitlisted_toast());
		else if (booker.kind === 'instructor')
			toast.success(m.reservations_booking_booking_dialog_teaching_booked_toast());
		else toast.success(m.reservations_booking_booking_dialog_booked_toast());
		onbooked?.();
	}
</script>

{#if feeGate?.state === 'refuse'}
	<PaymentDue gate={feeGate} label={m.reservations_booking_booking_dialog_label()} {...rest}>
		{#snippet icon()}<IconCalendarPlus size={18} />{/snippet}
	</PaymentDue>
{:else}
	<Action
		action={remote}
		label={m.reservations_booking_booking_dialog_label()}
		modalTitle={m.reservations_booking_booking_dialog_title()}
		noFooter
		variant="primary"
		maxWidth="max-w-sm"
		onsuccess={booked}
		{...rest}
	>
		{#snippet icon()}<IconCalendarPlus size={18} />{/snippet}
		{#snippet lead()}
			{#if bookers.length > 1}
				<Form.Field
					id="booking-for"
					type="select"
					label={m.reservations_booking_booking_dialog_for_label()}
					bind:value={chosen}
					{options}
				/>
			{/if}
		{/snippet}
		{#snippet form()}
			{#if booker.kind === 'group'}
				<input {...bookBandReservation.fields.slug.as('hidden', booker.slug)} />
				<DateTimeStep isSustaining={booker.hasSustainingMember} {needsPhone} bookerType="group" />
				<ConfirmStep band />
				<PaymentStep
					fields={{ coverFees: bookBandReservation.fields.coverFees }}
					submit={bookBandReservation.fields.payNow.as('submit', 'on')}
				/>
			{:else if booker.kind === 'instructor'}
				<!-- Teaching has no sustaining gate, so the recurring option is always
				     offered. Pay ahead is optional; unpaid teaching gets no door code. -->
				<DateTimeStep isSustaining {needsPhone} bookerType="instructor" />
				<ConfirmStep bookerType="instructor" />
				<PaymentStep
					fields={{ coverFees: bookInstructorReservation.fields.coverFees }}
					submit={bookInstructorReservation.fields.payNow.as('submit', 'on')}
				/>
			{:else}
				<DateTimeStep isSustaining={booker.isSustaining} {needsPhone} {reloadToken} />
				<ConfirmStep submitLabel={m.reservations_booking_booking_dialog_submit_label()} />
				<PaymentStep fields={{ coverFees: bookAndPayReservation.fields.coverFees }} />
				<BookingConflict result={bookAndPayReservation.result} onconflict={() => reloadToken++} />
			{/if}
		{/snippet}
	</Action>
{/if}
