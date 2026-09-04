import type { Block } from '$lib/types/band-page';
import { sanitizeBio, sanitizeHtml } from '$lib/utils/markdown';

/**
 * Where a block's content actually comes from.
 *
 * Only four of the fourteen block types hold text the band wrote on the block
 * itself. The rest are views over the roster, the gig list, the press kit, the
 * media library and the band profile — so the editor cannot let someone "edit"
 * them in place, and pretending otherwise is the one thing this map exists to
 * stop. A derived block's chrome says where its content lives and links there;
 * an authored block's does not.
 */
export interface BlockSource {
	/** Shown in the block's chrome. Sentence case — it reads after the name. */
	label: string;
	/**
	 * Path under `/band/<slug>/` that owns this content, or `null` when the band
	 * writes it on the block. A non-null value is what earns the outbound arrow.
	 */
	owner: string | null;
	/** The one action offered on an empty block. */
	action: string;
}

export const BLOCK_SOURCES: Record<Block['type'], BlockSource> = {
	hero: { label: 'yours', owner: null, action: 'Add a hero image' },
	bio: { label: 'yours', owner: null, action: 'Tell people who you are' },
	links: { label: 'from your band profile', owner: 'edit', action: 'Add your links' },
	embed: { label: 'yours', owner: null, action: 'Paste a Bandcamp or Spotify link' },
	events: { label: 'from your gig list', owner: 'events', action: 'Add a show' },
	members: { label: 'from your roster', owner: 'members', action: 'Invite your bandmates' },
	// Uploads live in this page's own Media section, so this one stays put.
	gallery: { label: 'from your media', owner: null, action: 'Upload photos below' },
	press: { label: 'from your press kit', owner: 'press-kit', action: 'Add a press quote' },
	achievements: {
		label: 'from your press kit',
		owner: 'press-kit',
		action: 'Add a highlight'
	},
	tech_rider: { label: 'from your tech rider', owner: 'rider', action: 'Upload a stage plot' },
	merch: { label: 'yours', owner: null, action: 'Add an item' },
	custom_html: { label: 'yours', owner: null, action: 'Write some HTML' },
	contact: { label: 'from your press kit', owner: 'press-kit', action: 'Add a booking contact' },
	spacer: { label: 'yours', owner: null, action: '' }
};

/**
 * What the page editor hands `BandSiteRenderer` to turn it into an editor.
 *
 * Absent on the public microsite, which is the whole point: one renderer draws
 * both, so the page a band arranges cannot drift from the page it ships.
 */
export interface BandSiteEdit {
	/** The editor's live block array, hidden blocks included. Raw — this is what saves. */
	blocks: Block[];
	/**
	 * The same blocks, same order and ids, with image keys resolved and authored
	 * HTML sanitized. What actually gets drawn. See `blocksForPreview`.
	 */
	displayBlocks: Block[];
	slug: string;
	/** Which block's settings are open, if any. */
	openId: string | null;
	onToggleOpen: (id: string) => void;
	onMove: (id: string, direction: -1 | 1) => void;
	/** Drag-and-drop landed a new order. */
	onReorder: (blocks: Block[]) => void;
	onToggleHidden: (id: string) => void;
}

// ---------------------------------------------------------------------------
// Emptiness
// ---------------------------------------------------------------------------

/**
 * What `BandSiteRenderer` knows that decides whether a block has anything to
 * show. Counts rather than the rows themselves: nothing here needs the content,
 * only whether there is any.
 */
export interface BlockContentContext {
	bandLinks: number;
	bandBio: string | null;
	members: number;
	events: number;
	pastEvents: number;
	/** Images in the `gallery` media slot. */
	galleryImages: number;
	pressQuotes: number;
	achievements: number;
	/** Any of the three EPK contacts is set. */
	hasContact: boolean;
	hasStagePlot: boolean;
	hasRider: boolean;
}

/**
 * Would this block render nothing at all?
 *
 * Mirrors the guards in `BandSiteRenderer`, which is a duplication worth naming.
 * It buys a function the editor can ask before it draws, and one a spec can pin;
 * inlining `{:else}` in each of the renderer's fourteen branches would be
 * drift-proof but untestable. The failure modes are lopsided, which is why the
 * duplication is tolerable: a false negative renders today's blank, a false
 * positive shows a ghost over real content — so every predicate here is written
 * to under-claim emptiness.
 */
export function blockIsEmpty(block: Block, ctx: BlockContentContext): boolean {
	switch (block.type) {
		// The headline falls back to the band's own name, which always exists, so
		// the hero always renders something.
		case 'hero':
			return false;
		case 'bio':
			return !block.content.trim() && !ctx.bandBio;
		case 'links':
			return ctx.bandLinks === 0;
		case 'members':
			return ctx.members === 0;
		case 'events':
			return ctx.events === 0 && !(block.showPast === true && ctx.pastEvents > 0);
		case 'gallery':
			return block.imageKeys.length === 0 && ctx.galleryImages === 0;
		case 'embed':
			return !block.url.trim();
		case 'press':
			return ctx.pressQuotes === 0;
		case 'achievements':
			return ctx.achievements === 0;
		// The form shows unless it is turned off, so this is empty only when the
		// band turned it off *and* published no one to contact.
		case 'contact':
			return (block.showForm ?? true) === false && !ctx.hasContact;
		case 'tech_rider':
			return !ctx.hasStagePlot && !ctx.hasRider;
		case 'custom_html':
			return !block.content.trim();
		case 'merch':
			return block.items.length === 0;
		// Blank space is the content.
		case 'spacer':
			return false;
	}
}

/**
 * The display copy of the editor's blocks.
 *
 * `prepareBlocksForRender` cannot be used here: it runs on the server, and it
 * would hand back blocks whose `imageKey` holds a URL rather than an R2 key —
 * which the editor would then save, corrupting the row. So the resolution is
 * done against a map, on a copy, and the editable array is never touched.
 * Hidden blocks are kept; the editor decides what to do with them.
 */
export function blocksForPreview(blocks: Block[], imageUrls: Record<string, string>): Block[] {
	return blocks.map((block) => {
		switch (block.type) {
			case 'hero':
				return { ...block, imageKey: imageUrls[block.imageKey] ?? block.imageKey };
			case 'bio':
				return { ...block, content: sanitizeBio(block.content) };
			case 'custom_html':
				return { ...block, content: sanitizeHtml(block.content) };
			case 'gallery':
				return {
					...block,
					imageKeys: block.imageKeys.map((key) => imageUrls[key]).filter((url) => !!url)
				};
			case 'merch':
				return {
					...block,
					items: block.items.map((item) =>
						item.imageKey ? { ...item, imageKey: imageUrls[item.imageKey] } : item
					)
				};
			default:
				return block;
		}
	});
}
