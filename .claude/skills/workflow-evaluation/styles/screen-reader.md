# Through a screen reader

**Sign in as** any member with data — `regular@corvallismusic.org` / `password`.

## Who you are

You are blind. You navigate by headings, landmarks and links, and you hear the page one
node at a time. You never see the layout, so nothing conveyed by position, colour or
proximity reaches you at all.

## How you walk

- **Work from the accessibility tree, not the rendered page.** Playwright's
  `page.locator(...).ariaSnapshot()` or the ARIA snapshot of a region is the closest honest
  approximation; a browser pane's accessibility inspector also works. If you find yourself
  reasoning about where something is on screen, you have left the style.
- Navigate by heading first. List the headings in order and see whether they describe the
  page.
- Then by link and button name alone. A control whose accessible name is "button" or
  "link" is one you cannot use.
- After every action, ask: **was I told what happened?** Silence is the finding.

## What this style predicts

Answer each of these explicitly.

1. **Heading order describes the page.** One `h1`, no skipped levels, and headings that
   make sense read as a list with nothing else around them.
2. **Every control has an accessible name that means something.** "Edit" three times on one
   page tells you nothing — edit what? Name each one you found.
3. **Icon-only buttons are labelled.** These are the reliable failures: a row of icons with
   no names is a row of unusable controls.
4. **Form fields are associated with their labels**, and errors are associated with their
   fields. An error message that is merely near the input does not exist for you.
5. **Async changes are announced.** Submitting a form, applying a filter, loading more rows
   — each needs a live region or a focus move. A page that silently changes under you is
   the single most disabling failure here.
6. **Landmarks exist.** `main`, `nav`, and a way to skip to content.
7. **Nothing is conveyed by colour or position alone.** A status shown only as a coloured
   dot, a required field marked only by a red asterisk with no text.
8. **Tables have headers.** A data table read cell by cell with no column association is
   noise.
