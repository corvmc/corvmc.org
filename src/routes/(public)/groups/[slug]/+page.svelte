<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { page } from '$app/state';
	import Hero from '#lib/components/public/Hero.svelte';
	import Section from '#lib/components/public/Section.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { resolve } from '$app/paths';
	import { signInHref } from '#lib/utils/sign-in.js';
	import JoinGroupAction from '#lib/components/groups/JoinGroupAction.svelte';
	import { getPublicGroupPage } from '#lib/remote/groups.remote.js';

	/**
	 * A program's public page — name, what it is, and the way in.
	 *
	 * The Join button is the only write on a public page in this app. It needs a
	 * session, so a signed-out visitor gets a sign-in prompt that returns them
	 * here rather than a button that fails.
	 *
	 * Whether to offer it at all is decided on the server: `viewerStatus` is the
	 * viewer's roster row, and `applied` says they already have an open
	 * application, which must not be offered a second time.
	 */
	const data = $derived(await getPublicGroupPage(page.params.slug!));
	const group = $derived(data.group);
	const status = $derived(data.viewerStatus?.status ?? null);

	const kindLabel = $derived(
		group.kind === 'committee' ? m.public_groups_slug_committee() : m.public_groups_slug_club()
	);
	const joinable = $derived(group.joinPolicy === 'open' || group.joinPolicy === 'by_application');
</script>

<svelte:head>
	<title>{m.public_corvallis_music_collective_2({ name: group.name })}</title>
	{#if group.bio}
		<meta name="description" content={group.bio} />
	{/if}
</svelte:head>

<Hero title={group.name}>{m.public_groups_slug_at_corvallis_music_collective({ kindLabel })}</Hero>

<Section>
	<div class="mx-auto flex max-w-2xl flex-col gap-6">
		{#if group.bio}
			<p class="text-base leading-relaxed text-fg-2">{group.bio}</p>
		{/if}

		<p class="text-subtle">
			<Badge variant="ghost">{kindLabel}</Badge>
			{group.memberCount}
			{group.memberCount === 1 ? m.public_member() : m.public_members_2()}
		</p>

		{#if group.joinInstructions}
			<!-- The group's own words about how it works. Under `open` this is the
			     practical note beside the button; under `by_application` it is the
			     prompt over the box, which is where it earns the most. -->
			<p class="text-base">{group.joinInstructions}</p>
		{/if}

		{#if status === 'active'}
			<Alert type="success">
				{m.public_groups_slug_re_already_group()}
				{#snippet action()}
					<Button href={resolve(`member/groups/${group.slug}`)} variant="ghost" size="sm">
						{m.public_groups_slug_open()}
					</Button>
				{/snippet}
			</Alert>
		{:else if data.applied}
			<Alert type="info">{m.public_groups_slug_application_with_group_s_chairs()}</Alert>
		{:else if status === 'pending'}
			<Alert type="info">{m.public_groups_slug_ve_been_invited_group_accept()}</Alert>
		{:else if !joinable}
			<Alert type="info">
				{m.public_groups_slug_group_invite_only_ask_someone()}
			</Alert>
		{:else if !data.signedIn}
			<!-- A prompt rather than a button that fails. The redirect brings them
			     back here, where the button will work. -->
			<Alert type="info">
				<span
					>{(group.joinPolicy === 'open'
						? m.public_groups_slug_sign_join
						: m.public_groups_slug_sign_apply)()}</span
				>
				{#snippet action()}
					<Button
						href={signInHref({ returnTo: `/groups/${group.slug}` })}
						variant="primary"
						size="sm"
					>
						{m.public_sign()}
					</Button>
				{/snippet}
			</Alert>
		{:else}
			<div>
				<JoinGroupAction
					groupId={group.id}
					groupName={group.name}
					slug={group.slug}
					kind={group.kind}
					policy={group.joinPolicy === 'open' ? 'open' : 'by_application'}
					instructions={group.joinInstructions}
				/>
			</div>
		{/if}
	</div>
</Section>
