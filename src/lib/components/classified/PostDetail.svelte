<script lang="ts">
	import { resolve } from '$app/paths';
	import { withQuery } from '$lib/utils/with-query';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import { EntityChip } from '$lib/components/ui/entity';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { formatDate, formatDateTime } from '$lib/utils/format';
	import {
		classifiedKindLabel,
		classifiedCategoryLabels,
		CLASSIFIED_GEAR_DISCLAIMER,
		type ClassifiedCategory,
		type ClassifiedTagKind
	} from '$lib/config';
	import type { EntityRef } from '$lib/types/entity';

	/** A post's body and facts, shared by the member and staff detail pages. */
	let {
		post
	}: {
		post: {
			kind: string;
			category: string;
			body: string;
			displayStatus: string;
			createdAt: Date;
			expiresAt: Date;
			author: EntityRef;
			band: EntityRef | null;
			tags: { kind: ClassifiedTagKind; value: string }[];
		};
	} = $props();

	function tagHref(t: { kind: ClassifiedTagKind; value: string }) {
		const q = new URLSearchParams({ tagKind: t.kind, tagValue: t.value });
		return withQuery(resolve('/member/classifieds'), q);
	}
</script>

{#if post.category === 'gear'}
	<Alert type="warning">{CLASSIFIED_GEAR_DISCLAIMER}</Alert>
{/if}

<InfoCard title={classifiedKindLabel(post.kind, post.category)}>
	<p class="whitespace-pre-wrap">{post.body}</p>
</InfoCard>

<InfoCard title="Details">
	<DefinitionList>
		<Fact label="Status"><StatusBadge status={post.displayStatus} label /></Fact>
		<Fact
			label="Category"
			value={classifiedCategoryLabels[post.category as ClassifiedCategory] ?? post.category}
		/>
		<Fact label="Posted by"><EntityChip ref={post.author} /></Fact>
		{#if post.band}
			<Fact label="For"><EntityChip ref={post.band} /></Fact>
		{/if}
		{#if post.tags.length > 0}
			<Fact label="Tags">
				<span class="flex flex-wrap gap-1">
					{#each post.tags as t (`${t.kind}:${t.value}`)}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- tagHref resolves the path -->
						<a href={tagHref(t)}><Badge size="sm" variant="outline">{t.value}</Badge></a>
					{/each}
				</span>
			</Fact>
		{/if}
		<Fact label="Posted" value={formatDateTime(post.createdAt)} />
		<Fact label="Expires" value={formatDate(post.expiresAt)} />
	</DefinitionList>
</InfoCard>
