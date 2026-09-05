<script lang="ts">
	// The canvas *is* the public page, so it needs the same stylesheet the public
	// layout loads. Without this the `.theme-x` class resolved to nothing here and
	// the theme picker changed the preview not at all — which was survivable while
	// the theme was a swatch, and is not now that the pane's whole claim is that
	// it shows what applies. The rules only ever match inside a `.theme-x`
	// container, so importing them into the app leaks nothing.
	import '$lib/themes/band-site/index.css';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import { IconAdjustments } from '@tabler/icons-svelte';
	import BandSiteRenderer from '$lib/components/band-site/BandSiteRenderer.svelte';
	import { blocksForPreview } from '$lib/components/band-site/block-editing';
	import { env } from '$env/dynamic/public';
	import { bandSiteUrl } from '$lib/utils/band-site-url';
	import { themeClass } from '$lib/utils/theme-starter';
	import { getBandLayoutContext } from '../layout-context';
	import { getBandPageEditor, saveBandPageConfig } from '$lib/remote/band-page-editor.remote';
	import { type BandThemeValue, type Block } from '$lib/types/band-page';
	import themeSheet from '$lib/themes/band-site/index.css?raw';
	import { page } from '$app/state';
	import { invalidateAll } from '$app/navigation';
	import EditorShell from './EditorShell.svelte';
	import StylePanel from './StylePanel.svelte';
	import BlockMediaField from './BlockMediaField.svelte';
	import { foldLegacy, type ThemeState } from './theme-fork';

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
	const storedTheme = (initialConfig?.theme ?? 'default') as BandThemeValue;

	/**
	 * Theme and CSS are one value now. A row written under the old layering model
	 * — a theme class *plus* overrides on top of it — folds into a single
	 * stylesheet on the way in, preserving the cascade exactly; see
	 * `theme-fork.ts`. Nothing persists until they save.
	 */
	const foldedStyle = foldLegacy(
		{ theme: storedTheme, customCss: initialConfig?.customCss ?? '' },
		themeSheet
	);
	let style = $state<ThemeState>(foldedStyle);
	const wasFolded = foldedStyle.theme !== storedTheme;

	let blocks = $state<Block[]>(structuredClone(initialConfig?.blocks ?? []));

	/**
	 * Is the style pane showing? `null` means nobody has said — the panel then
	 * follows the breakpoint in CSS, open beside the canvas where there is room
	 * and closed on a phone, with no width to measure and nothing to hydrate
	 * wrong.
	 */
	let styleOpen = $state<boolean | null>(null);

	/** Which block has its settings open. One at a time. */
	let openId = $state<string | null>(null);

	/**
	 * A key an upload just wrote, resolved. The saved blocks' URLs come from the
	 * server, which by definition has not seen this one yet, so without this the
	 * canvas shows the old image until the page is saved and reloaded.
	 */
	let freshUrls = $state<Record<string, string>>({});
	const imageUrls = $derived({ ...pageData.imageUrls, ...freshUrls });

	/**
	 * What gets drawn. Image keys resolved, authored HTML sanitized — on a copy,
	 * so `blocks` stays exactly what the form posts back.
	 */
	const displayBlocks = $derived(blocksForPreview(blocks, imageUrls));

	/** The band's uploads, by the slot they sit in. */
	function mediaIn(slot: string) {
		return pageData.media.filter((m) => m.slot === slot);
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
</script>

<!-- The whole editor is one form: the header carries Save, so it has to be
     inside it, and every control on the canvas writes state the hidden inputs
     below post back. -->
<Form
	remote={saveBandPageConfig}
	successToast="Page saved"
	onsuccess={() => invalidateAll()}
	class="flex h-full min-h-0 flex-col"
>
	<PageHeader title="Page Editor" subtitle={band.name} flush={isPremium}>
		{#if isPremium && pageData.config}
			<Badge variant="success">Premium</Badge>
			<!-- The band's own subdomain, so this leaves the app: rel="external" is
			     both the correct annotation and what keeps it out of the router. -->
			<a href={siteUrl} target="_blank" rel="external noopener" class="link text-sm">
				View site &rarr;
			</a>
			<Button
				type="button"
				variant="default"
				outline
				size="sm"
				onclick={() => (styleOpen = styleOpen === true ? false : true)}
			>
				<IconAdjustments size={16} />
				Style
			</Button>
			<Button variant="primary" size="sm">Save Changes</Button>
		{/if}
	</PageHeader>

	{#if !isPremium}
		<PageContent width="2xl">
			<EmptyState>
				<p class="text-lg font-medium">Premium Feature</p>
				<p class="mt-2 opacity-70">
					The page editor is available with a premium subscription. Your act's page arrives already
					built — reorder its blocks, hide the ones you don't want, and make it yours with genre
					themes and custom CSS.
				</p>
				<Button href="../subscription" variant="primary" class="mt-4">Upgrade to Premium</Button>
			</EmptyState>
		</PageContent>
	{:else}
		<input {...saveBandPageConfig.fields.slug.as('hidden', band.slug)} />
		<input {...saveBandPageConfig.fields.theme.as('hidden', style.theme)} />
		<input {...saveBandPageConfig.fields.customCss.as('hidden', style.customCss)} />
		<input {...saveBandPageConfig.fields.blocks.as('hidden', JSON.stringify(blocks))} />

		<EditorShell open={styleOpen}>
			{#snippet canvas()}
				<!-- The page itself, with its own controls in it. The controls render
				     in the flow at each block's own width, and settings expand
				     downward — so nothing a band is trying to look at is ever covered
				     by the thing they are using to change it. And at the width it
				     actually ships at: this used to be a 42rem box inside a card. -->
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- the admin's own draft CSS, scoped to the preview container and never persisted unsanitized -->
				{@html `<style>.band-site-preview { ${style.customCss} }</style>`}
				<div
					class="band-site-preview band-site-container {themeClass(style.theme, style.customCss)}"
				>
					<BandSiteRenderer
						band={pageData.band}
						config={{
							theme: style.theme,
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
			{/snippet}

			{#snippet sidebar()}
				<StylePanel
					state={style}
					folded={wasFolded}
					onchange={(next) => (style = next)}
					onclose={() => (styleOpen = false)}
				/>
			{/snippet}
		</EditorShell>
	{/if}
</Form>

<!-- The per-block settings form. Rendered by `BandSiteRenderer` directly under
     the open block's control strip, in the flow. -->
{#snippet blockSettings(shown: Block)}
	{@const block = findBlock(shown.id) ?? shown}
	<div
		class="flex flex-wrap items-end gap-x-7 gap-y-4 border-b border-base-300 bg-base-200 px-4 py-4"
	>
		{#if block.type === 'hero'}
			<!-- The upload used to live in a Media card at the foot of the page, so
			     setting a hero image meant leaving the block, scrolling past the
			     whole site and scrolling back. It is the block's content; it lives
			     on the block. -->
			<BlockMediaField
				bandId={band.id}
				type="hero"
				label="Hero image"
				src={imageUrls[block.imageKey]}
				previewClass="h-20 w-32"
				onuploaded={(key, url) => {
					block.imageKey = key;
					if (url) freshUrls[key] = url;
				}}
			/>
			<label class="form-control">
				<span class="label-text text-xs">…or an image key / URL</span>
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
			<BlockMediaField
				bandId={band.id}
				type="image"
				label="Add a photo"
				onuploaded={() => invalidateAll()}
			/>
			{#if mediaIn('gallery').length}
				<div class="flex flex-wrap gap-2">
					{#each mediaIn('gallery') as item (item.id)}
						<img src={item.url} alt={item.caption ?? ''} class="h-16 w-16 rounded object-cover" />
					{/each}
				</div>
			{/if}
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
		{:else if block.type === 'tech_rider'}
			<!-- Both files also belong to `/band/{slug}/rider`, which owns the
			     backline as well; the block's chrome still links there. These are
			     here because a band arranging this block is looking straight at
			     the two things it renders. -->
			<BlockMediaField
				bandId={band.id}
				type="stage_plot"
				label="Stage plot"
				accept="image/*,.pdf"
				src={mediaIn('stage_plot')[0]?.url ?? undefined}
				onuploaded={() => invalidateAll()}
			/>
			<BlockMediaField
				bandId={band.id}
				type="rider"
				label="Tech rider (PDF or image)"
				accept="image/*,.pdf"
				src={mediaIn('rider')[0]?.url ?? undefined}
				onuploaded={() => invalidateAll()}
			/>
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
