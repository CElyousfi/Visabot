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

## BLS and VFS behave differently
| | BLS (blsspainmorocco.net, BLS Portugal) | VFS Global |
|---|---|---|
| How you reach the slots | Login → Book New Appointment → Visa Type Selection → **Captcha Verification** (number grid) → "Book New Appointment -": either the red "no slots" box with **Try Again**, or the calendar | Log in, open the appointment calendar |
| Auto-refresh | **None.** A verification sits before every look at the slots, and the extension never touches a verification. It reads the page you are on. | Every N seconds (60 s minimum, ±15 %), set in the popup |
| What you do | Press **Try Again** on the portal when you want to check; the result is read the instant it shows | Nothing; keep the tab open |
| Verification page | "Your turn": nothing is read or touched, no notification, watching stays on, the page that follows is read | Watching pauses with a notification; resumes by itself once the calendar is back |
| Readiness | The applicant record under **Manage Appointments** must say "Completed" or BLS will not book; a warning with a link stays on every BLS page until it does | — |

The tab you are looking at is the watched tab: switching to another portal tab that shows the
appointment page moves the watch there; closing the watched tab clears it.

## Use
1. Go to the portal, log in, pass any verification yourself, and open the appointment calendar
   (category and centre selected on the portal as usual).
2. That is all. As soon as a calendar (or the BLS "no slots" box) shows in the tab, the extension
   starts watching by itself: the panel in the bottom-right corner says **Watching**. Destination,
   centre and category are read from the page and only label the alerts; open the popup if you want
   to check or change them.
3. Keep the tab open; switch to other windows freely. On BLS, press **Try Again** yourself when you
   want to check again.
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
- **Fill my details** (button in the page panel when an applicant form is open, and "Fill the portal
  form" in the dashboard): on your click only, fills names, gender, marital status, birth date and
  place, nationality, passport number and dates, email and phone from your saved details, in the
  format the field expects. Filled fields turn green, skipped ones amber (hover for the reason).
  It never submits, never presses a button, and never touches password or verification fields.
- **Booking capture**: the confirmation page (date, time, centre, reference) is filed on the right
  application and watching stops. If a real confirmation is not recognised, send the page's visible
  text with name, passport, email, phone and the reference digits replaced by X, keeping the labels.
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
  area** in the popup, or press **Start** there.
- A page that takes long to load is not classified as "no slots" or "logged out" until its content is
  there (up to 45 s); the panel says "page loading…" meanwhile. If you get a false alert, tell me what the page showed and I will tune the rules.

## Release-time countdown (BLS Spain)

BLS Spain in Morocco does not drop slots at random: each centre releases them at a fixed, published
time (consulate rules). The popup, the in-page HUD and the dashboard show a live countdown to the next
release for your centre, the other lines (previous-visa holders, students), the walk-in hint where one
exists, and a "be ready before the minute" checklist (form completed, logged in, in position, details
saved). With **Remind me** on, you get a notification 15 min and 1 min before, and at the minute.

| Centre | Release (Moroccan time) | Source |
|---|---|---|
| Casablanca | Sunday 10:00 | BLS centre page |
| Rabat | Saturday 13:00 · prior visa (valid under 1 year, issued since 2023): Wednesday 16:00 · non-university students: Tuesday 17:00 | BLS centre page |
| Nador | Saturday 10:00 | BLS centre page + Nador consulate |
| Tétouan | Saturday 10:00 | third-party guides only – unconfirmed |
| Tanger | Monday, time not published | BLS centre page |
| Agadir | not published | – |

The built-in schedule lives in `release.js`, read from blsspainmorocco.com on 27 Oct 2026. **It verifies
itself:** whenever you open your centre's public BLS page (popup → "Open centre page"), the extension reads
the release sentence from that page and the countdown follows what the page says today, with a note showing
when it was last read and any difference from the built-in schedule. A reminder asks you to open the page
the day before a release if it hasn't been read in 5 days. The extension never acts at the release minute
on your behalf.

## Development
```
npm install                        # playwright, for the browser test only
npx playwright install chromium    # once
npm test                           # unit tests + browser smoke test (~1.5 min, waits for a real 60 s refresh)
npm run test:unit                  # detection rules only
npm run test:smoke                 # extension in Chromium against fake BLS / VFS pages (HEADED=1 to watch, FAST=1 skips the 60 s wait)
npm run zip                        # builds rdv-maroc.zip (pure Node, works on Windows) and checks every manifest file is inside
```
