<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	import { IconFile, IconTrash, IconUpload } from '@tabler/icons-svelte';
	import { toast } from 'svelte-sonner';

	/**
	 * The other way in: a band that already has a rider PDF it hands to every
	 * venue keeps handing over that.
	 *
	 * None of this is new machinery. The `rider` and `stage_plot` slots on
	 * `media_attachment` have existed since the media layer shipped, and
	 * `/api/bands/[id]/media` has always accepted both — including PDFs, which
	 * the page editor's own stage-plot input forgot to say it accepted. What was
	 * missing is that the only UI reaching the endpoint sat inside the
	 * premium-gated page editor, so a free band had no way to use a feature it
	 * was already entitled to.
	 *
	 * Uploading and filling in the structured rider are not alternatives the band
	 * has to choose between: a hand-drawn stage plot beside a typed input list is
	 * a perfectly good answer, and until the plot builder ships it is the only
	 * one.
	 */
	let {
		bandId,
		uploads,
		canManage,
		onchanged
	}: {
		bandId: string;
		uploads: {
			attachmentId: string;
			slot: string;
			/** Null when R2 has no public URL configured — dev, mostly. */
			url: string | null;
			filename: string | null;
			contentType: string | null;
		}[];
		canManage: boolean;
		onchanged: () => void;
	} = $props();

	const SLOTS = [
		{
			slot: 'rider',
			type: 'rider',
			label: 'Tech rider',
			hint: 'A PDF or image of the rider you already send venues.'
		},
		{
			slot: 'stage_plot',
			type: 'stage_plot',
			label: 'Stage plot',
			// The server has always taken a PDF here; only the old input said otherwise.
			hint: 'A drawing of where everything stands. PDF or image.'
		}
	] as const;

	let busy = $state<string | null>(null);

	const filesFor = (slot: string) => uploads.filter((u) => u.slot === slot);

	async function upload(type: string, file: File) {
		busy = type;
		try {
			const body = new FormData();
			body.set('type', type);
			body.append('file', file);
			const res = await fetch(`/api/bands/${bandId}/media`, { method: 'POST', body });
			if (res.ok) {
				toast.success('Uploaded');
				onchanged();
			} else {
				const err = (await res.json().catch(() => ({}))) as { message?: string };
				toast.error(err.message || 'Upload failed');
			}
		} finally {
			busy = null;
		}
	}

	async function remove(attachmentId: string) {
		busy = attachmentId;
		try {
			const res = await fetch(`/api/bands/${bandId}/media?mediaId=${attachmentId}`, {
				method: 'DELETE'
			});
			if (res.ok) {
				toast.success('Removed');
				onchanged();
			} else {
				toast.error('Could not remove that file');
			}
		} finally {
			busy = null;
		}
	}
</script>

<div class="grid gap-4 md:grid-cols-2">
	{#each SLOTS as entry (entry.slot)}
		<div class="rounded-box border border-base-300 p-4">
			<div class="mb-1 text-sm font-medium">{entry.label}</div>
			<p class="mb-3 text-xs text-base-content/60">{entry.hint}</p>

			{#each filesFor(entry.slot) as file (file.attachmentId)}
				<div class="mb-2 flex items-center gap-2 rounded-box bg-base-200 px-3 py-2">
					<IconFile size={16} />
					{#if file.url}
						<a
							href={file.url}
							target="_blank"
							rel="external noopener"
							class="link truncate text-sm"
						>
							{file.filename ?? entry.label}
						</a>
					{:else}
						<span class="truncate text-sm">{file.filename ?? entry.label}</span>
					{/if}
					{#if canManage}
						<Button
							variant="ghost"
							size="sm"
							square
							class="ml-auto"
							aria-label="Remove {file.filename ?? entry.label}"
							disabled={busy === file.attachmentId}
							onclick={() => remove(file.attachmentId)}
						>
							<IconTrash size={14} />
						</Button>
					{/if}
				</div>
			{/each}

			{#if canManage}
				<label class="form-control">
					<span class="sr-only">Upload {entry.label}</span>
					<input
						type="file"
						class="file-input w-full file-input-sm"
						accept="image/*,.pdf"
						disabled={busy === entry.type}
						onchange={async (e) => {
							const file = e.currentTarget.files?.[0];
							const input = e.currentTarget;
							if (!file) return;
							await upload(entry.type, file);
							input.value = '';
						}}
					/>
				</label>
			{:else if filesFor(entry.slot).length === 0}
				<p class="text-xs text-base-content/50">
					<IconUpload size={14} class="inline" /> Nothing uploaded.
				</p>
			{/if}
		</div>
	{/each}
</div>
