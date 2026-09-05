<script lang="ts">
	/**
	 * Theme and CSS, as one control.
	 *
	 * They used to be two: a row of buttons that set a `.theme-x` class, and a
	 * textarea whose contents layered on top of whatever that class did. Copying a
	 * theme's rules out of it and deleting one changed nothing, because the
	 * theme's own rule was still underneath — the pane and the page disagreed, and
	 * the pane was the half you could read.
	 *
	 * So the pane always shows what actually applies. Pick a theme and it shows
	 * that theme's rules, read-only. Customize and the class stops applying, the
	 * rules become the band's own, and the pane is the whole look. See
	 * `theme-fork.ts` for the state rules, which are pinned by a spec.
	 */
	import { IconX } from '@tabler/icons-svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import { BAND_THEMES, type BandThemeValue } from '$lib/types/band-page';
	import themeSheet from '$lib/themes/band-site/index.css?raw';
	import {
		fork,
		needsConfirm,
		paneCss,
		pickTheme,
		themeLabel,
		type ThemeState
	} from './theme-fork';

	let {
		state,
		onchange,
		onclose,
		/** Did this band's row arrive under the old layering model? Drives one note. */
		folded = false
	}: {
		state: ThemeState;
		onchange: (next: ThemeState) => void;
		onclose: () => void;
		folded?: boolean;
	} = $props();

	const forked = $derived(state.theme === 'custom');
	const css = $derived(paneCss(state, themeSheet));

	const CSS_VARIABLES = [
		{ name: '--bs-bg', what: 'page background' },
		{ name: '--bs-text', what: 'body text' },
		{ name: '--bs-accent', what: 'links and highlights' },
		{ name: '--bs-surface', what: 'cards and panels' },
		{ name: '--bs-muted', what: 'secondary text' }
	];

	function selectTheme(next: BandThemeValue) {
		if (next === state.theme) return;
		if (
			needsConfirm(state, next) &&
			!confirm(`Replace your CSS with the ${themeLabel({ theme: next, customCss: '' })} theme?`)
		) {
			return;
		}
		onchange(pickTheme(next));
	}
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<div class="flex items-center justify-between gap-2 border-b border-base-300 px-4 py-3">
		<h2 class="text-sm font-bold uppercase">Style</h2>
		<Button type="button" variant="ghost" size="sm" shape="square" onclick={onclose}>
			<IconX size={16} />
			<span class="sr-only">Close the style panel</span>
		</Button>
	</div>

	<div class="flex min-h-0 flex-1 flex-col gap-3 p-4">
		<label class="form-control">
			<span class="label-text text-xs font-medium">Theme</span>
			<Select
				size="sm"
				class="mt-1 w-full"
				aria-label="Theme"
				value={state.theme}
				onchange={(e: Event) =>
					selectTheme((e.currentTarget as HTMLSelectElement).value as BandThemeValue)}
			>
				{#each BAND_THEMES as theme (theme)}
					<option value={theme}>{themeLabel({ theme, customCss: '' })}</option>
				{/each}
				<!-- Only offered once there is something to go back to. A `custom`
				     option on a page with no custom CSS selects an empty stylesheet. -->
				{#if forked}
					<option value="custom">{themeLabel(state)}</option>
				{/if}
			</Select>
		</label>

		{#if folded}
			<!-- Only ever shown to a row written before themes became a starting
			     point. Nothing is saved until they save, and the page looks
			     identical either way: the theme's rules were folded in ahead of
			     their overrides, which is the order that was already resolving. -->
			<Alert type="info" class="text-xs">
				This page's theme rules have been folded into your CSS, so you can see all of them. Nothing
				has changed about how it looks.
			</Alert>
		{/if}

		<div class="flex min-h-0 flex-1 flex-col">
			<div class="flex flex-wrap items-center justify-between gap-2 pb-1">
				<span class="label-text text-xs font-medium">
					{forked ? 'Your CSS' : 'What this theme does'}
				</span>
				{#if !forked}
					<Button
						type="button"
						variant="default"
						outline
						size="xs"
						onclick={() => onchange(fork(state, themeSheet))}
					>
						Customize
					</Button>
				{/if}
			</div>

			<!-- A raw textarea rather than `FormField`: this posts through the page's
			     hidden input, and `FormField type="textarea"` drops `rows` and
			     `placeholder` anyway. -->
			<textarea
				class="textarea min-h-64 w-full flex-1 font-mono text-xs"
				readonly={!forked}
				aria-label={forked ? 'Your custom CSS' : 'Theme CSS (read-only)'}
				placeholder={`h1 {\n  /* your styles here */\n}`}
				value={css}
				oninput={(e) => onchange({ theme: 'custom', customCss: e.currentTarget.value })}></textarea>

			<p class="mt-1 text-xs opacity-60">
				{#if forked}
					Wrapped in <code>.band-site-container</code>, so a bare selector like <code>h1</code> only ever
					affects your page. Max 50KB; external stylesheets and scripts are stripped.
				{:else}
					Read-only. Customize to take these rules over — the theme stops applying and this becomes
					your whole page.
				{/if}
			</p>
		</div>

		<!-- Nobody can guess these, and until they are written down the CSS box is a
		     place to change colours one hex code at a time. -->
		<dl class="grid grid-cols-1 gap-x-4 border-t border-base-300 pt-3 text-muted text-xs">
			{#each CSS_VARIABLES as item (item.name)}
				<div class="flex gap-2 py-0.5">
					<dt><code>{item.name}</code></dt>
					<dd>{item.what}</dd>
				</div>
			{/each}
		</dl>
	</div>
</div>
