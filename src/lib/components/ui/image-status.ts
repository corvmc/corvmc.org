import type { Attachment } from 'svelte/attachments';

export type ImageStatus = 'loading' | 'loaded' | 'error';

/**
 * Reports an `<img>`'s load status through listeners. An inline `onload`/`onerror`,
 * a spread or a `use:` on the img makes SSR emit `onload="this.__e=event"`, which
 * the CSP's `script-src-attr 'none'` blocks. An image that settled before
 * hydration is read off `complete` instead of an event.
 */
export function imageStatus(set: (status: ImageStatus) => void): Attachment<HTMLImageElement> {
	return (img) => {
		const loaded = () => set('loaded');
		const failed = () => set('error');
		if (!img.complete) set('loading');
		else if (img.naturalWidth > 0) loaded();
		else failed();
		img.addEventListener('load', loaded);
		img.addEventListener('error', failed);
		return () => {
			img.removeEventListener('load', loaded);
			img.removeEventListener('error', failed);
		};
	};
}
