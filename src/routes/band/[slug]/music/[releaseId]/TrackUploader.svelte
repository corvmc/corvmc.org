<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { IconUpload } from '@tabler/icons-svelte';
	import { AUDIO_MAX_UPLOAD_BYTES } from '$lib/config';
	import { toast } from 'svelte-sonner';

	let {
		bandId,
		releaseId,
		onuploaded
	}: { bandId: string; releaseId: string; onuploaded: () => void } = $props();

	let input = $state<HTMLInputElement | null>(null);
	let busy = $state(false);
	let progressLabel = $state('');
	let failure = $state<string | null>(null);

	const maxLabel = `${Math.round(AUDIO_MAX_UPLOAD_BYTES / 1024 / 1024)}MB`;

	/**
	 * Read a file's length in the browser, before uploading it.
	 *
	 * The server needs this number — the radio builds a wall-clock timetable out
	 * of it — and the browser is the only party here that can answer cheaply. The
	 * alternative is parsing container headers in a Worker, which is a large
	 * dependency for one number and still cannot answer for a VBR MP3 without
	 * reading the whole file. The server clamps what comes back rather than
	 * trusting it; see the endpoint.
	 *
	 * The object URL is revoked on both paths — a 50MB blob held per upload is
	 * how a band adding a whole album runs the tab out of memory.
	 */
	function readDuration(file: File): Promise<number> {
		return new Promise((resolve, reject) => {
			const url = URL.createObjectURL(file);
			const probe = new Audio();
			const done = (fn: () => void) => {
				URL.revokeObjectURL(url);
				fn();
			};
			probe.preload = 'metadata';
			probe.onloadedmetadata = () =>
				done(() =>
					Number.isFinite(probe.duration) && probe.duration > 0
						? resolve(probe.duration)
						: reject(new Error(`Could not read the length of "${file.name}".`))
				);
			probe.onerror = () =>
				done(() => reject(new Error(`"${file.name}" could not be read as audio in this browser.`)));
			probe.src = url;
		});
	}

	async function upload(files: FileList) {
		busy = true;
		failure = null;
		try {
			const body = new FormData();
			body.set('releaseId', releaseId);

			// Durations first, and all of them, so a file the browser cannot decode
			// fails before anything has been uploaded rather than halfway through.
			for (const file of Array.from(files)) {
				progressLabel = `Reading ${file.name}…`;
				body.append('duration[]', String(await readDuration(file)));
				body.append('file[]', file);
			}

			progressLabel = files.length === 1 ? 'Uploading…' : `Uploading ${files.length} tracks…`;
			const response = await fetch(`/api/bands/${bandId}/audio`, { method: 'POST', body });

			if (!response.ok) {
				// The endpoint's 4xx bodies carry a `message` written for the band —
				// the wrong file type, the size limit, the missing duration. Showing
				// the status code instead is how a fixable mistake reads as a bug.
				const payload = (await response.json().catch(() => null)) as { message?: string } | null;
				throw new Error(payload?.message ?? `Upload failed (${response.status})`);
			}

			const result = (await response.json()) as { tracks: unknown[] };
			toast.success(
				result.tracks.length === 1 ? 'Track added' : `${result.tracks.length} tracks added`
			);
			onuploaded();
		} catch (err) {
			failure = err instanceof Error ? err.message : 'Upload failed';
		} finally {
			busy = false;
			progressLabel = '';
			// Clear it, or picking the same file again fires no change event.
			if (input) input.value = '';
		}
	}
</script>

<!--
	A bare <input type="file"> rather than a FormField: this posts multipart to a
	REST endpoint, not a remote form, so there is no field to bind and nothing for
	the Form context to track. It is hidden behind the button because the native
	control cannot be styled and reads "No file chosen" forever.
-->
<input
	bind:this={input}
	type="file"
	accept="audio/*,.mp3,.m4a,.flac,.wav,.ogg,.opus"
	multiple
	class="hidden"
	onchange={(e) => {
		const files = e.currentTarget.files;
		if (files && files.length > 0) void upload(files);
	}}
/>

<div class="space-y-2">
	<Button variant="primary" size="sm" disabled={busy} onclick={() => input?.click()}>
		<IconUpload size={16} />
		{busy ? progressLabel || 'Working…' : 'Add tracks'}
	</Button>
	<p class="text-subtle">MP3, M4A, FLAC, WAV, OGG or Opus, up to {maxLabel} each.</p>

	{#if failure}
		<Alert type="error">{failure}</Alert>
	{/if}
</div>
