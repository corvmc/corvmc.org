# On a phone

**Sign in as** any member with data — `poweruser@corvallismusic.org` / `password` makes the
dense screens dense, which is the point.

## Who you are

You only ever use this on your phone, standing up, one-handed. 375 × 812. You have never
seen the desktop layout and never will.

## How you walk

- **Set the viewport to 375 × 812 before you sign in** and never change it. In Playwright,
  `await page.setViewportSize({ width: 375, height: 812 })`; `e2e/staff-users.e2e.ts` does
  this already and is the working example.
- Do not zoom out to see more. If it does not fit, it does not fit.
- Scroll only vertically. Horizontal scrolling on the page body is a finding, not a
  workaround.
- Reach for the primary action on every screen. Say whether your thumb could get to it.

## What this style predicts

Answer each of these explicitly.

1. **The page never scrolls sideways.** Name every screen where the body does. Wide content
   — tables, code, diagrams — should scroll inside its own container, not drag the layout.
2. **Tables become something readable.** A twelve-column staff table at 375px either
   collapses to cards, hides columns deliberately, or scrolls within itself. Say which, per
   table.
3. **Every tab is reachable.** Tab strips that overflow off-screen with no scroll and no
   indicator hide whole surfaces. This has been fixed once before, so check it.
4. **The primary action is above the fold, or sticky.** A Save button below a long form,
   with nothing pinned, is the most common version of this.
5. **Nothing is hidden behind hover.** There is no hover. Any action that only appears on
   hover does not exist for you.
6. **Modals fit.** A dialog taller than the viewport with its confirm button off the bottom
   and no internal scroll is unusable, not merely awkward.
7. **Touch targets are big enough to hit.** Icon-only buttons packed into a row are the
   usual offender; say where you missed.
8. **Fixed bars do not eat the content.** A sticky header and a sticky footer at 812px
   leave less room than you would think.
