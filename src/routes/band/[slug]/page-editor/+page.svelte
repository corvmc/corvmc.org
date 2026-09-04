<script lang="ts">
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import { toast } from 'svelte-sonner';
	import BandSiteRenderer from '$lib/components/band-site/BandSiteRenderer.svelte';
	import { blocksForPreview } from '$lib/components/band-site/block-editing';
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { env } from '$env/dynamic/public';
	import { bandSiteUrl } from '$lib/utils/band-site-url';
	import { getBandLayoutContext } from '../layout-context';
	import { getBandPageEditor, saveBandPageConfig } from '$lib/remote/band-page-editor.remote';
	import { BAND_THEMES, type Block } from '$lib/types/band-page';
	import themeSheet from '$lib/themes/band-site/index.css?raw';
	import { themeStarterCss } from '$lib/utils/theme-starter';
	import { page } from '$app/state';

	// The layout above already holds this; re-awaiting it here was a second remote
	// query in flight in this component. See `layout-context.ts`.
	const bandLayout = getBandLayoutContext();
	const layout = $derived(bandLayout.current);
	let pageData = $derived(await getBandPageEditor(page.params.slug!));
	const band = $derived(layout.band);

	// Gate: premium only
	const isPremium = $derived(band.tier === 'premium');
	const siteUrl = $derived(
		bandSiteUrl(
			band.slug,
			env.PUBLIC_SITE_URL,
			band.customDomainStatus === 'active' ? band.customDomain : null
		)
	);

	// Local state for editable fields — initialized from server data
	const initialConfig = $derived(pageData.config);
	let selectedTheme = $state(initialConfig?.theme ?? 'default');
	let customCss = $state(initialConfig?.customCss ?? '');
	let blocks = $state<Block[]>(structuredClone(initialConfig?.blocks ?? []));

	/** Which block has its settings open. One at a time. */
	let openId = $state<string | null>(null);

	/**
	 * What gets drawn. Image keys resolved, authored HTML sanitized — on a copy,
	 * so `blocks` stays exactly what the form posts back.
	 */
	const displayBlocks = $derived(blocksForPreview(blocks, pageData.imageUrls));

	const CSS_VARIABLES = [
		{ name: '--bs-bg', what: 'page background' },
		{ name: '--bs-text', what: 'body text' },
		{ name: '--bs-accent', what: 'links and highlights' },
		{ name: '--bs-surface', what: 'cards and panels' },
		{ name: '--bs-muted', what: 'secondary text' }
	];

	/**
	 * Copy the selected theme's rules into the band's own CSS.
	 *
	 * Confirms before replacing work: the whole feature is a starting point, and
	 * silently overwriting a page someone spent an evening on is the opposite of
	 * that.
	 */
	function startFromTheme() {
		const starter = themeStarterCss(themeSheet, selectedTheme);
		if (!starter) {
			toast.error('That theme has nothing to copy yet.');
			return;
		}
		if (
			customCss.trim() &&
			!confirm('Replace your custom CSS with this theme as a starting point?')
		) {
			return;
		}
		customCss = starter;
		toast.success('Copied — edit it below.');
	}

	/**
	 * The page arrives with every block already on it — `reconcileBlocks` in
	 * `$lib/utils/band-site-preset` sees to that — so this editor arranges a page
	 * rather than building one. There is no add and no delete: a block a band does
	 * not want is one they stop publishing.
	 */
	function toggleHidden(id: string) {
		const i = blocks.findIndex((b) => b.id === id);
		if (i === -1) return;
		blocks[i].hidden = !blocks[i].hidden;
	}

	/**
	 * Reorder by button. Drag-and-drop is the fast path, but this is the one that
	 * works with a keyboard, on a touch screen that is already scrolling, and when
	 * a block is taller than the viewport — so both ship.
	 */
	function moveBlock(id: string, direction: -1 | 1) {
		const i = blocks.findIndex((b) => b.id === id);
		const target = i + direction;
		if (i === -1 || target < 0 || target >= blocks.length) return;
		const next = [...blocks];
		[next[i], next[target]] = [next[target], next[i]];
		blocks = next;
	}

	function reorder(next: Block[]) {
		blocks = next;
	}

	function findBlock(id: string) {
		return blocks.find((b) => b.id === id);
	}

	// The four upload targets were four copies of the same twenty lines.
	const MEDIA_SLOTS = [
		{ type: 'image', label: 'Gallery images', accept: 'image/*', multiple: true },
		{ type: 'hero', label: 'Hero image', accept: 'image/*', multiple: false },
		{ type: 'stage_plot', label: 'Stage plot', accept: 'image/*', multiple: false },
		{ type: 'rider', label: 'Tech rider (PDF/image)', accept: 'image/*,.pdf', multiple: false }
	] as const;

	async function upload(e: Event & { currentTarget: HTMLInputElement }, slot: { type: string }) {
		const input = e.currentTarget;
		const files = input.files;
		if (!files?.length) return;

		const formData = new FormData();
		formData.set('type', slot.type);
		for (const file of files) formData.append('file', file);

		const res = await fetch(`/api/bands/${band.id}/media`, { method: 'POST', body: formData });
		if (res.ok) {
			toast.success(files.length > 1 ? `Uploaded ${files.length} images` : 'Uploaded');
			invalidateAll();
		} else {
			const err = (await res.json()) as { message?: string };
			toast.error(err.message || 'Upload failed');
		}
		input.value = '';
	}
