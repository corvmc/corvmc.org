<script lang="ts">
	import QRCode from 'qrcode-svg';
	import type { Snippet } from 'svelte';
	import Card from './Card/Card.svelte';
	import CardBody from './Card/CardBody.svelte';
	import CardTitle from './Card/CardTitle.svelte';
	import ShareButton from './ShareButton.svelte';

	/**
	 * An address you *have*, shown as something to hand out.
	 *
	 * Every band already had `{slug}.corvmc.org` and every member now has
	 * `corvmc.org/m/{n}`, but both were filed under settings — presented as a
	 * value to configure rather than a page to share. This card is the other
	 * framing: the address itself, large, with the two ways anyone actually
	 * passes one on (copy it, or point a phone at it).
	 *
	 * The QR is rendered with `qrcode-svg`, the same dependency the ticket modal
	 * uses, so no scanner library and no image request is involved.
	 */
	let {
		url,
		title = 'Your address',
		qrLabel = 'QR code for this address',
		children
	}: {
		/** The absolute address, from `canonicalAddress`. */
		url: string;
		title?: string;
		/** Accessible name for the QR image. */
		qrLabel?: string;
		/** A line of context under the address. */
		children?: Snippet;
	} = $props();

	// The scheme is noise on something meant to be read aloud or copied off a
	// screen; the QR and the clipboard both still carry the full URL.
	const display = $derived(url.replace(/^https?:\/\//, '').replace(/\/$/, ''));

	const qrSvg = $derived(
		new QRCode({ content: url, width: 112, height: 112, padding: 0, ecl: 'M', join: true }).svg()
	);
</script>

<Card>
	<CardBody>
		<CardTitle>{title}</CardTitle>
		<div class="flex items-center gap-4">
			<div class="min-w-0 flex-1">
				<p class="address-card__url" title={url}>{display}</p>
				{#if children}
					<p class="mt-1 text-muted text-sm">{@render children()}</p>
				{/if}
				<div class="mt-2">
					<ShareButton
						{url}
						label="Copy address"
						title="Copy this address"
						class="btn gap-2 btn-outline btn-sm"
					/>
				</div>
			</div>
			<div class="shrink-0 rounded-lg bg-white p-2" role="img" aria-label={qrLabel}>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- QR svg built here from `url` -->
				{@html qrSvg}
			</div>
		</div>
	</CardBody>
</Card>

<style>
	.address-card__url {
		margin: 0;
		font-weight: 700;
		font-size: 18px;
		line-height: 1.2;
		overflow-wrap: anywhere;
		color: var(--color-secondary);
	}
</style>
