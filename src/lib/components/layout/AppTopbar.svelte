<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import Button from '../ui/Button.svelte';
	import { IconMenu2, IconMusic, IconChevronDown } from '@tabler/icons-svelte';
	import NotificationBell from './NotificationBell.svelte';
	import AccountDropdown from './AccountDropdown.svelte';
	import logo from '$lib/assets/cmc-compact-logo.svg';
	import ButtonGroup from '../ui/ButtonGroup.svelte';
	import type { AppChrome } from './chrome';

	export interface PanelTab {
		key: string;
		label: string;
		href: ResolvedPathname;
		type: 'member' | 'staff' | 'band';
	}

	let {
		drawerId,
		panels,
		activePanel,
		chrome
	}: {
		drawerId: string;
		panels: PanelTab[];
		activePanel: string;
		chrome: AppChrome;
	} = $props();

	const primaryPanels = $derived(panels.filter((p) => p.type !== 'band'));
	const bandPanels = $derived(panels.filter((p) => p.type === 'band'));
	const activeBand = $derived(bandPanels.find((b) => b.key === activePanel));

	let bandsOpen = $state(false);

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.bands-dropdown-wrapper')) {
			bandsOpen = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} />

<nav
	class="navbar z-50 h-[48px] min-h-0 justify-between border-b border-base-300 bg-base-100 px-3 pt-3 pb-1"
>
	<!-- Left: hamburger (mobile) + brand + panel tabs (desktop) -->
	<div class="flex items-center gap-2">
		<label for={drawerId} class="btn btn-square btn-ghost btn-sm lg:hidden">
			<IconMenu2 size={20} />
		</label>

		<!-- Panel tabs - desktop only -->
		<ButtonGroup class="ml-4 hidden lg:flex">
			{#each primaryPanels as panel (panel.key)}
				<Button
					href={panel.href}
					variant={panel.key === activePanel ? 'primary' : 'ghost'}
					size="sm"
					class="join-item {panel.key === activePanel ? 'latched' : ''}"
				>
					{panel.label}
				</Button>
			{/each}

			{#if bandPanels.length > 0}
				<!-- `.join-item` lands on this wrapper rather than on the Button,
				     because the popover needs the positioning context — so the join
				     sizes the div and the button inside it was free to be shorter
				     than its neighbours. `flex` plus `h-full` puts them back in
				     step; the `rounded-[inherit]` below is the same mismatch
				     already patched once, for corners (#1023). -->
				<div class="bands-dropdown-wrapper relative join-item flex">
					<Button
						variant={activeBand ? 'primary' : 'ghost'}
						size="sm"
						class="h-full rounded-[inherit] {activeBand ? 'latched' : ''}"
						onclick={() => (bandsOpen = !bandsOpen)}
					>
						<IconMusic size={16} />
						{activeBand?.label ?? 'Acts'}
						<IconChevronDown size={14} />
					</Button>

					{#if bandsOpen}
						<div
							class="absolute top-full left-0 z-[1000] mt-1 w-48 rounded-lg border border-base-300 bg-base-100 shadow-lg"
						>
							<!-- `w-full` because daisyUI's `.menu` is `width: fit-content`,
							     so the rows stopped at the longest label instead of reaching
							     the popover's edge. Same class, same trap, as the note in
							     SearchSelect. -->
							<ul class="menu w-full menu-sm p-2">
								{#each bandPanels as band (band.key)}
									<li>
										<a
											href={band.href}
											class:active={band.key === activePanel}
											onclick={() => (bandsOpen = false)}
										>
											{band.label}
										</a>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
			{/if}
		</ButtonGroup>
	</div>

	<!-- Mobile brand -->
	<span class="lg:hidden">
		<img src={logo} alt="CorvMC" class="h-full" />
	</span>

	<!-- Right: notifications + account -->
	<div class="flex flex-none items-center gap-1">
		<NotificationBell
			notifications={chrome.notifications.items}
			unreadCount={chrome.notifications.unreadCount}
		/>
		<AccountDropdown me={chrome.me} />
	</div>
</nav>
