<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import type { Snippet } from 'svelte';
	import { Tabs, DropdownMenu } from 'bits-ui';
	import { IconChevronDown } from '@tabler/icons-svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import ButtonGroup from '$lib/components/ui/ButtonGroup.svelte';

	/** Every tabler icon shares one props shape; borrow it from a concrete icon
	   rather than reaching into the package's un-exported `dist/types`. */
	type IconComponent = typeof IconChevronDown;

	type Tab = {
		key: string;
		label: string;
		/** The glyph that stands in for the label in `dense` mode. */
		icon?: IconComponent;
		/**
		 * A snippet as well as a value, so a badge whose number needs its own remote query can be
		 * a component instead of a prop the page has to resolve first. Resolving it on the page
		 * would put a second query in flight there — see `custom/no-concurrent-remote-queries`.
		 */
		badge?: string | number | Snippet;
		href?: ResolvedPathname;
	};

	let {
		tabs,
		active,
		onchange,
		collapse = false,
		dense = false,
		class: className = ''
	}: {
		tabs: Tab[];
		active: string;
		onchange?: (key: string) => void;
		/**
		 * Below `md`, collapse the set into a menu whose trigger names the active
		 * tab. Opt-in, because a two-tab bar reads better as two buttons at every
		 * width — this is for the bars long enough to outrun a phone.
		 *
		 * It is not cosmetic. `ButtonGroup` is a daisyUI `join`, which does not
		 * wrap, and `AppShell`'s <main> is `overflow-x-hidden`: without this the
		 * tabs past the fold are clipped off the edge with no way to reach them.
		 */
		collapse?: boolean;
		/**
		 * Shrink every tab but the active one to its `icon` plus its badge, so a
		 * long bar fits a narrow pane without scrolling sideways. The active tab
		 * keeps its word: which view you are on is not something to leave to
		 * colour alone.
		 *
		 * A tab with no `icon` is unaffected, so a partly-iconed set degrades to
		 * words rather than to blanks.
		 */
		dense?: boolean;
		class?: string;
	} = $props();

	// Two rendering modes, because a tab that navigates and a tab that flips local
	// state are different things. Link tabs render real anchors rather than a
	// tablist of buttons calling goto(), so the destination is a real link:
	// middle-click and open-in-new-tab work, the target is copyable, and
	// SvelteKit's router handles the click without any goto() of ours. `role="tab"`
	// would also be the wrong role — these are navigations, not a selected state.
	//
	// This does not by itself make the tab crawlable: every page under `(public)`
	// currently server-renders as the layout boundary's pending spinner, so no
	// initial HTML carries these anchors. PR #180 fixes that, and these become
	// crawlable the moment it lands — no change needed here.
	const asLinks = $derived(tabs.some((t) => t.href));

	const activeTab = $derived(tabs.find((t) => t.key === active) ?? tabs[0]);

	function itemClass(key: string) {
		// `px-2` in dense mode: five tabs have to clear a 20rem pane, and the
		// default inline padding alone spends 120px of it.
		return `join-item btn btn-sm ${dense ? 'px-2' : ''} ${
			key === active ? 'latched btn-primary depth-0' : 'depth-2'
		}`;
	}

	/**
	 * An icon-only tab has no text to name it, so it carries an `aria-label` — and
	 * that label has to carry the count as well, because the badge it stands in
	 * for leaves the accessible name with it. The active tab is deliberately left
	 * alone: its name stays content-derived, which is what the Open-count
	 * assertion in `inbox-awaiting-reply.e2e.ts` reads.
	 */
	function iconOnlyProps(tab: Tab): Record<string, string> {
		if (!dense || !tab.icon || tab.key === active) return {};
		const name =
			tab.badge != null && typeof tab.badge !== 'function'
				? `${tab.label}, ${tab.badge}`
				: tab.label;
		return { 'aria-label': name, title: tab.label };
	}

	function handleValueChange(value: string) {
		if (value === active) return;
		onchange?.(value);
	}

	// The button group is the desktop half of a collapsed bar, and the whole
	// control otherwise.
	const groupClass = $derived(`${collapse ? 'hidden md:flex' : ''} ${className}`.trim());
