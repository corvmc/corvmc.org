<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { getContactEmail } from '#lib/remote/settings.remote.js';

	// Its own component because the page already awaits a remote query, and one
	// component holds one query in flight.
	const email = $derived(await getContactEmail());
</script>

<p class="text-muted leading-relaxed">
	<ParaglideMessage message={m.public_programs_got_gear_collecting_dust_we_text} inputs={{ email }}
		>{#snippet a({ children })}<a href="mailto:{email}" class="link">{@render children?.()}</a
			>{/snippet}</ParaglideMessage
	>
</p>
