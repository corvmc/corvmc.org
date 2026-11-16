/**
 * Cancels a click on a link to the page a navigation is already loading.
 *
 * Kit pushes the destination URL before the new page renders, then treats any link
 * to `location.href` as a link to the current page and runs `refreshAll()`. A repeat
 * tap while the old page is still showing therefore refetches every query on the
 * page, the outgoing page's included, and resets them to undefined (#2477).
 */
export function ignoreRepeatTap(event: MouseEvent, pending: URL | null | undefined): void {
	if (!pending || event.defaultPrevented || event.button !== 0) return;
	if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

	const target = event.composedPath()[0];
	const a = target instanceof Element ? target.closest('a[href]') : null;
	if (!(a instanceof HTMLAnchorElement)) return;
	if ((a.target && a.target !== '_self') || a.hasAttribute('download')) return;

	if (a.href === pending.href) event.preventDefault();
}
