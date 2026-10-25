# Visabot · RDV Maroc – Schengen Slot Watcher (browser extension)

Watches the appointment calendar **you** have open on a BLS or VFS portal in Morocco and alerts you the
moment a slot appears, so you can book it yourself. Personal use.

**What it does**
- You log in to the portal yourself and open the appointment calendar.
- The extension starts watching by itself, reads your destination / centre / category from the page, refreshes it at the interval you choose (60 s minimum, slightly
  randomised), and watches for live changes.
- When a day becomes selectable, a slot list fills, or the page says slots are available, you get a
  desktop notification, a sound, an in-page banner, the free days are outlined on the page, and the
  tab is brought to the front.
- If the portal shows a human verification or logs you out, the watcher **pauses and tells you**, then
  resumes by itself once the calendar is back.

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
2. That is all. As soon as a calendar shows in the tab, the extension starts watching by itself:
   the small badge in the bottom-right corner says **Watching**. Destination, centre and category are
   read from the page and only label the alerts; open the popup if you want to check or change them.
3. Keep the tab open; switch to other windows freely.
4. On alert the tab comes to the front, a green **SLOT AVAILABLE** card shows the dates, a timer, and
   your passport / name / birth date ready to copy for the form; **Show me the day** scrolls to the
   free day and flashes it; the sound repeats until you dismiss the card. Click the day, choose the
   time, confirm. The extension never clicks for you.

While it watches, the panel in the bottom-right corner shows the state, a countdown ring to the next
refresh and, when expanded, the last check, the application alerts are filed under, and quick
actions (Check now, Pause / Resume, Stop sound, Dashboard). Every change (watching started, no
slots, refreshing in 3 s, slot gone, verification needed, logged out, booked) shows briefly in the
top-right corner, and the tab title says it too: `● 54s`, `🟢 SLOT!`, `⚠ Needs you`, `✅ Booked`.

Date pickers on the application form (birth date, passport dates, travel dates) are never treated as
the appointment calendar, and watching starts by itself only on pages about appointments; press
**Start** in the popup if a page is not recognised.

If the portal shows a verification or logs you out, the watcher pauses, tells you, and resumes on its
own once you have dealt with it and the calendar is back.

**Popup options**
- **Start by itself** (on by default). Switch it off to start and stop watching with the buttons.
  **Stop** always wins: the page you stopped on is not watched again until you press Start.
- **Pick calendar area**: click anywhere on the calendar to watch only that part of the page. Useful
  if the page has other date pickers.
- **Pause on slot** stops refreshing once a slot is seen so the page does not reload while you book.
- **Re-alert** repeats the alert every N minutes while a slot stays visible.

## Dashboard
Click the list icon in the popup (or right-click the extension icon → **Options**).

- **One application per person and destination.** Fill in the applicant's details once; every value has
  a copy button (dates copy as DD/MM/YYYY) so the portal form takes seconds.
- **Live status** for each one: Watching, Slot available, Paused, Booked. Slots seen by the watcher are
  filed under the starred (linked) application, or the one matching the destination.
- **Bookings are captured automatically.** When the portal shows its confirmation page, the date, time,
  centre and reference are saved on the application, you get a notification, and watching stops.
  Booked somewhere else? Enter it by hand in the Appointment tab. **Add to calendar** gives an .ics
  with a reminder the day before.
- **Documents checklist** and **Documents** (passport scan, photos, insurance…), kept in this browser
  only, with preview and download.
- **Passphrase protection** (lock icon, off by default): applicant details, notes, the portal login
  email and the documents are encrypted in the browser (AES-GCM, key derived from your passphrase
  with PBKDF2). The dashboard asks for the passphrase when opened; the key stays in that tab's memory
  only. Statuses, dates and history stay readable so the watcher keeps working; the popup and the
  slot card show "locked" instead of your details. There is no recovery if you forget the passphrase.
- **Back up** (database icon) exports everything except the documents as JSON; with protection on,
  the details in the backup stay encrypted.

Nothing leaves your browser: there is no server.

## Notes
- Keep the refresh interval reasonable (90–180 s is plenty). Hammering the portal gets accounts blocked
  and is exactly what the providers are fighting.
- Sound needs one click on the page after loading (browser autoplay rule). The **Test alert** button
  checks notifications and sound.
- Detection is heuristic. If the badge stays "waiting for a calendar on this page", use **Pick calendar
  area** in the popup, or press **Start** there. If you get a false alert, tell me what the page showed and I will tune the rules.

## Development
```
npm install                        # playwright, for the browser test only
npx playwright install chromium    # once
npm test                           # unit tests + browser smoke test (~1.5 min, waits for a real 60 s refresh)
npm run test:unit                  # detection rules only
npm run test:smoke                 # extension in Chromium against fake BLS / VFS pages (HEADED=1 to watch, FAST=1 skips the 60 s wait)
npm run zip                        # builds rdv-maroc.zip (pure Node, works on Windows) and checks every manifest file is inside
```
