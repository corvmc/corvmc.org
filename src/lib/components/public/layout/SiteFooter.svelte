<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { IconBrandFacebook, IconBrandInstagram } from '@tabler/icons-svelte';
	import { getFooterInfo } from '#lib/remote/settings.remote.js';

	// One query, not two. Two remote queries in flight in one component crashes past kit 2.64
	// (JAVASCRIPT-SVELTEKIT-2H), and this footer renders on every public route.
	let { social, address } = $derived(await getFooterInfo());

	const addressLine = $derived(
		[address.street, [address.city, address.state].filter(Boolean).join(', ')]
			.filter(Boolean)
			.join(', ')
	);

	const footerLinks = [
		{ href: resolve('about'), label: m.public_about_label() },
		{ href: resolve('programs'), label: m.public_programs_label() },
		{ href: resolve('events'), label: m.public_events_label() },
		{ href: resolve('directory'), label: m.public_directory_label() },
		// Static, like every row here. The list cannot ask whether any group is
		// published — a second remote query in this component crashes past kit
		// 2.64 — so /groups carries its own empty state instead.
		{ href: resolve('groups'), label: m.public_site_footer_groups_label() },
		// CMC Radio had a row here and it 404'd for every visitor: `getRadioPage`
		// calls `requireFeature('cmcRadio')`, the flag is off, and production has
		// no plays to put on the air. /groups could carry an empty state because
		// its query is ungated; /radio's is not, so the row had to go instead.
		//
		// The row was also the way back from a dismissed radio bar. Nothing is
		// lost: the bar only renders while the flag is on, so with it off there is
		// nothing to have dismissed. Launching the station puts this row back.
		{ href: resolve('local-resources'), label: m.public_site_footer_local_resources_label() },
		{ href: resolve('contribute'), label: m.public_contribute_2_label() },
		{ href: resolve('about/bylaws'), label: m.public_site_footer_bylaws_label() },
		{ href: resolve('about/privacy'), label: m.public_site_footer_privacy_label() },
		{ href: resolve('contact'), label: m.public_contact_label() }
	];

	const socials = $derived(
		[
			{
				href: social.facebook,
				label: m.public_site_footer_facebook_label(),
				icon: IconBrandFacebook
			},
			{
				href: social.instagram,
				label: m.public_site_footer_instagram_label(),
				icon: IconBrandInstagram
			}
		].filter((s) => s.href)
	);
</script>

<footer
	class="mt-16"
	style="background: var(--bg-section); border-top: 1px solid var(--surface-border)"
>
	<div class="tri-stripe"></div>
	<div class="mx-auto max-w-3xl px-4 py-12 text-center">
		<div class="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm font-medium">
			{#each footerLinks as link (link.href)}
				<a href={link.href} class="link link-hover">{link.label}</a>
			{/each}
		</div>

		{#if socials.length > 0}
			<div class="mt-6 flex justify-center gap-4">
				{#each socials as social (social.label)}
					<a
						href={social.href}
						aria-label={social.label}
						rel="external"
						class="opacity-60 transition-opacity hover:opacity-100"
					>
						<social.icon size={22} />
					</a>
				{/each}
			</div>
		{/if}

		<div class="mt-6 text-xs text-fg-3">
			<p>
				{m.public_site_footer_corvallis_music_collective_all_rights_text({
					getFullYear: new Date().getFullYear()
				})}
			</p>
			<p class="mt-1">
				{m.public_site_footer_501_c_3_nonprofit_text()}{#if addressLine}&nbsp;&middot; {addressLine}{/if}
			</p>
		</div>
	</div>
</footer>
