# Visabot · RDV Maroc – Schengen Slot Watcher (browser extension)

Watches the appointment calendar **you** have open on a BLS or VFS portal in Morocco and alerts you the
moment a slot appears, so you can book it yourself. Personal use.

**What it does**
- You log in to the portal yourself and open the appointment calendar.
- The extension reads that page, refreshes it at the interval you choose (60 s minimum, slightly
  randomised), and watches for live changes.
- When a day becomes selectable, a slot list fills, or the page says slots are available, you get a
  desktop notification, a sound, an in-page banner, and the tab is brought to the front.
- If the portal shows a human verification or logs you out, the watcher **stops and tells you**.

**What it never does**
- It never stores or sends your password. It has no server.
- It never solves a CAPTCHA or bypasses any verification.
- It never clicks "book". Booking stays yours.

## Supported (Morocco)
| Destination | Provider | Centres |
|---|---|---|
| Spain | BLS International | Casablanca, Rabat, Tanger, Nador, Tétouan, Agadir |
| Portugal | BLS International | Casablanca, Rabat, Tanger |
| Italy, Netherlands, Germany, Switzerland, Belgium, Austria | VFS Global | Rabat, Casablanca, Tanger (varies) |
| France | TLScontact | **Not supported**: appointments are allocated randomly after registration; there is no calendar to watch. |

The destination / centre / category you pick are used to label alerts; the extension watches whatever
calendar page you open, so any BLS or VFS page in Morocco works.

## Install
**Chrome / Edge / Brave**
1. Unzip `rdv-maroc.zip`.
2. Open `chrome://extensions` (Edge: `edge://extensions`), turn on **Developer mode**.
3. **Load unpacked** → choose the `rdv-maroc` folder.

**Firefox** (temporary install)
1. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → pick `manifest.json`.

## Use
1. Go to the portal, log in, pass any verification yourself, and open the appointment calendar
   (category and centre selected on the portal as usual).
2. Click the extension icon. Choose your destination, centre, category, refresh interval.
3. Optional: **Pick calendar area** and click the calendar on the page. The watcher then ignores the
   rest of the page, which makes detection more accurate.
4. **Start watching this tab**. Keep the tab open; switch to other windows freely.
5. On alert: come back, choose the date, and book.

**Pause on slot** stops refreshing once a slot is seen so the page does not reload while you book.
**Re-alert** repeats the alert every N minutes while a slot stays visible.

## Notes
- Keep the refresh interval reasonable (90–180 s is plenty). Hammering the portal gets accounts blocked
  and is exactly what the providers are fighting.
- Sound needs one click on the page after loading (browser autoplay rule). The **Test alert** button
  checks notifications and sound.
- Detection is heuristic. If the status stays "Watching (page not recognised yet)", use **Pick calendar
  area**. If you get a false alert, tell me what the page showed and I will tune the rules.

## Development
```
npm install                        # playwright, for the browser test only
npx playwright install chromium    # once
npm test                           # unit tests + browser smoke test (~1.5 min, waits for a real 60 s refresh)
npm run test:unit                  # detection rules only
npm run test:smoke                 # extension in Chromium against fake BLS / VFS pages (HEADED=1 to watch, FAST=1 skips the 60 s wait)
npm run zip                        # builds rdv-maroc.zip (pure Node, works on Windows) and checks every manifest file is inside
```
