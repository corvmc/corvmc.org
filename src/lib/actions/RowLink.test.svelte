<script lang="ts">
	import { IconDots } from '@tabler/icons-svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { rowLink } from './row-link';

	let { to = '/row' }: { to?: string | (() => void) } = $props();
</script>

<table>
	<tbody>
		<tr use:rowLink={to}>
			<td>Name cell</td>
			<td>
				<div class="dropdown dropdown-end">
					<Button variant="ghost" size="xs" shape="square" tabindex={0} aria-label="Row actions">
						<IconDots size={16} />
					</Button>
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<ul tabindex={0} class="menu dropdown-content dropdown-panel w-44">
						<li><span>Menu body</span></li>
					</ul>
				</div>
			</td>
		</tr>
	</tbody>
</table>
