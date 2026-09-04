<script lang="ts">
	/**
	 * The band's booking enquiries, oldest activity last.
	 *
	 * Cards rather than table rows, for the same reason `/member/messages` uses
	 * them: a table wants columns of comparable values, and what matters here is
	 * who wrote, what they last said, and whether it is waiting on you.
	 *
	 * Each row says which of three states it is in, because they are the only
	 * thing the band has to act on — new (nobody here has opened it), waiting on
	 * them (answered, no reply yet), and closed.
	 */
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { relativeDay } from '$lib/utils/format';
	import DataList from '$lib/components/ui/DataList.svelte';
	import { getBandConversations } from '$lib/remote/band-messages.remote';
	import { enquiryList } from './list-state.svelte';

	const slug = $derived(page.params.slug!);
	// The page number is shared module state, not local: the thread pane is a
	// sibling and has to refresh this list at the page it is actually showing.
	const result = $derived(getBandConversations({ slug, page: enquiryList.page }));
	const openId = $derived(page.params.id);
</script>

<div class="flex min-h-0 flex-col gap-3">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h1 class="text-xl font-bold">Messages</h1>
	</div>

	<p class="text-muted text-sm">
		Enquiries from your public booking form. Replies go back by email; nobody sees your address.
	</p>

	<div class="min-h-0 flex-1 overflow-y-auto">
		<DataList
			{result}
			emptyTitle="No enquiries yet"
			empty="When someone uses the booking form on your profile, it lands here."
			onpage={(p) => (enquiryList.page = p)}
		>
			{#snippet children(enquiries)}
				<ul class="flex flex-col gap-1">
					{#each enquiries as e (e.id)}
						{@const href = resolve(`/band/${slug}/messages/${e.id}`)}
						{@const active = e.id === openId}
						<li>
							<a
								{href}
								class="flex items-start gap-3 rounded-box p-3 hover:bg-base-200 {active
									? 'bg-base-200'
									: ''}"
								aria-current={active ? 'page' : undefined}
							>
								<span class="flex min-w-0 flex-1 flex-col gap-0.5">
									<span class="flex items-center gap-2">
										<span class="truncate font-medium" class:font-bold={e.unread}>
											{e.contactName ?? 'Someone'}
										</span>
										{#if e.unread}
											<span class="size-2 shrink-0 rounded-full bg-primary" title="Unread"></span>
										{/if}
									</span>

									{#if e.preview}
										<span class="truncate text-muted text-sm">{e.preview}</span>
									{/if}

									<span class="text-subtle text-xs">
										{e.lastMessageAt ? relativeDay(e.lastMessageAt) : '—'}
										{#if e.status === 'resolved'}
											· Closed
										{:else if e.awaitingReply}
											· Waiting on them
										{/if}
									</span>
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/snippet}
		</DataList>
	</div>
</div>
