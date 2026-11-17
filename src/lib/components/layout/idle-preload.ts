import { preloadCode } from '$app/navigation';
import { match } from '$app/paths';

type Connection = { saveData?: boolean; effectiveType?: string };

/** False when the connection asks for less data: Save-Data, or 2g and slower. */
export function connectionAllowsPreload(connection: Connection | undefined): boolean {
	if (!connection) return true;
	return !connection.saveData && !connection.effectiveType?.endsWith('2g');
}

/** Same-origin pathnames of the links inside `root`, each once. */
export function linkPaths(root: ParentNode, origin: string): string[] {
	const paths = new Set<string>();
	for (const a of root.querySelectorAll('a[href]')) {
		const url = new URL((a as HTMLAnchorElement).href, origin);
		if (url.origin === origin) paths.add(url.pathname);
	}
	return [...paths];
}

/**
 * Preloads the route code (not data) behind every link in `root`, once the page
 * has loaded and the browser is idle. Phones have no hover, and a viewport
 * preload fires only as the drawer opens, competing with the tap that follows.
 * Returns a cleanup that cancels anything not yet started.
 */
export function preloadLinksWhenIdle(root: HTMLElement): () => void {
	const connection = (navigator as Navigator & { connection?: Connection }).connection;
	if (!connectionAllowsPreload(connection)) return () => {};

	let cancelled = false;
	let idleId: number | undefined;
	let timeoutId: ReturnType<typeof setTimeout> | undefined;

	async function run() {
		for (const path of linkPaths(root, location.origin)) {
			if (cancelled) return;
			const route = await match(path);
			// One route at a time, so a tap made meanwhile waits behind one, not all.
			if (route) await preloadCode(route.id).catch(() => {});
		}
	}

	function schedule() {
		if (typeof requestIdleCallback === 'function') {
			idleId = requestIdleCallback(() => void run(), { timeout: 3000 });
		} else {
			timeoutId = setTimeout(() => void run(), 200);
		}
	}

	if (document.readyState === 'complete') schedule();
	else addEventListener('load', schedule, { once: true });

	return () => {
		cancelled = true;
		removeEventListener('load', schedule);
		if (idleId !== undefined) cancelIdleCallback(idleId);
		if (timeoutId !== undefined) clearTimeout(timeoutId);
	};
}
