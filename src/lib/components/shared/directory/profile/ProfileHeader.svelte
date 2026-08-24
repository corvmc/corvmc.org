<script lang="ts">
	import Button from '$lib/components/shared/Button.svelte';
	import EntityAvatar from '../EntityAvatar.svelte';
	import ShareButton from '$lib/components/shared/ShareButton.svelte';

	export type ProfilePill = { label: string; variant?: 'solid' | 'warm' };

	let {
		avatarShape,
		name,
		subtitle,
		image,
		pills = [],
		primaryAction
	}: {
		avatarShape: 'round' | 'square';
		name: string;
		subtitle?: string | null;
		image?: string | null;
		pills?: ProfilePill[];
		primaryAction?: { label: string; href: string };
	} = $props();
</script>

<header class="profile-header">
	<EntityAvatar shape={avatarShape} {name} {image} class="profile-header__avatar" />

	<div class="profile-header__main">
		<h1 class="profile-header__name">{name}</h1>
		{#if subtitle}
			<p class="profile-header__subtitle">{subtitle}</p>
		{/if}
		{#if pills.length > 0}
			<div class="profile-header__pills">
				{#each pills as pill (pill.label)}
					<span
						class="profile-pill"
						class:profile-pill--solid={pill.variant === 'solid'}
						class:profile-pill--warm={pill.variant === 'warm'}
					>
						{pill.label}
					</span>
				{/each}
			</div>
		{/if}
	</div>

	<div class="profile-header__actions">
		{#if primaryAction}
			<Button href={primaryAction.href} variant="primary" size="sm">{primaryAction.label}</Button>
		{/if}
		<ShareButton title="Copy link to this profile" />
	</div>
</header>

<style>
	.profile-header {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 18px;
		align-items: center;
	}
	:global(.profile-header__avatar) {
		width: 104px;
		height: 104px;
		flex: none;
	}
	.profile-header__main {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}
	.profile-header__name {
		margin: 0;
		font-size: 28px;
		line-height: 1.1;
		font-weight: 700;
		color: var(--color-secondary);
	}
	.profile-header__subtitle {
		margin: 0;
		font-size: 14px;
		color: var(--fg-2);
	}
	.profile-header__pills {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 2px;
	}
	.profile-pill {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.01em;
		padding: 3px 9px;
		border-radius: var(--radius-pill, 9999px);
		border: 1px solid color-mix(in oklch, var(--cmc-brown) 30%, transparent);
		color: var(--fg-2);
		background: var(--bg-card);
		white-space: nowrap;
	}
	.profile-pill--solid {
		background: var(--color-secondary);
		color: var(--color-secondary-content);
		border-color: var(--color-secondary);
	}
	.profile-pill--warm {
		background: var(--cmc-goldenrod);
		color: var(--cmc-navy);
		border-color: color-mix(in oklch, var(--cmc-goldenrod) 70%, var(--cmc-brown));
	}
	.profile-header__actions {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 6px;
	}

	@media (max-width: 640px) {
		.profile-header {
			grid-template-columns: auto 1fr;
		}
		.profile-header__actions {
			grid-column: 1 / -1;
			flex-direction: row;
			align-items: center;
			justify-content: flex-start;
		}
	}
</style>
