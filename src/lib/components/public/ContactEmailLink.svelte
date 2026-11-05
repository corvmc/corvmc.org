<script lang="ts">
	import { getContactEmail } from '#lib/remote/settings.remote.js';

	const email = $derived(await getContactEmail());
</script>

<a href="mailto:{email}">{email}</a>
