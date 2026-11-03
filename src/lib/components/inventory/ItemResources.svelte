<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import { FileUpload, Select } from '#lib/components/ui/Form/index.js';
	import {
		getItemResources,
		linkItemArticle,
		unlinkItemArticle
	} from '#lib/remote/inventory.remote.js';
	import { IconFileText, IconBook, IconTrash, IconUpload } from '@tabler/icons-svelte';
	import { toast } from 'svelte-sonner';

	/**
	 * Documentation for a catalog entry: uploaded manuals, and how-to articles
	 * linked from the help centre.
	 *
	 * Tutorials are `help_article` rows rather than prose of this module's own —
	 * they already have publish state, a minimum role and a sync path. This only
	 * records which belong to which item.
	 */
	let { itemId }: { itemId: string } = $props();

	const data = $derived(await getItemResources(itemId));

	let chosenArticle = $state('');

	async function upload(file: File) {
		const body = new FormData();
		body.append('file', file);
		body.append('slot', 'manual');
		body.append('attachableId', itemId);

		const res = await fetch('/api/inventory/media', { method: 'POST', body });
		if (!res.ok) {
			const detail = (await res.json().catch(() => null)) as { message?: string } | null;
			throw new Error(detail?.message ?? 'Upload failed');
		}
		await getItemResources(itemId).refresh();
		toast.success(m.inventory_item_resources_toast());
	}
</script>

<InfoCard title={m.inventory_item_resources_title()}>
	{#if data.articles.length === 0 && data.manuals.length === 0}
		<EmptyState description={m.inventory_item_resources_description()} />
	{/if}

	{#if data.manuals.length > 0}
		<ul class="space-y-2">
			{#each data.manuals as manual (manual.attachmentId)}
				<li class="flex items-center gap-2">
					<IconFileText size={18} class="shrink-0 opacity-60" />
					<a class="grow link" href={manual.url ?? '#'} target="_blank" rel="noopener external">
						{manual.filename ?? m.inventory_item_resources_manual()}
					</a>
				</li>
			{/each}
		</ul>
	{/if}

	{#if data.articles.length > 0}
		<ul class="mt-3 space-y-2">
			{#each data.articles as article (article.linkId)}
				<li class="flex items-center gap-2">
					<IconBook size={18} class="shrink-0 opacity-60" />
					<span class="grow">
						{article.title}
						{#if !article.published}
							<!-- Drafts stay off the member-facing page; saying so here stops a
							     staffer wondering why it never appeared. -->
							<Badge variant="outline" size="xs"
								>{m.inventory_item_resources_draft_members_can_t_see()}</Badge
							>
						{/if}
					</span>
					<form
						{...unlinkItemArticle.enhance(async ({ submit }) => {
							await submit();
						})}
					>
						<input {...unlinkItemArticle.fields.itemId.as('hidden', itemId)} />
						<input {...unlinkItemArticle.fields.linkId.as('hidden', article.linkId)} />
						<Button
							type="submit"
							variant="ghost"
							size="xs"
							aria-label={m.inventory_item_resources_unlink({ title: article.title })}
						>
							<IconTrash size={16} />
						</Button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="mt-4 flex flex-wrap items-center gap-3">
		<FileUpload {upload} accept=".pdf,image/*" showPreview={false} variant="ghost">
			<IconUpload size={16} />
			{m.inventory_item_resources_add_manual()}
		</FileUpload>

		{#if data.linkable.length > 0}
			<form
				class="flex items-center gap-2"
				{...linkItemArticle.enhance(async ({ submit }) => {
					await submit();
					chosenArticle = '';
				})}
			>
				<input {...linkItemArticle.fields.itemId.as('hidden', itemId)} />
				<Select
					size="sm"
					aria-label={m.inventory_item_resources_help_article()}
					bind:value={chosenArticle}
					name="articleId"
				>
					<option value="">{m.inventory_item_resources_link_how()}</option>
					{#each data.linkable as article (article.id)}
						<option value={article.id}
							>{article.title}{article.published ? '' : m.inventory_item_resources_draft()}</option
						>
					{/each}
				</Select>
				<Button type="submit" variant="ghost" size="sm" disabled={!chosenArticle}
					>{m.inventory_item_resources_link()}</Button
				>
			</form>
		{/if}
	</div>
</InfoCard>
