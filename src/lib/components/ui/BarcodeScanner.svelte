<script lang="ts">
	import { browser } from '$app/environment';
	import Button from './Button.svelte';
	import { IconCamera, IconCameraOff } from '@tabler/icons-svelte';

	/**
	 * Read a barcode or QR code from the device camera.
	 *
	 * **An affordance, never the only path.** Everywhere this appears there is
	 * already a text field or a select that works without it: a USB barcode wedge
	 * types straight into them, and a member scanning a tag with their phone's own
	 * camera never comes through here at all — the QR encodes a real URL precisely
	 * so it resolves with no app. So every failure below degrades to "type it
	 * instead" rather than blocking the task.
	 *
	 * Domain-free by the folder's rule: it emits a decoded string and imports
	 * nothing from `$lib/remote` or `$lib/server`. Deciding what the string *means*
	 * is `parseScan` in `$lib/utils/scan`.
	 */
	let {
		onscan,
		label = 'Scan',
		class: className = ''
	}: {
		/** Called with each successful decode while the camera is open. */
		onscan: (value: string) => void;
		label?: string;
		class?: string;
	} = $props();

	let open = $state(false);
	let error = $state<string | null>(null);
	let video = $state<HTMLVideoElement | null>(null);

	let stream: MediaStream | null = null;
	let frame: number | null = null;

	/**
	 * The camera is only usable on a secure origin, and `mediaDevices` is simply
	 * absent otherwise — so this reads as "no camera" rather than as a permission
	 * the user could grant.
	 */
	const supported = $derived(
		browser && typeof navigator !== 'undefined' && !!navigator.mediaDevices
	);

	async function start() {
		error = null;
		open = true;

		try {
			// Imported here, not at the top: this is a wasm module, and a static
			// import would pull it into the SSR graph and the initial bundle for
			// every page that happens to mount a form.
			const { BarcodeDetector } = await import('barcode-detector/pure');

			stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode: 'environment' }
			});

			// The element only exists once `open` has rendered it.
			await Promise.resolve();
			if (!video) throw new Error('No preview to draw into');

			video.srcObject = stream;
			await video.play();

			const detector = new BarcodeDetector({
				// The two that matter: QR for our own tags, the retail linear
				// symbologies for whatever the box already carries.
				formats: ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128']
			});

			const tick = async () => {
				if (!open || !video) return;
				try {
					const found = await detector.detect(video);
					if (found.length > 0 && found[0].rawValue) {
						onscan(found[0].rawValue);
						stop();
						return;
					}
				} catch {
					// A frame that cannot be decoded is the normal case, not an error —
					// most frames have no barcode in them. Keep looking.
				}
				frame = requestAnimationFrame(() => void tick());
			};
			void tick();
		} catch (err) {
			// Permission refused, no camera, an insecure origin, or a wasm module
			// that would not load. All of them mean the same thing to the user.
			error =
				(err as Error)?.name === 'NotAllowedError'
					? 'Camera access was declined.'
					: 'Could not start the camera.';
			stop();
		}
	}

	function stop() {
		open = false;
		if (frame !== null) cancelAnimationFrame(frame);
		frame = null;
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
	}

	$effect(() => () => stop());
</script>

{#if supported}
	<div class={className}>
		{#if open}
			<video bind:this={video} class="w-full rounded bg-base-300" muted playsinline></video>
			<Button type="button" variant="ghost" size="sm" class="mt-2" onclick={stop}>
				<IconCameraOff size={16} />
				Stop
			</Button>
		{:else}
			<Button type="button" variant="ghost" size="sm" onclick={start}>
				<IconCamera size={16} />
				{label}
			</Button>
		{/if}

		{#if error}
			<!-- Says what to do instead, because the field beside this still works. -->
			<p class="mt-1 text-subtle">{error} Type it in instead.</p>
		{/if}
	</div>
{/if}
