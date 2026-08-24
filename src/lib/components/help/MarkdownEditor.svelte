<script lang="ts">
	import Button from '$lib/components/shared/Button.svelte';
	import MarkdownPreview from './MarkdownPreview.svelte';
	import { IconPhoto } from '@tabler/icons-svelte';

	let {
		value = $bindable(''),
		uploadImage
	}: {
		value: string;
		uploadImage?: (file: File) => Promise<string>;
	} = $props();

	let textarea = $state<HTMLTextAreaElement>(undefined!);
	let fileInput = $state<HTMLInputElement>(undefined!);
	let activeTab = $state<'write' | 'preview'>('write');

	async function handleImageUpload() {
		if (!uploadImage || !fileInput.files?.length) return;
		const file = fileInput.files[0];
		const url = await uploadImage(file);
		const insertion = `![${file.name}](${url})`;
		const pos = textarea.selectionStart;
		value = value.slice(0, pos) + insertion + value.slice(pos);
		fileInput.value = '';
	}
</script>

<div class="border border-base-300 rounded-box overflow-hidden">
	<div class="flex items-center gap-1 border-b border-base-300 px-2 py-1 bg-base-200/50">
		<Button
			type="button"
			variant="ghost"
			size="xs"
			class={activeTab === 'write' ? 'btn-active' : ''}
			onclick={() => (activeTab = 'write')}
		>
			Write
		</Button>
		<Button
			type="button"
			variant="ghost"
			size="xs"
			class={activeTab === 'preview' ? 'btn-active' : ''}
			onclick={() => (activeTab = 'preview')}
		>
			Preview
		</Button>
		<div class="flex-1"></div>
		{#if uploadImage}
			<Button
				type="button"
				variant="ghost"
				size="xs"
				shape="square"
				title="Insert image"
				onclick={() => fileInput.click()}
			>
				<IconPhoto size={14} />
			</Button>
			<input
				type="file"
				accept="image/*"
				class="hidden"
				bind:this={fileInput}
				onchange={handleImageUpload}
			/>
		{/if}
	</div>

	{#if activeTab === 'write'}
		<textarea
			bind:this={textarea}
			bind:value
			class="w-full min-h-64 p-3 font-mono text-sm bg-base-100 resize-y focus:outline-none"
			placeholder="Write your article in Markdown..."
		></textarea>
	{:else}
		<div class="min-h-64 p-3">
			{#if value.trim()}
				<MarkdownPreview content={value} />
			{:else}
				<p class="text-sm opacity-50 italic">Nothing to preview</p>
			{/if}
		</div>
	{/if}
</div>
