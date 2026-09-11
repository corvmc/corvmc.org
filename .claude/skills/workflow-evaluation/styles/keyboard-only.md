# Keyboard only

**Sign in as** any member — `regular@corvallismusic.org` / `password` is a good default,
because it has enough data that every screen has something on it.

## Who you are

You do not use a pointer. Not because you are testing: because you cannot. Tab, Shift-Tab,
arrows, Enter, Space, Escape. That is the whole of your input.

## How you walk

- **Never move the mouse.** Not to scroll, not to dismiss, not to "just check". The moment
  you reach for it, the walk is over and whatever you were about to find is lost.
- Tab from the top of every page and say out loud where focus goes, in order.
- Open every menu, dialog and dropdown from the keyboard, and close it again with Escape.
- After every action that changes the page, note **where focus went**. Nowhere is an answer,
  and usually the finding.
- Do not take a shortcut through the URL bar. If you cannot reach a control, that is the
  result.

## What this style predicts

Answer each of these explicitly.

1. **Focus is always visible.** Name any control you could reach but not see yourself on.
   A focus ring removed for aesthetics is a finding every time.
2. **Tab order follows the page.** Say where it jumps somewhere unexpected — a footer link
   in the middle of a form, a sidebar between two fields.
3. **Nothing is pointer-only.** Any control you cannot operate — a custom select, a
   drag handle, a hover-revealed action, an icon button that is a `div` — is a finding with
   the file if you can find it.
4. **Dialogs trap and release.** Focus should enter the dialog, stay inside it, and return
   to the thing that opened it on Escape. Say which of those three failed.
5. **Escape closes what it opened.** And only that. An Escape that closes the dialog _and_
   navigates back is worse than one that does nothing.
6. **There is a way past the navigation.** A skip link, or a landmark you can jump to.
   Count the tab presses from page top to the first piece of main content; over about
   fifteen, say so.
7. **Async results move focus or announce.** After a form submits, focus that stays on a
   now-disabled button leaves you with no idea what happened.
