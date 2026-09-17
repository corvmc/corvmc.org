<script lang="ts">
	import Button from '../ui/Button.svelte';
	import { IconUser, IconSettings, IconStar, IconReceipt, IconLogout } from '@tabler/icons-svelte';
	import Avatar from '../ui/Avatar.svelte';
	import { page } from '$app/state';
	import type { AppChrome } from './chrome';
	import { ACCOUNT_MENU, activeAccountMenuKey, type AccountMenuKey } from './account-menu';

	// A prop, not a query of its own. `AppTopbar` mounts this on every
	// authenticated page, so a `getMe()` here was a third remote query racing the
	// layout's and the page's (#569). The layout query already had the user — see
	// `appChrome` in `$lib/remote/layout.remote`.
	let { me }: { me: AppChrome['me'] } = $props();

	let open = $state(false);

	const icons: Record<AccountMenuKey, typeof IconUser> = {
		profile: IconUser,
		account: IconSettings,
		purchases: IconReceipt,
		membership: IconStar
	};

	// Four destinations rather than three, so which one you are on has to be on
	// screen. The menu had no active state at all while it duplicated the
	// sidebar, which carried it (#1244).
	const activeKey = $derived(activeAccountMenuKey(page.url.pathname));

	function handleClickOutside(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.account-dropdown-wrapper')) {
			open = false;
		}
	}

	function signOut() {
		window.location.href = '/logout';
	}
</script>

<svelte:window onclick={handleClickOutside} />

<div class="account-dropdown-wrapper relative">
	<Button
		variant="ghost"
		size="sm"
		shape="circle"
		onclick={() => (open = !open)}
		aria-label="Account menu"
	>
		<Avatar
			class="size-7 text-xs"
			size="avatar-sm"
			name={me?.name ?? ''}
			src={me?.image ?? undefined}
		/>
	</Button>

	{#if open}
		<div
			class="absolute top-full right-0 z-[1000] mt-2 w-56 rounded-lg border border-base-300 bg-base-100 shadow-lg"
		>
			<div class="border-b border-base-300 px-4 py-3">
				<p class="truncate text-sm font-medium">{me?.name}</p>
				<p class="truncate text-subtle">{me?.email}</p>
			</div>

			<!-- `w-full` because daisyUI's `.menu` is `width: fit-content`, so the
			     rows would stop at the longest label instead of reaching the
			     popover's edge. -->
			<ul class="menu w-full menu-sm p-2">
				{#each ACCOUNT_MENU as item (item.key)}
					{@const Icon = icons[item.key]}
					<li>
						<a
							href={item.href}
							class:menu-active={activeKey === item.key}
							aria-current={activeKey === item.key ? 'page' : undefined}
							onclick={() => (open = false)}
						>
							<Icon size={16} />
							{item.label}
						</a>
					</li>
				{/each}
			</ul>

			<div class="border-t border-base-300 p-2">
				<Button
					variant="ghost"
					size="sm"
					class="w-full justify-start gap-2 font-normal"
					onclick={signOut}
				>
					<IconLogout size={16} />
					Sign Out
				</Button>
			</div>
		</div>
	{/if}
</div>
