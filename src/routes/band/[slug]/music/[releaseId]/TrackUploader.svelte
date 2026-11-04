<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import FileUpload from '#lib/components/ui/Form/FileUpload.svelte';
	import { IconUpload } from '@tabler/icons-svelte';
	import { AUDIO_MAX_UPLOAD_BYTES } from '#lib/config.js';
	import { toast } from 'svelte-sonner';

	let {
		bandId,
		releaseId,
		onuploaded
	}: { bandId: string; releaseId: string; onuploaded: () => void } = $props();

	let progressLabel = $state('');

	const maxLabel = m.band_slug_music_release_id_track_uploader_max_label({
		round: Math.round(AUDIO_MAX_UPLOAD_BYTES / 1024 / 1024)
	});

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

	async function upload(files: File[]) {
		try {
			const body = new FormData();
			body.set('releaseId', releaseId);

			// Durations first, and all of them, so a file the browser cannot decode
			// fails before anything has been uploaded rather than halfway through.
			for (const file of files) {
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
				result.tracks.length === 1
					? m.band_slug_music_release_id_track_uploader_track_added()
					: m.band_slug_music_release_id_track_uploader_tracks_added({
							length: result.tracks.length
						})
			);
			onuploaded();
		} finally {
			progressLabel = '';
		}
	}
</script>

<div class="space-y-2">
	<FileUpload
		uploadAll={upload}
		accept="audio/*,.mp3,.m4a,.flac,.wav,.ogg,.opus"
		showPreview={false}
		variant="primary"
		busyLabel={progressLabel || m.band_slug_music_release_id_track_uploader_busy_label()}
	>
		<IconUpload size={16} />
		{m.band_slug_music_release_id_track_uploader_add_tracks()}
	</FileUpload>
	<p class="text-subtle">
		{m.band_slug_music_release_id_track_uploader_mp3_m4a_flac_wav_o({ maxLabel })}
	</p>
</div>
