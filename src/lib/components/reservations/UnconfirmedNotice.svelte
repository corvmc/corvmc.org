<script lang="ts">
	import { formatDateShort } from '$lib/utils/format';
	import {
		confirmWindowOpensAt,
		withinConfirmationWindow,
		UNCONFIRMED_RELEASE_NOTICE
	} from '$lib/config';

	/**
	 * What a member is told about a booking still waiting on them.
	 *
	 * One component rather than the sentence twice: the card and the detail page
	 * describe the same sweep, and the card used to carry only "Confirm from
	 * Sep 15", which names a date without naming what passes with it (#895).
	 */
	let {
		startsAt,
		release = true,
		class: className = ''
	}: {
		startsAt: Date;
		/** The release sentence; the card leaves it to the detail page (#2052). */
		release?: boolean;
		class?: string;
	} = $props();

	// Inside the window the surfaces that use this already offer Confirm, so the
	// date would be telling a member to wait for something they can do now.
	let pending = $derived(!withinConfirmationWindow(startsAt));
</script>

<div class={className}>
	{#if pending}
		<p>Confirmation opens {formatDateShort(confirmWindowOpensAt(startsAt))}.</p>
	{/if}
	{#if release}
		<p>{UNCONFIRMED_RELEASE_NOTICE}</p>
	{/if}
</div>
