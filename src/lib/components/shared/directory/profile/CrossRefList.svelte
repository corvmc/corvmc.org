<script lang="ts">
	import ProfileSection from './ProfileSection.svelte';
	import EntityAvatar from '../EntityAvatar.svelte';
	import { IconArrowRight, IconLock } from '@tabler/icons-svelte';

	export type CrossRef = {
		name: string;
		sub?: string | null;
		href?: string | null;
		image?: string | null;
		/** referenced entity shape: band = square, member = round */
		avatarShape: 'round' | 'square';
		/** locked, unlinked row (e.g. a private member in the public view) */
		private?: boolean;
	};

	let {
		label,
		items,
		note
	}: {
		label: 'Bands' | 'Members';
		items: CrossRef[];
		note?: string;
	} = $props();
</script>

{#if items.length > 0}
	<ProfileSection title={label} {note}>
		<div class="rel-list">
			{#each items as item, i (item.href ?? `${item.name}-${i}`)}
				{#if item.private}
					<div class="rel-row rel-row--private">
						<EntityAvatar shape={item.avatarShape} name="Private member" class="rel-row__av" />
						<div class="rel-row__meta">
							<p class="rel-row__name">Private member</p>
							<p class="rel-row__sub">{item.sub || 'Not shown'}</p>
						</div>
						<IconLock size={16} class="rel-row__icon" />
					</div>
				{:else if item.href}
					<a href={item.href} class="rel-row">
						<EntityAvatar
							shape={item.avatarShape}
							name={item.name}
							image={item.image}
							size="avatar-sm"
							class="rel-row__av"
						/>
						<div class="rel-row__meta">
							<p class="rel-row__name">{item.name}</p>
							{#if item.sub}
								<p class="rel-row__sub">{item.sub}</p>
							{/if}
						</div>
						<IconArrowRight size={16} class="rel-row__icon" />
					</a>
				{:else}
					<div class="rel-row">
						<EntityAvatar
							shape={item.avatarShape}
							name={item.name}
							image={item.image}
							size="avatar-sm"
							class="rel-row__av"
						/>
						<div class="rel-row__meta">
							<p class="rel-row__name">{item.name}</p>
							{#if item.sub}
								<p class="rel-row__sub">{item.sub}</p>
							{/if}
						</div>
					</div>
				{/if}
			{/each}
		</div>
	</ProfileSection>
{/if}

<style>
	.rel-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.rel-row {
		display: grid;
		grid-template-columns: 40px 1fr auto;
		gap: 10px;
		align-items: center;
		padding: 8px;
		border: 1px solid var(--surface-border);
		border-radius: var(--radius, 8px);
		background: var(--bg-card);
		text-decoration: none;
		color: inherit;
		transition: border-color 120ms ease;
	}
	a.rel-row:hover {
		border-color: var(--color-primary);
	}
	.rel-row--private {
		opacity: 0.6;
	}
	:global(.rel-row__av) {
		width: 40px;
		height: 40px;
		flex: none;
	}
	.rel-row__meta {
		min-width: 0;
	}
	.rel-row__name {
		margin: 0;
		font-weight: 600;
		font-size: 14px;
		color: var(--fg-1);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rel-row__sub {
		margin: 1px 0 0;
		font-size: 12px;
		color: var(--fg-3);
	}
	:global(.rel-row__icon) {
		color: var(--fg-3);
	}
</style>
