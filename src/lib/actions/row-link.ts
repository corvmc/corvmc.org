import { goto } from '$app/navigation';

const INTERACTIVE =
	'a,button,input,select,textarea,label,[role="button"],.dropdown,[data-no-row-click]';

/**
 * Mouse affordance for a clickable table row.
 *
 * The row is deliberately NOT made focusable: a focusable `<tr>` announces the
 * whole row as a single button, which is worse than no keyboard target at all.
 * Keyboard and screen-reader users navigate via the real `<a>` in the row's
 * primary cell, which every list row must have.
 *
 * Clicks originating inside an interactive element are ignored, so cells no
 * longer need their own `onclick={(e) => e.stopPropagation()}`. "Originating"
 * means where the press went down: an open daisyUI dropdown sets
 * `pointer-events: none` on its trigger, so the click itself lands on the cell.
 *
 * Pass an already-resolved path — the same value the row's primary-cell `<a>`
 * uses, so the two can never drift:
 *
 * ```svelte
 * {@const href = resolve(`/staff/users/${u.id}`)}
 * <tr class="hover cursor-pointer" use:rowLink={href}>
 * 	<td class="cell-primary"><a {href}>…</a></td>
 * ```
 *
 * A function in place of the path runs instead of navigating — for a row whose
 * click opens a preview of the record rather than the record itself.
 */
export function rowLink(node: HTMLElement, href: string | (() => void)) {
	let target = href;
	let pressedInteractive = false;
	// The whole row is a link, so it gets the link cursor without each caller asking.
	node.style.cursor = 'pointer';

	const isInteractive = (el: EventTarget | null) =>
		!!(el as Element | null)?.closest?.(INTERACTIVE);

	function onPointerDown(event: PointerEvent) {
		pressedInteractive = isInteractive(event.target);
	}

	function onClick(event: MouseEvent) {
		const pressed = pressedInteractive;
		pressedInteractive = false;
		if (event.defaultPrevented || event.button !== 0) return;
		// Let the browser handle open-in-new-tab / new-window.
		if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		if (pressed || isInteractive(event.target)) return;
		// Don't hijack a click that ended a text selection.
		if (window.getSelection()?.toString()) return;
		if (typeof target === 'function') return target();
		// `target` is already the output of `resolve()` at the call site — the rule
		// only checks for a literal `resolve(...)` in this expression.
		void goto(target);
	}

	node.addEventListener('pointerdown', onPointerDown);
	node.addEventListener('click', onClick);

	return {
		update(next: string | (() => void)) {
			target = next;
		},
		destroy() {
			node.removeEventListener('pointerdown', onPointerDown);
			node.removeEventListener('click', onClick);
		}
	};
}
