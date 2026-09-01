import { goto } from '$app/navigation';

const INTERACTIVE = 'a,button,input,select,textarea,label,[role="button"],[data-no-row-click]';

/**
 * Mouse affordance for a clickable table row.
 *
 * The row is deliberately NOT made focusable: a focusable `<tr>` announces the
 * whole row as a single button, which is worse than no keyboard target at all.
 * Keyboard and screen-reader users navigate via the real `<a>` in the row's
 * primary cell, which every list row must have.
 *
 * Clicks originating inside an interactive element are ignored, so cells no
 * longer need their own `onclick={(e) => e.stopPropagation()}`.
 *
 * Pass an already-resolved path — the same value the row's primary-cell `<a>`
 * uses, so the two can never drift:
 *
 * ```svelte
 * {@const href = resolve(`/staff/users/${u.id}`)}
 * <tr class="hover cursor-pointer" use:rowLink={href}>
 * 	<td class="cell-primary"><a {href}>…</a></td>
 * ```
 */
export function rowLink(node: HTMLElement, href: string) {
	let target = href;

	function onClick(event: MouseEvent) {
		if (event.defaultPrevented || event.button !== 0) return;
		// Let the browser handle open-in-new-tab / new-window.
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		if ((event.target as HTMLElement | null)?.closest(INTERACTIVE)) return;
		// Don't hijack a click that ended a text selection.
		if (window.getSelection()?.toString()) return;
		// `target` is already the output of `resolve()` at the call site — the rule
		// only checks for a literal `resolve(...)` in this expression.
		void goto(target);
	}

	node.addEventListener('click', onClick);

	return {
		update(next: string) {
			target = next;
		},
		destroy() {
			node.removeEventListener('click', onClick);
		}
	};
}
