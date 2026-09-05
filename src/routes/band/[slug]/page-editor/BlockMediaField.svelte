<script lang="ts">
	/**
	 * An upload, in the settings of the block that shows the file.
	 *
	 * The four uploads used to live in a Media card at the foot of the page, which
	 * meant setting a hero image was: open the hero's settings, read that the
	 * image comes from somewhere else, scroll past the whole page to a card, pick
	 * a file, scroll back. They now sit in the block whose content they are.
	 *
	 * The endpoint is unchanged — `POST /api/bands/{id}/media` with the request
	 * vocabulary its own mapping comment describes (`image` is the gallery slot).
	 */
	import { toast } from 'svelte-sonner';
	import FileUpload from '$lib/components/ui/Form/FileUpload.svelte';

	let {
		bandId,
		type,
		label,
		accept = 'image/*',
		src,
		previewClass = 'h-20 w-20',
		onuploaded
	}: {
		bandId: string;
		/** The endpoint's own vocabulary, not the media slot's. */
		type: 'image' | 'hero' | 'stage_plot' | 'rider';
		label: string;
		accept?: string;
		/** Existing image to show beside the picker, if there is one. */
		src?: string;
		previewClass?: string;
		/**
		 * The R2 key the endpoint recorded, and the public URL for it. The URL
		 * comes back with the key so the canvas can draw the new image before
		 * anything is saved.
		 */
		onuploaded: (key: string, url: string | null) => void;
	} = $props();

	async function upload(file: File): Promise<string> {
		const body = new FormData();
		body.set('type', type);
		body.append('file', file);

		const res = await fetch(`/api/bands/${bandId}/media`, { method: 'POST', body });
		if (!res.ok) {
			const err = (await res.json().catch(() => ({}))) as { message?: string };
			const message = err.message || 'Upload failed';
			toast.error(message);
			// Thrown as well as toasted: `FileUpload` shows the failure on the field
			// itself, and a toast alone leaves the picker looking like it worked.
			throw new Error(message);
		}

		const { media } = (await res.json()) as { media: Array<{ key: string; url: string | null }> };
		const key = media[0]?.key ?? '';
		toast.success('Uploaded');
		onuploaded(key, media[0]?.url ?? null);
		return key;
	}
</script>

<!-- A `div`, not a `label`: `FileUpload` puts the file input inside a `label`
     of its own, and nesting labels is both invalid and ambiguous to click. -->
<div class="form-control">
	<span class="label-text text-xs">{label}</span>
	<div class="mt-1">
		<FileUpload {upload} {accept} {src} {previewClass} emptyLabel="Upload" replaceLabel="Replace" />
	</div>
</div>
