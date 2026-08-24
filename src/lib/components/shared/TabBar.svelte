<script lang="ts">
	import { Tabs, DropdownMenu } from 'bits-ui';
	import { IconChevronDown } from '@tabler/icons-svelte';
	import Badge from '$lib/components/shared/Badge.svelte';
	import ButtonGroup from '$lib/components/shared/ButtonGroup.svelte';

	type Tab = {
		key: string;
		label: string;
		badge?: string | number;
		href?: string;
	};

	let {
		tabs,
		active,
		onchange,
		collapse = false,
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
		return `join-item btn btn-sm ${key === active ? 'latched btn-primary depth-0' : 'depth-2'}`;
	}

	function handleValueChange(value: string) {
		if (value === active) return;
		onchange?.(value);
	}

	// The button group is the desktop half of a collapsed bar, and the whole
	// control otherwise.
	const groupClass = $derived(`${collapse ? 'hidden md:flex' : ''} ${className}`.trim());
</script>

{#snippet contents(tab: Tab)}
	{tab.label}
	{#if tab.badge != null}
		<Badge class="ml-1">{tab.badge}</Badge>
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
			<DropdownMenu.Trigger class="btn btn-sm depth-2 flex w-full items-center justify-between">
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
										{@render contents(tab)}
									</a>
								{/snippet}
							</DropdownMenu.Item>
						{:else}
							<DropdownMenu.Item {...itemProps} onSelect={() => handleValueChange(tab.key)}>
								{@render contents(tab)}
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
					<Tabs.Trigger id="tab-{tab.key}" value={tab.key} class={itemClass(tab.key)}>
						{@render contents(tab)}
					</Tabs.Trigger>
				{/each}
			</ButtonGroup>
		</Tabs.List>
	</Tabs.Root>
{/if}
