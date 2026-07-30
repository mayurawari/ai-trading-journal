# Build Log

Running record of what has been built, node by node. Each node says **what it does**,
**which files**, and **how it works**. Newest phase at the bottom.

- Plan → [ARCHITECTURE.md](ARCHITECTURE.md)
- Original spec → [prompt.md](prompt.md)

**Where we are now:** Phase 1 code is written and the build passes.
Waiting on you to do the Google Cloud setup in [Node 7](#node-7--your-turn-google-cloud-setup),
then we run the two-click test.

---

# Phase 1 — Get a row into Google Sheets

Goal: prove the app can talk to Google and add rows to **one** sheet.
No AI yet — that is Phase 2. This phase is first because Google sign-in is the only
part with unknown friction, and everything else depends on it working.

---

## Node 1 — Project setup

**Files:** `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `.gitignore`

Next.js 16.2 + React 19.2 + TypeScript 7 + Tailwind 4, and the `googleapis` library.

Built by hand instead of with `create-next-app`, because the folder name
"AI trading journal" has spaces and capital letters, which npm rejects as a package name.
Same result, just assembled manually. The app is named `ai-trading-journal` internally.

Two things worth knowing:

- **`.gitignore` blocks `.data/` and `.env.local`.** Those hold your real Google
  credentials. They must never end up in version control.
- **`next.config.ts` turns on `useTypeScriptCli`.** TypeScript 7 is the new native
  compiler and removed an interface Next.js relied on. This flag makes Next check
  types by running `tsc` directly instead. Without it the build fails.

---

## Node 2 — The columns

**File:** [src/core/fields.ts](src/core/fields.ts)

The list of all 36 columns in your sheet. **This is the only file to edit when you want
to change your journal format.** Add a line, get a column. Delete a line, lose a column.

Each column records four things:

```
key      – short name used inside the code
header   – the exact heading text in your sheet
type     – text / number / date / time / enum
source   – "ai" (read from what you type) or "derived" (worked out by the app)
desc     – an explanation written for the AI to read in Phase 2
```

The `desc` lines are why the AI will understand you. For example the Buy/Sell column says
*"BUY for bought/long/longed/bullish, SELL for sold/short/shorted/bearish"* — so when you
write "longed gold" it knows that means BUY.

**The important function here is `toRow()`.** Before writing anything, it reads the real
headings from row 1 of your sheet and lines your values up against **those** — not against
the order in this file. So if you drag a column somewhere else in Google Sheets, or rename
one, your data still lands in the right place instead of shifting sideways. This is the
header-driven mapping from ARCHITECTURE.md §3.

---

## Node 3 — Worked-out fields

**File:** [src/core/derive.ts](src/core/derive.ts)

Fills in everything the app can figure out by itself, so you never type it:

| Column | Where it comes from |
|---|---|
| Trade ID | Auto-generated, e.g. `T-20260729-143022-4f2a` |
| Date | What you said, otherwise today |
| Timezone | Always IST |
| Week Number, Month, Year | Worked out from the date |
| Risk Reward | Reward ÷ risk, using entry, stop loss and target |
| Result | WIN / LOSS / BE |
| Created Timestamp | The moment the row was written |

All dates and times use IST (`Asia/Kolkata`), as decided in ARCHITECTURE.md §10.

Two details:

- **Week Number follows the ISO standard**, so the last days of December land in the
  correct week instead of resetting oddly at the year boundary.
- **Result prefers your stated PnL.** If you didn't give a number, it compares entry
  against exit and takes your Buy/Sell direction into account — so a SELL that went down
  is correctly a WIN.

These are plain functions with no internet access, which means they can be tested
instantly without touching Google.

---

## Node 4 — Google sign-in

**Files:** [src/services/google/auth.ts](src/services/google/auth.ts), [src/lib/store.ts](src/lib/store.ts)

Handles connecting your Google account and staying connected.

**How the sign-in works.** You click *Connect Google* → the app sends you to Google's
permission screen → you approve → Google sends your browser back with a temporary code →
the app swaps that code for a long-lived token → the token is saved to `.data/tokens.json`.

After that first time it just works. The token quietly renews itself in the background,
and each renewal is written back to the file, so restarting your computer doesn't log you out.

**Three deliberate safety choices:**

1. **Minimum permissions.** The app asks for `drive.file`, which means it can only see
   files *it created itself*. It cannot read the rest of your Drive — not your photos,
   not your documents. Even if something went badly wrong, the blast radius is one
   spreadsheet.
2. **Only your account.** `ALLOWED_GOOGLE_EMAIL` in the settings file locks sign-in to one
   address. Any other Google account is rejected at the door.
3. **Nothing sensitive reaches the browser.** All Google calls happen on the server side.

`store.ts` is just "save this as a JSON file" — a real database would be overkill for
one person on one machine.

---

## Node 5 — Writing to the sheet

**File:** [src/services/google/sheets.ts](src/services/google/sheets.ts)

**This is the file that guarantees one sheet, forever.**

The first time you save anything, it creates a spreadsheet called *AI Trading Journal*
with one tab called *Trades*, writes the 36 headings into row 1, makes them bold, freezes
the top row so headings stay visible while you scroll — and then **saves the sheet's ID to
`.data/config.json`**.

Every save after that reads that saved ID and appends to the same file. There is no code
path anywhere in this project that creates a second spreadsheet or a second tab once that
ID exists. One trade = one new row, underneath the last one.

The single exception: if you delete the spreadsheet from your Drive, the app notices it's
gone and makes a fresh one rather than crashing.

`appendTrade()` uses Google's "append" operation, which finds the last used row and adds
after it. It never overwrites and never needs to know how many rows already exist.

### Fixed during first live run

Two bugs, found by actually clicking the button.

**1. `No sheet with id: 0`** — the code assumed the new tab would have id `0`. It doesn't:
because we name the tab *Trades* when creating the file, Google assigns a random id instead.
Now the real id is read back from the create response and used for the formatting step.

**2. The one that actually mattered.** The sequence was: create sheet → write headers →
format → *save the id*. Bug 1 crashed at the format step, so the id was never saved — even
though the spreadsheet existed. On the next click the app would have found no saved id and
**created a second spreadsheet.** The exact thing this file promises never happens, caused by
an error path rather than by the main logic.

Three changes, because one fix wasn't enough:

- **The id is saved immediately after creation**, before anything else. Nothing that happens
  afterwards can orphan a sheet.
- **Formatting is now best-effort.** Bold and frozen headings are cosmetic; they are no longer
  allowed to fail a save. An unformatted header row works perfectly well.
- **The app searches Drive for an untracked journal before creating one.** If a previous run
  left a stray sheet behind, it adopts it instead of adding another. `drive.file` scope means
  this search can only ever see files this app itself created.

Worth spelling out because it's a general lesson: *a guarantee that only holds on the happy
path isn't a guarantee.* The invariant here is "one sheet, forever" — so the failure paths
are exactly where it needed defending.

---

## Node 6 — Routes and screen

**Files:** [src/app/page.tsx](src/app/page.tsx), [src/app/api/](src/app/api/)

Four small server endpoints:

| Route | Job |
|---|---|
| `/api/auth/google` | Sends you to Google's permission screen |
| `/api/auth/google/callback` | Catches you coming back, saves the token |
| `/api/status` | Reports: connected? which account? how many trades so far? |
| `/api/test-row` | Writes one fake trade — the Phase 1 proof |

The screen shows your connection status, a link to your sheet, a live trade count, and an
*Add test row* button. Errors are shown in plain words on the page rather than hidden in a
console.

`/api/test-row` writes the Gold example straight from your original spec, so the row that
appears will look like a real trade with "TEST ROW" in the notes column.

---

## Node 7 — YOUR TURN: Google Cloud setup

This part only you can do — it needs your Google account. Takes about 10 minutes.
It's a one-time setup.

### Step 1 — Make a project

Go to **https://console.cloud.google.com/**

Top of the page, click the project dropdown → **New Project** → name it
`AI Trading Journal` → **Create**. Wait a few seconds, then make sure that project is
selected in the dropdown.

### Step 2 — Switch on the two APIs

Left menu → **APIs & Services** → **Library**.

Search **"Google Sheets API"** → click it → **Enable**.

Go back to Library, search **"Google Drive API"** → click it → **Enable**.

Both are needed: Sheets to write rows, Drive to create the file in the first place.

### Step 3 — Set up the permission screen

Left menu → **APIs & Services** → **OAuth consent screen**.

Google renamed this to **Google Auth Platform**, and it now opens on a **Get started**
page instead of a form. Click **Get started** and fill the four short steps:

1. **App Information**
   - App name: `AI Trading Journal`
   - User support email: pick your email from the dropdown
   - **Next**
2. **Audience**
   - Choose **External** → **Next**
3. **Contact Information**
   - Your email address → **Next**
4. **Finish**
   - Tick *I agree to the Google API Services: User Data Policy*
   - **Continue** → **Create**

You now land on the Google Auth Platform dashboard, with a left menu containing
**Overview · Branding · Audience · Clients · Data Access**. The next two steps live there.

> **Data Access** is where scopes are listed. **Skip it** — this app asks for its own
> permissions when you sign in, so there is nothing to add.

### Step 3b — Add yourself as a test user

Left menu → **Audience** → scroll to **Test users** → **+ Add users**
→ enter **mayurawari50@gmail.com** → **Save**.

*Don't skip this.* Without it Google blocks your own sign-in.

### Step 4 — Get your two keys

Left menu → **Clients** → **+ Create client**.

(This is the same thing the old console called *Credentials → Create OAuth client ID*.)

- Application type: **Web application**
- Name: `AI Trading Journal Local`
- Under **Authorized redirect URIs**, click **+ Add URI** and paste **exactly** this:

  ```
  http://localhost:3000/api/auth/google/callback
  ```

  This has to match character for character — no trailing slash, `http` not `https`.
  A mismatch here is the single most common thing that goes wrong.

- **Create**. A box appears with **Client ID** and **Client Secret**. Keep it open.

### Step 5 — Put the keys in the app

In this project folder, make a copy of `.env.local.example` and name the copy
**`.env.local`**. Open it and paste your two values:

```
GOOGLE_CLIENT_ID=paste-the-client-id-here
GOOGLE_CLIENT_SECRET=paste-the-client-secret-here
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
ALLOWED_GOOGLE_EMAIL=mayurawari50@gmail.com
```

This file is already gitignored, so the keys stay on your machine.

### Step 6 — Publish the app (no verification needed)

Left menu → **Audience**. At the top you'll see **Publishing status: Testing**
and a **Publish app** button. Click it and confirm.

**Why this matters:** while an app is in *Testing*, Google expires its connection after
**7 days** and you'd have to reconnect every week. Publishing removes that.

**Google will not ask you to verify this app**, because it only requests non-sensitive
scopes — see the note below. If you saw a verification prompt earlier, that was the old
`spreadsheets` scope, which has since been removed.

> **If you still see "Google hasn't verified this app"** with a **Back to safety** button:
> that button cancels sign-in. Click **Advanced** at the bottom left instead, then
> **Go to AI Trading Journal (unsafe)**. The wording is alarming but it just means
> *"nobody at Google reviewed this"* — which is true, you wrote it an hour ago. It is your
> own app, running on your own machine, touching one spreadsheet it created itself.

### Why there is no verification step

Google only demands app verification for **sensitive** or **restricted** scopes. This app
asks for neither:

| Scope | Class | What it allows |
|---|---|---|
| `drive.file` | Non-sensitive | Only files this app created itself |
| `userinfo.email` | Non-sensitive | Your email, to check it against the allow-list |

The obvious scope for this project would have been `spreadsheets` — but that one is
**sensitive**, because it grants access to *every* spreadsheet in your Drive. Choosing it
would have meant a verification review, or living with weekly reconnects.

It turns out we never needed it: **the Sheets API accepts `drive.file`** for everything
this app does — creating the spreadsheet, reading headers, appending rows, formatting —
precisely because the app created that file itself.

So the narrower scope is both the safer choice and the one with no paperwork. The one thing
it gives up: the app cannot open a spreadsheet you made by hand. Since it creates its own,
that costs us nothing.

---

## Node 8 — Run it and check

Once `.env.local` is filled in:

```
npm run dev
```

Open **http://localhost:3000**

1. Click **Connect Google** → approve → you land back on the page showing
   *Connected as mayurawari50@gmail.com*.
2. Click **Add test row**. A sheet gets created and one row appears.
3. Click **Add test row** again.
4. Click **Open sheet**.

**The test passes if you see two rows in one sheet.** Two sheets, or two tabs, means
something is wrong — tell me and I'll fix it.

The trade count on the page should also read **2**.

---

## Notes and known issues

**`npm audit` reports 9 high-severity warnings — I looked at each and left them.**
All three come from packages buried inside `googleapis` and `next`, not from our code:

- `brace-expansion` — a crash that needs attacker-supplied file-search patterns. We never
  pass user input there.
- `postcss` — affects processing untrusted CSS at build time. The only CSS here is ours.
- `sharp` — image processing. This app handles no images.

The only fix npm offers is downgrading Next.js to version 9, from 2020. That trade is
clearly worse. Revisit when Google and Next ship updated internals. Worth knowing rather
than silently ignoring.

**Everything in `.data/` is disposable.** Delete `tokens.json` to sign out.
Delete `config.json` to make the app create a fresh spreadsheet next time — useful once,
after the test, to start your real journal clean.

---

## What Phase 1 does not do

No AI, no text box for describing trades, no reading trades back. `/api/test-row` writes
the same hardcoded trade every time. That's the point of this phase — one thing proven at
a time.

---

## Decision: Gemini instead of OpenAI

`prompt.md` originally picked the OpenAI Responses API. **Switched to Google Gemini**
(`gemini-2.5-flash`) so the whole project runs free — Gemini has a real free tier with no
card and no prepaid credits, where OpenAI needs about $5 up front.

It does the one thing we actually need: guaranteed JSON matching a schema we define, so
extracted fields land in the right columns instead of arriving as loose prose. Same Google
account as the Sheets side too, which keeps setup in one place.

**One tradeoff worth knowing:** on Gemini's free tier Google may use your content to improve
their products. Your journal entries include personal reflections on your own trading. Not a
reason to avoid it, but it's your call — the paid tier removes this, and switching later is
one file.

Key comes from **https://aistudio.google.com/apikey** → *Create API key* → paste into `.env`
as `GEMINI_API_KEY`. Not needed until Phase 2 starts.

---

---

# Phase 2 — AI extraction ✅

Goal: type a trade in plain English, have it read correctly, check it, save it.
**This is the whole product.** Everything from here is refinement.

---

## Node 9 — Field groups

**File:** [src/core/fields.ts](src/core/fields.ts)

Added a `group` to every column — *Trade, Prices, Size, Context, Psychology, Outcome,
Notes* — plus `long` for fields that deserve a bigger box.

Small change, but it means the review form organises itself. Add a column tomorrow with
`group: "Prices"` and it appears in the right section with no UI work at all. One list still
drives the sheet headings, the AI schema, and the form.

---

## Node 10 — Telling Gemini what to fill in

**File:** [src/services/gemini/schema.ts](src/services/gemini/schema.ts)

Converts the field list into Gemini's response schema, so the AI is *structurally required*
to answer with your exact fields. Not asked politely in a prompt — constrained by the API.

Two things fall out of that:

- **Buy/Sell can only ever be `BUY` or `SELL`.** Enum columns list their allowed values in
  the schema, so "long" or "bullish" can't leak into the sheet and split your data later.
- **Every field is nullable.** `null` means *you didn't say*, which is deliberately different
  from zero or empty.

Derived columns are excluded entirely — the AI is never even offered the chance to guess a
week number or a risk-reward.

---

## Node 11 — The extraction prompt

**File:** [src/services/gemini/extract.ts](src/services/gemini/extract.ts)

The instructions that decide whether this app is trustworthy. The rules, in priority order:

1. Record only what you actually said. Not stated → null.
2. **Never invent, estimate or infer a number.** A blank cell is a minor annoyance; a wrong
   entry price silently corrupts your journal and every figure ever calculated from it.
3. Don't calculate anything — the app does that.
4. Understand trading slang: *longed / went long / bought* → BUY.
5. "Price hit target" → exit price is the target. "Stopped out" → exit is the stop loss.
6. Free text keeps your voice, condensed. No advice, no encouragement, nothing you didn't say.

Today's date is injected each call so "today" and "last Friday" resolve correctly in IST.

Two settings worth knowing:

- **`temperature: 0`** — the same description always produces the same fields. Extraction is
  mechanical; creativity is a defect here.
- **`thinkingBudget: 0`** — Gemini 2.5 deliberates before answering by default. Reading a
  trade description needs no deliberation, and turning it off cuts seconds off every entry.

There's also a `coerce()` step, because models sometimes return `"3385.20"` as text. It
converts numbers properly and strips commas, so the sheet gets real numbers it can add up.

---

## Node 12 — Two routes

| Route | Job |
|---|---|
| `/api/extract` | Your text in, filled fields out. **Writes nothing.** |
| `/api/save` | Takes the fields you confirmed, recomputes derived columns, appends one row |

The split matters: extraction never touches your sheet, so a misread costs you nothing until
you approve it.

`/api/save` only accepts known AI fields from the browser. Derived columns are recomputed
server-side from what you confirmed, so nothing sent by the page can overwrite a calculated
value. And it re-derives rather than trusting the preview — if you corrected the target in
the form, risk-reward updates to match.

The Phase 1 `/api/test-row` route is deleted; `/api/save` replaces it.

---

## Node 13 — The interface

**Files:** [src/app/page.tsx](src/app/page.tsx), [src/app/globals.css](src/app/globals.css)

Rebuilt from scratch. Three stages, one screen:

```
Write  →  Check  →  Saved
```

**Write** — one large box. Type the trade however you'd say it out loud. `Ctrl+Enter`
extracts. An *Use an example* link fills in the Gold trade from `prompt.md` if you want to
see it work before typing anything.

**Check** — everything found, laid out in sections, all of it editable. Fields the AI
filled show a solid label; empty ones are dimmed, so what's missing is visible at a glance
rather than hidden. A counter reads *"16 of 28 fields filled"* — 28 being the columns the AI
is responsible for, with the other 8 calculated by the app.

Above the form sit read-only chips for **Risk / Reward**, **Result** and **Week** — the
calculated values, shown before saving so a wrong stop loss is obvious while it's still
free to fix.

**Saved** — confirmation, a link to the sheet, and a button to journal the next trade.

The whole thing follows your system light/dark theme and works on a phone. No dashboard, no
charts, no statistics — the spec asked for a text box, and that's what this is.

---

## Node 14 — Tested

Ran the exact Gold example from [prompt.md](prompt.md) through it:

| Field | Extracted | Note |
|---|---|---|
| Asset / Symbol | Gold / XAUUSD | ticker worked out from "Gold" |
| Buy / Sell | BUY | from "bought" |
| Entry / Stop / Target | 3385.2 / 3381.5 / 3397 | |
| Exit Price | 3397 | inferred from *"price hit target"* |
| Lot Size | 0.03 | |
| Session | LONDON | from "around London open" |
| Setup | liquidity sweep | |
| Emotion Before | emotional | |
| Lessons Learned | should have waited for candle confirmation | |
| Risk Reward | **3.19** | calculated: 11.8 ÷ 3.7 |
| Result | **WIN** | calculated |
| Week / Month / Year | 31 / July / 2026 | calculated |

**The most important result is what it left blank.** PnL stayed empty — even though entry,
exit and lot size were all present, which is enough to compute it. That's rule 2 holding
under pressure. An AI that helpfully guessed a profit figure here would have quietly poisoned
every future number in the journal.

Save wrote to `Trades!A3:AJ3` — column AJ is the 36th, so every field reaches the sheet.

> One row in your sheet says `PHASE 2 SAVE TEST - delete me`. Safe to delete.

---

---

## Node 15 — Several trades in one message ✅

Found in real use: describing two trades in one go only captured the first.

**The response shape changed.** Gemini now always returns a *list* of trades, never a single
object. One trade is just a list of one. Making the list the normal shape means multi-trade
is the main path rather than a special case bolted on the side — every layer below
(`/api/extract`, `/api/save`, the sheet writer, the UI) handles one and five identically.

### Deciding where one trade ends and the next begins

This is the part that needed care, because **over-splitting is worse than under-splitting**.
A merged trade is obvious the moment you look at the review panel. A phantom third trade
invented out of a stray sentence is something you have to notice and delete, and if you miss
it, it silently distorts every statistic later.

So the prompt makes the rule explicit, and biases toward merging when unsure:

| Two trades | One trade |
|---|---|
| Different instruments | One position described across many sentences |
| Same instrument entered, exited, entered again | Reflection, emotion or lessons added afterwards |
| They say "second trade", "then I also…" | Scaling in or out of one position |
| | Moving the stop on one position |

Details you mention once but that apply to everything — the date, the session, your mood that
day — get copied onto each trade they apply to.

### Saving

All rows go in **one** append call, so journaling three trades either lands all three or
none. Looping one call per trade would risk a half-written batch if the connection dropped
midway. Each trade still gets its own Trade ID, week number and risk-reward — derived
individually, not shared.

### The interface

With more than one trade found, a **tab strip** appears above the form — `1 Gold BUY`,
`2 Nifty SELL` — so several trades stay reviewable without endless scrolling. Each tab has an
**✕** to drop a trade the AI split wrongly, and the save button reads *"Save 3 trades"* so
the count is confirmed before writing. A single trade looks exactly as it did before; the
tabs simply don't appear.

### Tested

| Input | Expected | Got |
|---|---|---|
| Gold long, then Nifty short | 2 | **2** ✓ |
| One Gold trade over 6 sentences of reflection | 1 | **1** ✓ |
| "Three trades today" — EURUSD, BTC, Nifty | 3 | **3** ✓ |

Details held up throughout: *"half a lot"* → `0.5`; *"stopped me out"* → exit price = the
stop; Nifty short with stop 24900 and target 24700 → risk-reward **3**, result **LOSS**.

And the rule still holds under the new shape — risk-reward came back **blank** on the trades
where no target was mentioned, rather than being invented.

---

## Next: Phase 3 — daily-use polish

Nothing is blocking journaling now. Likely next steps, in rough order of usefulness:

1. **Instrument registry + automatic PnL** — the biggest missing piece. Needs contract sizes
   so "0.03 lots of Gold" becomes money.
2. **Editing a saved trade** — currently a mistake means fixing it in the sheet by hand.
3. **Recent trades list** — see the last few without opening Sheets.
4. **Voice input** — speak the trade instead of typing it.

Say which matters most and we'll do that one.
