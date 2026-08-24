<script lang="ts">
	import type { Snippet } from 'svelte';
	import { IconPhoto } from '@tabler/icons-svelte';

	let {
		name,
		upload,
		inputProps,
		accept,
		value = $bindable(''),
		src,
		disabled = false,
		orientation = 'row',
		previewClass = 'h-24 w-24',
		emptyLabel = 'Add image',
		replaceLabel = 'Replace',
		preview
	}: {
		name?: string;
		/**
		 * Persist the file immediately and return its key. Used where the record
		 * already exists — a band's avatar POSTs to `/api/bands/[id]/avatar`.
		 */
		upload?: (file: File) => Promise<string>;
		/**
		 * Deferred mode: attributes for a real `<input type="file">` that submits
		 * with the form, typically `remoteForm.fields.x.as('file')`. Used where
		 * there is nothing to attach an upload to yet — an event's poster is
		 * picked before the event exists, and uploading it up front is how you
		 * end up with orphaned posters when the create fails. Give one of
		 * `upload` or `inputProps`, not both.
		 */
		inputProps?: Record<string, unknown>;
		accept?: string;
		value?: string;
		src?: string;
		disabled?: boolean;
		/** row = preview beside the picker; col = preview stacked over the picker */
		orientation?: 'row' | 'col';
		/** Preview box size. Square suits an avatar; a poster wants portrait. */
		previewClass?: string;
		emptyLabel?: string;
		replaceLabel?: string;
		preview?: Snippet<[{ file: File | null; src: string | null }]>;
	} = $props();

	const deferred = $derived(!upload && !!inputProps);

	let uploadStatus = $state<'idle' | 'uploading' | 'success' | 'error'>('idle');
	let uploadError = $state('');
	let selectedFile = $state<File | null>(null);
	let previewUrl = $state<string | null>(null);
	let hiddenInput = $state<HTMLInputElement | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);

	// A form carrying a real file input must be multipart, and SvelteKit *throws*
	// rather than warns when it isn't — which aborts the submit before any
	// request is made, so the symptom is a Save that silently does nothing. Set
	// it here rather than asking every caller to remember: the only way our
	// components put a file input in a form is deferred mode, so this is exactly
	// the set of forms that need it.
	$effect(() => {
		if (deferred && fileInput?.form) {
			fileInput.form.enctype = 'multipart/form-data';
		}
	});

	let isImage = $derived(selectedFile?.type.startsWith('image/') ?? false);
	let hasPreview = $derived(!!previewUrl || !!src);

	$effect(() => {
		if (selectedFile && selectedFile.type.startsWith('image/')) {
			const url = URL.createObjectURL(selectedFile);
			previewUrl = url;
			return () => URL.revokeObjectURL(url);
		} else {
			previewUrl = null;
		}
	});

	async function handleFileChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		selectedFile = file;

		// Deferred mode: the file rides the form on this very input, so leave its
		// value alone — clearing it here would discard the pick — and there is
		// nothing to await.
		if (deferred) {
			input.dispatchEvent(new Event('input', { bubbles: true }));
			return;
		}

		uploadStatus = 'uploading';
		uploadError = '';

		try {
			const key = await upload!(file);
			value = key;
			if (hiddenInput) {
				hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
			}
			uploadStatus = 'success';
		} catch (err) {
			uploadError = err instanceof Error ? err.message : 'Upload failed';
			uploadStatus = 'error';
		}

		input.value = '';
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		return `${(bytes / 1024).toFixed(0)} KB`;
	}
</script>

<!-- Deferred mode posts through the file input itself, so a same-named hidden
     input here would submit alongside it and clobber the file. -->
{#if !deferred}
	<input type="hidden" {name} bind:value bind:this={hiddenInput} />
{/if}

<div class="flex items-start gap-4" class:flex-col={orientation === 'col'}>
	{#if preview}
		{@render preview({ file: selectedFile, src: previewUrl ?? src ?? null })}
	{:else if previewUrl || src}
		<img src={previewUrl ?? src} alt="" class="{previewClass} rounded object-cover" />
	{:else}
		<!-- A placeholder rather than nothing: an empty file input reads as a
		     setting you can skip, which is how posters went unnoticed. -->
		<div
			class="{previewClass} grid place-items-center rounded border border-dashed border-base-300 bg-base-200"
		>
			<IconPhoto class="size-8 opacity-30" />
		</div>
	{/if}

	<div class="flex flex-col gap-1">
		{#if uploadStatus === 'uploading'}
			<span class="btn btn-sm btn-outline btn-disabled">
				<span class="loading loading-spinner loading-sm"></span>
				Uploading…
			</span>
		{:else}
			<label class="btn btn-sm btn-outline" class:btn-disabled={disabled}>
				{hasPreview ? replaceLabel : emptyLabel}
				<input
					bind:this={fileInput}
					type="file"
					{...deferred ? inputProps : {}}
					{accept}
					onchange={handleFileChange}
					{disabled}
					class="hidden"
				/>
			</label>
			{#if deferred && selectedFile}
				<p class="text-subtle">{selectedFile.name} ({formatSize(selectedFile.size)})</p>
			{/if}
		{/if}

		{#if uploadStatus === 'error'}
			<p class="text-sm text-error">{uploadError}</p>
		{:else if uploadStatus === 'success' && !isImage}
			<p class="text-sm text-success">Uploaded</p>
		{:else if selectedFile && !isImage}
			<p class="text-muted">{selectedFile.name} ({formatSize(selectedFile.size)})</p>
		{/if}
	</div>
</div>
