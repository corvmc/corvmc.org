import { BRAND, EMAIL_LOGO_URL } from '$lib/email/brand';

// ---------------------------------------------------------------------------
// Marketing campaign email layout
// ---------------------------------------------------------------------------
// Deliberately mirrors postmark/templates/_layouts/corvmc-transactional so a
// broadcast and a transactional email read as the same organization: cream
// page, speaker logo, tri-stripe, parchment footer.
//
// This was MJML compiled at build time. MJML earns its keep as a single
// authoring language for all email, and it stopped being that once the
// transactional templates moved to Postmark-hosted static HTML — keeping it
// meant maintaining one design in two languages that can't share a line, which
// is how the two palettes drifted apart in the first place. The build step and
// the mjml dependency are gone with it.
//
// The markup IS duplicated between here and the Postmark layout, and that's
// accepted: the Postmark file is a static asset that can't import TypeScript,
// and generating it from here would invert the source of truth and break
// `pnpm email:pull`. src/lib/email/brand.spec.ts guards the palette instead.
//
// Placeholders (substituted by campaign-render.ts): {{PREVIEW_TEXT}},
// {{CONTENT}}, {{FOOTER}}.
// ---------------------------------------------------------------------------

const FONT = `'Lexend','Trebuchet MS','Helvetica Neue',Helvetica,Arial,sans-serif`;

const footerLink = `font-family:${FONT}; font-size:13px; color:${BRAND.brown}; text-decoration:none; padding:0 8px;`;

export const CAMPAIGN_LAYOUT = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style>
    /* @import, not <link> — matches the Postmark layout, which must use @import
       because Postmark rejects templates referencing an external stylesheet.
       Kept identical here so this layout stays pushable if campaigns ever move
       onto Postmark templates. */
    @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700&display=swap');

    body, table, td, p, a, li { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img { -ms-interpolation-mode:bicubic; border:0; outline:none; text-decoration:none; max-width:100%; }
    body { margin:0 !important; padding:0 !important; width:100% !important; }

    .content h1, .content h2, .content h3,
    .content h4, .content h5, .content h6 {
      margin:0 0 14px; font-family:${FONT}; font-weight:700;
      line-height:1.15; letter-spacing:-0.01em; color:${BRAND.navy};
    }
    .content h1 { font-size:32px; }
    .content h2 { font-size:24px; }
    .content h3 { font-size:19px; }
    /* Styled, not just h1-h3: an unstyled h4 falls through to the client's
       default and arrives as undersized Times. */
    .content h4 { font-size:17px; }
    .content h5 { font-size:15px; }
    .content h6 { font-size:14px; }
    .content p, .content li {
      font-family:${FONT}; font-size:16px; line-height:1.6; color:${BRAND.muted};
    }
    .content p { margin:0 0 14px; }
    .content ul, .content ol { margin:0 0 14px; padding-left:20px; }
    .content a { color:${BRAND.teal}; }
    .content img { border-radius:6px; }
    .content blockquote {
      margin:0 0 14px; padding:12px 18px; background-color:${BRAND.softYellow};
      border:2px solid ${BRAND.brown}; border-radius:6px; color:${BRAND.brown};
    }
    .content hr { border:0; border-top:2px solid ${BRAND.brown}; margin:22px 0; }

    @media screen and (max-width:600px) {
      .container { width:100% !important; }
      .px-32 { padding-left:22px !important; padding-right:22px !important; }
      .content h1 { font-size:26px !important; }
    }
    @media (prefers-color-scheme: dark) {
      body, .body-bg { background:${BRAND.dark.bg} !important; }
      .surface { background:${BRAND.dark.surface} !important; }
      .header-bg { background:${BRAND.dark.bg} !important; }
      /* The mark is navy and brown on transparent — 1.5:1 and 1.8:1 on the dark
         header. It keeps its own cream ground instead of a second asset. */
      .logo-plate { background:${BRAND.cream} !important; padding:10px 16px !important; }
      .footer-bg { background:${BRAND.dark.panel} !important; }
      .footer-bg a, .footer-bg div { color:${BRAND.dark.muted} !important; }
      .content h1, .content h2, .content h3,
      .content h4, .content h5, .content h6 { color:${BRAND.dark.text} !important; }
      .btn-cell { background:${BRAND.dark.orange} !important; border-color:${BRAND.dark.orange} !important; border-right-color:#000000 !important; border-bottom-color:#000000 !important; }
      .btn-cell a { color:#ffffff !important; }
      .content p, .content li, .content blockquote { color:${BRAND.dark.muted} !important; }
      .content a { color:${BRAND.dark.teal} !important; }
      .content blockquote { background:${BRAND.dark.panel} !important; border-color:${BRAND.dark.stroke} !important; }
      .content hr { border-top-color:${BRAND.dark.stroke} !important; }
    }
  </style>
</head>
<body class="body-bg" style="margin:0; padding:0; background-color:${BRAND.cream}; font-family:${FONT};">

  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; visibility:hidden; opacity:0; color:transparent;">{{PREVIEW_TEXT}}</div>

  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" class="body-bg" style="background-color:${BRAND.cream};">
    <tr><td align="center" style="padding:20px 10px;">

      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="600" class="container" style="max-width:600px; width:100%;">

        <tr><td class="header-bg" style="background-color:${BRAND.cream}; padding:24px 32px 18px; text-align:center;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" style="margin:0 auto;">
            <tr><td class="logo-plate" style="border-radius:8px;">
              <a href="https://corvmc.org" target="_blank" style="text-decoration:none;">
                <img src="${EMAIL_LOGO_URL}" width="72" height="35" alt="Corvallis Music Collective" style="display:inline-block;">
              </a>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:0; font-size:0; line-height:0;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr><td height="4" style="height:4px; background-color:${BRAND.teal}; font-size:0; line-height:0;">&nbsp;</td></tr>
            <tr><td height="4" style="height:4px; background-color:${BRAND.goldenrod}; font-size:0; line-height:0;">&nbsp;</td></tr>
            <tr><td height="4" style="height:4px; background-color:${BRAND.redOrange}; font-size:0; line-height:0;">&nbsp;</td></tr>
          </table>
        </td></tr>

        <tr><td class="surface content px-32" style="background-color:${BRAND.cream}; padding:34px 32px 32px;">
          {{CONTENT}}
        </td></tr>

        <tr><td class="footer-bg" style="background-color:${BRAND.parchment}; padding:26px 32px 28px; text-align:center;">
          <div style="margin-bottom:14px;">
            <a href="https://corvmc.org" target="_blank" style="${footerLink}">corvmc.org</a>
            <span style="color:${BRAND.brown};">&middot;</span>
            <a href="https://instagram.com/corvmc" target="_blank" style="${footerLink}">@corvmc</a>
            <span style="color:${BRAND.brown};">&middot;</span>
            <a href="mailto:contact@corvmc.org" style="${footerLink}">contact@corvmc.org</a>
          </div>
          <div style="font-family:${FONT}; font-size:12px; line-height:1.6; color:${BRAND.brown};">
            Corvallis Music Collective &middot; 501(c)(3) nonprofit<br>
            6775 SW Philomath Blvd, Corvallis, OR 97333
          </div>
          <div style="margin-top:14px; font-family:${FONT}; font-size:12px; line-height:1.6; color:${BRAND.brown};">
            {{FOOTER}}
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
