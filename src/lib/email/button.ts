import { BRAND } from './brand';

// ---------------------------------------------------------------------------
// The offset-shadow email button
// ---------------------------------------------------------------------------
// A table with a `bgcolor` attribute, not a styled <a>: Word-engine Outlook
// drops background-color on an anchor. `.btn-cell` is the hook both layouts'
// dark blocks recolor. The Postmark templates carry this markup inline —
// static files cannot import it.
// ---------------------------------------------------------------------------

const FONT = `'Lexend','Trebuchet MS',Helvetica,Arial,sans-serif`;

/**
 * One call-to-action button.
 *
 * `href` and `label` are interpolated as-is — callers pass values that are
 * already escaped or already trusted markup.
 */
export function emailButton(href: string, label: string): string {
	return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 6px;">
  <tr>
    <td bgcolor="${BRAND.orange}" class="btn-cell" style="background-color:${BRAND.orange}; border:2px solid ${BRAND.brown}; border-right-width:5px; border-bottom-width:5px; border-radius:6px;">
      <a href="${href}" target="_blank" style="display:inline-block; padding:13px 24px; font-family:${FONT}; font-weight:700; font-size:15px; color:#ffffff; text-decoration:none;">${label}</a>
    </td>
  </tr>
</table>`;
}