</script>

<!-- `full` is the dropdown's opt-out: a collapsed menu lists tabs one per line,
     where there is room for the word and no latched colour to say which is on. -->
{#snippet contents(tab: Tab, full = false)}
	{#if dense && tab.icon}
		{@const Icon = tab.icon}
		<Icon size={16} />
	{/if}
	{#if full || !dense || !tab.icon || tab.key === active}
		{tab.label}
	{/if}
	{#if typeof tab.badge === 'function'}
		{@render tab.badge()}
	{:else if tab.badge != null}
		<!-- A pill around every count is ~20px of pane each, and a dense bar has
		     five of them. The number alone still reads as a count next to a glyph. -->
		{#if dense && tab.icon && !full}
			<span class="ml-1 text-xs opacity-80">{tab.badge}</span>
		{:else}
			<Badge class="ml-1">{tab.badge}</Badge>
		{/if}
	{/if}
{/snippet}

{#if collapse}
	<div class="md:hidden">
		<DropdownMenu.Root>
			<!--
				No aria-label. The trigger's whole job is to say which section you are
				in, and an aria-label would replace that text as the accessible name —
				leaving a screen reader with "Choose a section" and no answer.
			-->
			<DropdownMenu.Trigger class="depth-2 btn flex w-full items-center justify-between btn-sm">
				<span class="flex items-center">{@render contents(activeTab)}</span>
				<IconChevronDown size={14} />
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content
					sideOffset={4}
					class="z-[1000] w-[var(--bits-floating-anchor-width)] min-w-48 rounded-lg border border-base-300 bg-base-100 p-2 shadow-lg"
				>
					{#each tabs as tab (tab.key)}
						{@const itemProps = {
							class: `flex cursor-pointer items-center justify-between gap-2 rounded-box px-3 py-2 text-sm data-highlighted:bg-base-200 ${
								tab.key === active ? 'font-semibold text-primary' : ''
							}`
						}}
						{#if tab.href}
							<DropdownMenu.Item {...itemProps}>
								{#snippet child({ props })}
									<a
										{...props}
										href={tab.href}
										aria-current={tab.key === active ? 'page' : undefined}
									>
										{@render contents(tab, true)}
									</a>
								{/snippet}
							</DropdownMenu.Item>
						{:else}
							<DropdownMenu.Item {...itemProps} onSelect={() => handleValueChange(tab.key)}>
								{@render contents(tab, true)}
							</DropdownMenu.Item>
						{/if}
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	</div>
{/if}

{#if asLinks}
	<ButtonGroup class={groupClass}>
		{#each tabs as tab (tab.key)}
			<a
				href={tab.href}
				class={itemClass(tab.key)}
				aria-current={tab.key === active ? 'page' : undefined}
				{...iconOnlyProps(tab)}
			>
				{@render contents(tab)}
			</a>
		{/each}
	</ButtonGroup>
{:else}
	<!--
		A real tablist rather than a ToggleGroup. The group was rendering
		`role="radiogroup"` of `role="radio"` items, so a tab UI announced itself as
		a set of radio buttons and lost both arrow-key navigation and "tab 3 of 8".
		`activationMode="manual"` because arrow-keying with the automatic default
		would activate — and on the staff user record, mount and fetch — every panel
		you pass through on the way.

		Trigger ids are explicit so the panels the caller renders can point back at
		them with `aria-labelledby`; bits-ui only fills in `aria-controls` for a
		`Tabs.Content` of its own, which lives outside this component.
	-->
	<Tabs.Root value={active} onValueChange={handleValueChange} activationMode="manual">
		<Tabs.List>
			<ButtonGroup class={groupClass}>
				{#each tabs as tab (tab.key)}
					<Tabs.Trigger
						id="tab-{tab.key}"
						value={tab.key}
						class={itemClass(tab.key)}
						{...iconOnlyProps(tab)}
					>
						{@render contents(tab)}
					</Tabs.Trigger>
				{/each}
			</ButtonGroup>
		</Tabs.List>
	</Tabs.Root>
{/if}
