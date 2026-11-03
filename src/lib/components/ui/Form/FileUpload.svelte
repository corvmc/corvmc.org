<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import type { Snippet } from 'svelte';
	import { IconPhoto } from '@tabler/icons-svelte';

	// Literal class names: Tailwind emits nothing for a computed one.
	const VARIANTS = { outline: 'btn-outline', ghost: 'btn-ghost', primary: 'btn-primary' };
	const SIZES = { xs: 'btn-xs', sm: 'btn-sm' };

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
		emptyLabel = m.ui_form_file_upload_empty_label(),
		replaceLabel = m.ui_form_file_upload_replace_label(),
		preview,
		showPreview = true,
		uploadAll,
		variant = 'outline',
		size = 'sm',
		square = false,
		busyLabel = m.ui_form_file_upload_busy_label(),
		'aria-label': ariaLabel,
		children
	}: {
		name?: string;
		/**
		 * Persist the file immediately and return its key. Used where the record
		 * already exists — a band's avatar POSTs to `/api/bands/[id]/avatar`.
		 */
		upload?: (file: File) => Promise<string | void>;
		/** Immediate mode for a multi-file pick: one call with every file. */
		uploadAll?: (files: File[]) => Promise<void>;
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
		/** Off for documents and audio, or where the caller renders the file itself. */
		showPreview?: boolean;
		variant?: keyof typeof VARIANTS;
		size?: keyof typeof SIZES;
		square?: boolean;
		busyLabel?: string;
		'aria-label'?: string;
		/** The picker button's content, in place of the empty/replace label. */
		children?: Snippet;
	} = $props();

	const deferred = $derived(!upload && !uploadAll && !!inputProps);

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
		const files = Array.from(input.files ?? []);
		const file = files[0];
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
			if (uploadAll) {
				await uploadAll(files);
			} else {
				const key = await upload!(file);
				if (typeof key === 'string') {
					value = key;
					hiddenInput?.dispatchEvent(new Event('input', { bubbles: true }));
				}
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
{#if !deferred && name}
	<input type="hidden" {name} bind:value bind:this={hiddenInput} />
{/if}

<div class="flex items-start gap-4" class:flex-col={orientation === 'col'}>
	{#if !showPreview}
		<!-- The caller shows the file, or there is nothing to show. -->
	{:else if preview}
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
			<span class="btn btn-disabled {VARIANTS[variant]} {SIZES[size]}" class:btn-square={square}>
				<span class="loading loading-sm loading-spinner"></span>
				{#if !square}{busyLabel}{/if}
			</span>
		{:else}
			<label
				class="btn {VARIANTS[variant]} {SIZES[size]}"
				class:btn-square={square}
				class:btn-disabled={disabled}
			>
				{#if children}
					{@render children()}
				{:else}
					{hasPreview ? replaceLabel : emptyLabel}
				{/if}
				<input
					bind:this={fileInput}
					type="file"
					{...deferred ? inputProps : {}}
					{accept}
					multiple={!!uploadAll}
					aria-label={ariaLabel}
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
		{:else if uploadStatus === 'success' && !isImage && name}
			<p class="text-sm text-success">{m.ui_upload_done()}</p>
		{:else if !deferred && selectedFile && !isImage && (name || uploadStatus === 'uploading')}
			<!-- Immediate mode only. Deferred mode names the file above, beside the
			     picker, and without this guard both branches match a non-image
			     deferred pick and it is listed twice — invisible while every
			     deferred caller uploaded images, and plain to see on a PDF. -->
			<p class="text-muted">{selectedFile.name} ({formatSize(selectedFile.size)})</p>
		{/if}
	</div>
</div>