</script>

<PageHeader title="Page Editor" subtitle={band.name}>
	{#if isPremium && pageData.config}
		<Badge variant="success">Premium</Badge>
	{/if}
</PageHeader>
<PageContent width="2xl">
	{#if !isPremium}
		<EmptyState>
			<p class="text-lg font-medium">Premium Feature</p>
			<p class="mt-2 opacity-70">
				The page editor is available with a premium subscription. Your act's page arrives already
				built — reorder its blocks, hide the ones you don't want, and make it yours with genre
				themes and custom CSS.
			</p>
			<Button href="../subscription" variant="primary" class="mt-4">Upgrade to Premium</Button>
		</EmptyState>
	{:else}
		<Form
			remote={saveBandPageConfig}
			successToast="Page config saved"
			onsuccess={() => invalidateAll()}
			class="space-y-6"
		>
			<input {...saveBandPageConfig.fields.slug.as('hidden', band.slug)} />
			<input {...saveBandPageConfig.fields.theme.as('hidden', selectedTheme)} />
			<input {...saveBandPageConfig.fields.customCss.as('hidden', customCss)} />
			<input {...saveBandPageConfig.fields.blocks.as('hidden', JSON.stringify(blocks))} />

			<!-- Theme selector -->
			<Card>
				<CardBody>
					<CardTitle size="lg" level={2}>Theme</CardTitle>
					<div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
						{#each BAND_THEMES as theme (theme)}
							<Button
								type="button"
								variant={selectedTheme === theme ? 'primary' : 'default'}
								outline={selectedTheme !== theme}
								size="sm"
								class="capitalize"
								onclick={() => {
									selectedTheme = theme;
								}}
							>
								{theme}
							</Button>
						{/each}
					</div>

					<!-- A theme is a starting point, not a skin. Copying its rules into
					     the band's own CSS is what makes it one: they can see what it
					     does and change any of it, rather than overriding rules they
					     have no way to read. -->
					<div class="mt-3 flex flex-wrap items-center gap-3">
						<Button type="button" variant="default" outline size="sm" onclick={startFromTheme}>
							Start from this theme
						</Button>
						<span class="text-muted text-xs">
							Copies the <span class="capitalize">{selectedTheme}</span> theme's rules into your own CSS
							below, so you can edit them.
						</span>
					</div>
				</CardBody>
			</Card>

			<!-- The page itself, with its own controls in it.
			     This replaced a list of block rows sitting above a read-only preview:
			     you changed a row and looked somewhere else to see what happened. The
			     controls render in the flow at each block's own width, and settings
			     expand downward — so nothing a band is trying to look at is ever
			     covered by the thing they are using to change it. -->
			<Card>
				<CardBody>
					<div class="flex flex-wrap items-center justify-between gap-2">
						<CardTitle size="lg" level={2}>Your page</CardTitle>
						<span class="text-muted text-xs">
							Drag a block by its handle, or use the arrows. Nothing is saved until you save.
						</span>
					</div>
					<div class="editor-frame mt-2">
						<!-- eslint-disable-next-line svelte/no-at-html-tags -- the admin's own draft CSS, scoped to the preview container and never persisted unsanitized -->
						{@html `<style>.band-site-preview { ${customCss} }</style>`}
						<div class="band-site-preview band-site-container theme-{selectedTheme}">
							<BandSiteRenderer
								band={pageData.band}
								config={{
									theme: selectedTheme,
									customCss: null,
									blocks,
									epk: pageData.config?.epk ?? null
								}}
								members={pageData.members}
								events={pageData.events}
								pastEvents={pageData.pastEvents}
								media={pageData.media}
								edit={{
									blocks,
									displayBlocks,
									slug: band.slug,
									openId,
									onToggleOpen: (id) => (openId = openId === id ? null : id),
									onMove: moveBlock,
									onReorder: reorder,
									onToggleHidden: toggleHidden
								}}
								{blockSettings}
							/>
						</div>
					</div>
				</CardBody>
			</Card>

			<!-- Custom CSS -->
			<Card>
				<CardBody>
					<CardTitle size="lg" level={2}>Custom CSS</CardTitle>
					<p class="text-muted">
						Everything you write is wrapped in <code>.band-site-container</code>, so a bare selector
						like <code>h1</code> only ever affects your page.
					</p>
					<!-- Nobody can guess these, and until they are written down the CSS
					     box is a place to change colours one hex code at a time. -->
					<dl class="mt-2 grid grid-cols-1 gap-x-6 text-muted text-xs sm:grid-cols-2">
						{#each CSS_VARIABLES as item (item.name)}
							<div class="flex gap-2 py-0.5">
								<dt><code>{item.name}</code></dt>
								<dd>{item.what}</dd>
							</div>
						{/each}
					</dl>
					<textarea
						class="textarea mt-2 w-full font-mono text-sm"
						rows="8"
						placeholder={`.band-site-container {\n  /* your styles here */\n}`}
						value={customCss}
						oninput={(e) => {
							customCss = e.currentTarget.value;
						}}></textarea>
					<p class="mt-1 text-xs opacity-40">
						Max 50KB. External stylesheets and scripts are stripped; images from your own media
						library are allowed.
					</p>
				</CardBody>
			</Card>

			<!-- Save -->
			<div class="flex items-center justify-between">
				<!-- The band's own subdomain, so this leaves the app: rel="external" is both the
				     correct annotation and what keeps it out of the router. -->
				<a href={siteUrl} target="_blank" rel="external noopener" class="link text-sm">
					View your page at {siteUrl.replace(/^https?:\/\//, '')} &rarr;
				</a>
				<Button variant="primary">Save Changes</Button>
			</div>
		</Form>

		<!-- Media upload section -->
		<Card class="mt-6">
			<CardBody>
				<CardTitle size="lg" level={2}>Media</CardTitle>
				<p class="text-muted">
					Upload images for your gallery, hero sections, and tech rider. Supported formats: JPEG,
					PNG, WebP, GIF. Max 10MB per file.
				</p>
				<div class="mt-4 grid grid-cols-2 gap-4">
					{#each MEDIA_SLOTS as slot (slot.type)}
						<div>
							<label class="form-control">
								<span class="label-text text-xs font-medium">{slot.label}</span>
								<input
									type="file"
									class="file-input mt-1 w-full file-input-sm"
									accept={slot.accept}
									multiple={slot.multiple}
									onchange={(e) => upload(e, slot)}
								/>
							</label>
						</div>
					{/each}
				</div>
			</CardBody>
		</Card>

		<!-- EPK Editor link -->
		<Card class="mt-6">
			<CardBody>
				<div class="flex items-center justify-between">
					<div>
						<CardTitle size="lg" level={2}>Electronic Press Kit</CardTitle>
						<p class="text-muted">
							Manage your EPK data — contacts, press quotes, achievements, and tech rider.
						</p>
					</div>
					<Button href={resolve(`/band/${band.slug}/press-kit`)} variant="default" size="sm" outline
						>Edit EPK</Button
					>
				</div>
			</CardBody>
		</Card>
	{/if}
</PageContent>

<!-- The per-block settings form. Rendered by `BandSiteRenderer` directly under
     the open block's control strip, in the flow. -->
{#snippet blockSettings(shown: Block)}
	{@const block = findBlock(shown.id) ?? shown}
	<div
		class="flex flex-wrap items-end gap-x-7 gap-y-4 border-b border-base-300 bg-base-200 px-4 py-4"
	>
		{#if block.type === 'hero'}
			<label class="form-control">
				<span class="label-text text-xs">Image key (R2 path or URL)</span>
				<input
					type="text"
					class="input w-full input-sm"
					value={block.imageKey}
					oninput={(e) => {
						block.imageKey = e.currentTarget.value;
					}}
				/>
			</label>
			<label class="form-control">
				<span class="label-text text-xs">Headline</span>
				<input
					type="text"
					class="input w-full input-sm"
					value={block.headline ?? ''}
					oninput={(e) => {
						block.headline = e.currentTarget.value || undefined;
					}}
				/>
			</label>
			<label class="form-control">
				<span class="label-text text-xs">Subtitle</span>
				<input
					type="text"
					class="input w-full input-sm"
					value={block.subtitle ?? ''}
					oninput={(e) => {
						block.subtitle = e.currentTarget.value || undefined;
					}}
				/>
			</label>
		{:else if block.type === 'bio'}
			<label class="form-control w-full">
				<span class="label-text text-xs">Content (HTML/Markdown)</span>
				<textarea
					class="textarea w-full text-sm"
					rows="5"
					value={block.content}
					oninput={(e) => {
						block.content = e.currentTarget.value;
					}}></textarea>
			</label>
		{:else if block.type === 'links'}
			<label class="form-control">
				<span class="label-text text-xs">Style</span>
				<Select
					size="sm"
					class="w-full"
					value={block.style}
					onchange={(e: Event) => {
						block.style = (e.currentTarget as HTMLSelectElement).value as
							'buttons' | 'icons' | 'list';
					}}
				>
					<option value="buttons">Buttons</option>
					<option value="icons">Icons</option>
					<option value="list">List</option>
				</Select>
			</label>
		{:else if block.type === 'members'}
			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					class="checkbox checkbox-sm"
					checked={block.showPositions}
					onchange={(e) => {
						block.showPositions = e.currentTarget.checked;
					}}
				/>
				<span class="text-sm">Show member positions</span>
			</label>
		{:else if block.type === 'events'}
			<label class="form-control">
				<span class="label-text text-xs">Max events to show</span>
				<input
					type="number"
					class="input w-24 input-sm"
					min="1"
					max="20"
					value={block.limit ?? 5}
					oninput={(e) => {
						block.limit = parseInt(e.currentTarget.value) || 5;
					}}
				/>
			</label>
			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					class="checkbox checkbox-sm"
					checked={block.showPast ?? false}
					onchange={(e) => {
						block.showPast = e.currentTarget.checked;
					}}
				/>
				<span class="text-sm">Also list past shows</span>
			</label>
		{:else if block.type === 'gallery'}
			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					class="checkbox checkbox-sm"
					checked={block.downloadable ?? false}
					onchange={(e) => {
						block.downloadable = e.currentTarget.checked;
					}}
				/>
				<span class="text-sm">Allow downloads (press-quality)</span>
			</label>
			<span class="text-muted text-xs">Gallery images come from the Media section below.</span>
		{:else if block.type === 'embed'}
			<label class="form-control">
				<span class="label-text text-xs">Platform</span>
				<input
					type="text"
					class="input w-full input-sm"
					placeholder="spotify, youtube, soundcloud"
					value={block.platform}
					oninput={(e) => {
						block.platform = e.currentTarget.value;
					}}
				/>
			</label>
			<label class="form-control">
				<span class="label-text text-xs">URL</span>
				<input
					type="url"
					class="input w-full input-sm"
					placeholder="https://open.spotify.com/track/..."
					value={block.url}
					oninput={(e) => {
						block.url = e.currentTarget.value;
					}}
				/>
			</label>
		{:else if block.type === 'spacer'}
			<label class="form-control">
				<span class="label-text text-xs">Height</span>
				<Select
					size="sm"
					class="w-full"
					value={block.height}
					onchange={(e: Event) => {
						block.height = (e.currentTarget as HTMLSelectElement).value as 'sm' | 'md' | 'lg';
					}}
				>
					<option value="sm">Small</option>
					<option value="md">Medium</option>
					<option value="lg">Large</option>
				</Select>
			</label>
		{:else if block.type === 'custom_html'}
			<label class="form-control w-full">
				<span class="label-text text-xs">HTML content (sanitized on save)</span>
				<textarea
					class="textarea w-full font-mono text-sm"
					rows="6"
					value={block.content}
					oninput={(e) => {
						block.content = e.currentTarget.value;
					}}></textarea>
			</label>
		{:else if block.type === 'contact'}
			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					class="checkbox checkbox-sm"
					checked={block.showForm ?? true}
					onchange={(e) => {
						block.showForm = e.currentTarget.checked;
					}}
				/>
				<span class="text-sm">
					Show contact form (messages are emailed to your booking contact)
				</span>
			</label>
		{:else if block.type === 'merch'}
			<div class="w-full space-y-2">
				{#each block.items as item, mi (mi)}
					<div class="flex items-start gap-2">
						<input
							type="text"
							class="input flex-1 input-sm"
							placeholder="Title"
							value={item.title}
							oninput={(e) => {
								item.title = e.currentTarget.value;
							}}
						/>
						<input
							type="url"
							class="input flex-1 input-sm"
							placeholder="URL"
							value={item.url}
							oninput={(e) => {
								item.url = e.currentTarget.value;
							}}
						/>
						<input
							type="text"
							class="input w-20 input-sm"
							placeholder="$25"
							value={item.price ?? ''}
							oninput={(e) => {
								item.price = e.currentTarget.value || undefined;
							}}
						/>
						<Button
							type="button"
							variant="ghost"
							size="xs"
							class="text-error"
							onclick={() => {
								block.items = block.items.filter((_, j) => j !== mi);
							}}>&times;</Button
						>
					</div>
				{/each}
				<Button
					type="button"
					variant="ghost"
					size="xs"
					onclick={() => {
						block.items = [...block.items, { title: '', url: '' }];
					}}>+ Add item</Button
				>
			</div>
		{/if}

		<!-- CSS class (all blocks) -->
		<label class="form-control">
			<span class="label-text text-xs">CSS class (optional)</span>
			<input
				type="text"
				class="input w-full input-sm"
				placeholder="custom-class"
				value={block.cssClass ?? ''}
				oninput={(e) => {
					// Every member of the Block union carries `cssClass`, but TypeScript
					// will not pick a member to write through on a union, so the
					// write is narrowed to just that property.
					(block as { cssClass?: string }).cssClass = e.currentTarget.value || undefined;
				}}
			/>
		</label>
	</div>
{/snippet}

<style>
	/* Bounded and scrollable: a band's page is taller than a card, and letting it
	   push the Save button off the screen defeats the point of having the
	   controls beside it. */
	.editor-frame {
		max-height: 42rem;
		overflow: auto;
		border: 1px solid var(--surface-border, color-mix(in oklch, currentColor 15%, transparent));
		border-radius: var(--radius-box, 8px);
		/* The themes paint their own background, so the frame must not assume the
		   app's — a dark theme on a light card would look like a bug. */
		background: #fff;
	}
</style>
