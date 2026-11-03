<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Button from '$lib/components/ui/Button.svelte';
	import FileUpload from '$lib/components/ui/Form/FileUpload.svelte';
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
	let activeTab = $state<'write' | 'preview'>('write');

	async function handleImageUpload(file: File) {
		if (!uploadImage) return;
		const url = await uploadImage(file);
		const insertion = `![${file.name}](${url})`;
		const pos = textarea.selectionStart;
		value = value.slice(0, pos) + insertion + value.slice(pos);
	}
</script>

<div class="overflow-hidden rounded-box border border-base-300">
	<div class="flex items-center gap-1 border-b border-base-300 bg-base-200/50 px-2 py-1">
		<Button
			type="button"
			variant="ghost"
			size="xs"
			class={activeTab === 'write' ? 'btn-active' : ''}
			onclick={() => (activeTab = 'write')}
		>
			{m.help_markdown_editor_write()}
		</Button>
		<Button
			type="button"
			variant="ghost"
			size="xs"
			class={activeTab === 'preview' ? 'btn-active' : ''}
			onclick={() => (activeTab = 'preview')}
		>
			{m.help_markdown_editor_preview()}
		</Button>
		<div class="flex-1"></div>
		{#if uploadImage}
			<FileUpload
				upload={handleImageUpload}
				accept="image/*"
				showPreview={false}
				variant="ghost"
				size="xs"
				square
				aria-label={m.help_markdown_editor_aria_label()}
			>
				<IconPhoto size={14} />
			</FileUpload>
		{/if}
	</div>

	{#if activeTab === 'write'}
		<textarea
			bind:this={textarea}
			bind:value
			class="min-h-64 w-full resize-y bg-base-100 p-3 font-mono text-sm focus:outline-none"
			placeholder={m.help_markdown_editor_placeholder()}></textarea>
	{:else}
		<div class="min-h-64 p-3">
			{#if value.trim()}
				<MarkdownPreview content={value} />
			{:else}
				<p class="text-sm italic opacity-50">{m.help_markdown_editor_nothing_preview()}</p>
			{/if}
		</div>
	{/if}
</div>
