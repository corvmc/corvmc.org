<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { Toaster } from 'svelte-sonner';
	import AppTopbar from './AppTopbar.svelte';
	import type { PanelTab } from './AppTopbar.svelte';
	import Sidebar from './Sidebar.svelte';
	import { IconWorld } from '@tabler/icons-svelte';
	import logo from '$lib/assets/cmc-compact-logo.svg';
	import Button from '../ui/Button.svelte';
	import Select from '../ui/Form/Select.svelte';

	let {
		drawerId,
		panels,
		activePanel,
		navigation: navSnippet,
		children
	}: {
		drawerId: string;
		panels: PanelTab[];
		activePanel: string;
		navigation: Snippet;
		children: Snippet;
	} = $props();

	let mounted = $state(false);
	onMount(() => (mounted = true));
</script>

{#if mounted}
	<Toaster position="bottom-right" richColors closeButton />
{/if}

<div class="drawer lg:drawer-open">
	<input id={drawerId} type="checkbox" class="drawer-toggle" />

	<div class="drawer-content flex h-screen flex-col overflow-hidden">
		<AppTopbar {drawerId} {panels} {activePanel} />
		<div class="tri-stripe"></div>

		<main class="flex-1 overflow-x-hidden overflow-y-auto p-6 pt-0">
			{@render children()}
		</main>
	</div>

	<div class="drawer-side z-40">
		<label for={drawerId} class="drawer-overlay"></label>
		<Sidebar>
			{#snippet brand()}
				<span class="block flex h-[48px] items-center justify-between px-3">
					<img src={logo} alt="CorvMC" class="h-full p-2" />
					<Button
						variant="default"
						size="sm"
						shape="square"
						outline
						class="latched"
						title="To Public Site"
						aria-label="To Public Site"
						href="/"
					>
						<IconWorld class="size-5 text-primary" />
					</Button>
				</span>

				<!-- Mobile panel nav -->
				<div class="border-b border-base-300 px-4 py-2 lg:hidden">
					<Select
						size="sm"
						class="w-full"
						value={activePanel}
						onchange={(e: Event) => {
							const key = (e.currentTarget as HTMLSelectElement).value;
							const panel = panels.find((p) => p.key === key);
							if (panel) window.location.href = panel.href;
						}}
					>
						{#each panels as panel (panel.key)}
							<option value={panel.key}>{panel.label}</option>
						{/each}
					</Select>
				</div>
			{/snippet}
			{#snippet navigation()}
				{@render navSnippet()}
			{/snippet}
		</Sidebar>
	</div>
</div>
