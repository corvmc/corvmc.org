<script lang="ts">
	import { IconBrandFacebook, IconBrandInstagram } from '@tabler/icons-svelte';
	import { getFooterInfo } from '$lib/remote/settings.remote';

	// One query, not two. Two remote queries in flight in one component crashes past kit 2.64
	// (JAVASCRIPT-SVELTEKIT-2H), and this footer renders on every public route.
	let { social, address } = $derived(await getFooterInfo());

	const addressLine = $derived(
		[address.street, [address.city, address.state].filter(Boolean).join(', ')]
			.filter(Boolean)
			.join(', ')
	);

	const footerLinks = [
		{ href: '/about', label: 'About' },
		{ href: '/programs', label: 'Programs' },
		{ href: '/events', label: 'Events' },
		{ href: '/directory', label: 'Directory' },
		{ href: '/local-resources', label: 'Local Resources' },
		{ href: '/contribute', label: 'Contribute' },
		{ href: '/about/bylaws', label: 'Bylaws' },
		{ href: '/about/privacy', label: 'Privacy' },
		{ href: '/contact', label: 'Contact' }
	];

	const socials = $derived(
		[
			{ href: social.facebook, label: 'Facebook', icon: IconBrandFacebook },
			{ href: social.instagram, label: 'Instagram', icon: IconBrandInstagram }
		].filter((s) => s.href)
	);
</script>

<footer
	class="mt-16"
	style="background: var(--bg-section); border-top: 1px solid var(--surface-border)"
>
	<div class="tri-stripe"></div>
	<div class="max-w-3xl mx-auto px-4 py-12 text-center">
		<div class="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm font-medium">
			{#each footerLinks as link (link.href)}
				<a href={link.href} class="link link-hover">{link.label}</a>
			{/each}
		</div>

		{#if socials.length > 0}
			<div class="flex justify-center gap-4 mt-6">
				{#each socials as social (social.label)}
					<a
						href={social.href}
						aria-label={social.label}
						rel="external"
						class="opacity-60 hover:opacity-100 transition-opacity"
					>
						<social.icon size={22} />
					</a>
				{/each}
			</div>
		{/if}

		<div class="mt-6 text-xs text-fg-3">
			<p>&copy; {new Date().getFullYear()} Corvallis Music Collective. All rights reserved.</p>
			<p class="mt-1">
				501(c)(3) Nonprofit{#if addressLine}&nbsp;&middot; {addressLine}{/if}
			</p>
		</div>
	</div>
</footer>
