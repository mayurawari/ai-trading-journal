# AI Trading Journal — Architecture

> Status: **Planning.** Scope deliberately minimal.

---

## 1. Scope

One job:

```
I type my trade in plain English  →  AI extracts the fields  →  row appended to Google Sheets
```

That is the whole product for v1. Everything else in `prompt.md` is deferred to §9.

**Not building now:** coaching, AI suggestions, mistake detection, weekly/monthly reviews,
analytics, search over history, quality scores, screenshots, dashboards. No columns in the
sheet are populated by AI *opinion* — only by AI *reading what I wrote*.

---

## 2. Flow

```
┌──────────────┐   1. paste trade text
│   Text box   │ ─────────────────────────┐
└──────────────┘                          ▼
                                  ┌───────────────┐
                                  │ POST /extract │  OpenAI, strict JSON schema
                                  └───────┬───────┘
                                          │ 2. extracted fields
                                          ▼
                              ┌───────────────────────┐
                              │  Review panel         │  3. I eyeball / fix / fill blanks
                              │  (editable, prefilled)│
                              └───────────┬───────────┘
                                          │ 4. click Save
                                          ▼
                                  ┌───────────────┐
                                  │  POST /save   │ → appends row
                                  └───────────────┘
                                          ▼
                                   Google Sheet
```

**Design choice — review panel instead of a chat loop.** The original spec described a
ChatGPT-style back-and-forth for missing fields. A prefilled editable panel is strictly better
here: filling a blank box is faster than a question-and-answer round trip, and it lets me
catch a misread number *before* it reaches the sheet rather than correcting it after. It also
removes conversation state, follow-up logic, and turn management from the build entirely.

The text box can still stay chat-shaped visually. Say if you'd rather have the real
conversational loop — it's an additive change, not a redesign.

---

## 3. The one architectural decision that matters

**The sheet's header row is the schema.**

Column names are not hardcoded in the app. On save, the app reads row 1 of the sheet and maps
extracted values to headers by name. Consequences:

- Adding, removing, or reordering a column is a **spreadsheet edit**, not a code change.
- A column the AI has no value for is left blank. Nothing breaks.
- The 45 columns in `prompt.md` can be trimmed to whatever I actually want without touching code.

One config file tells the AI what each column means:

```ts
// core/fields.ts
{ header: "Entry Price", type: "number",
  desc: "Price the position was opened at" },
{ header: "Buy / Sell",  type: "enum", values: ["BUY","SELL"],
  desc: "Direction. 'longed', 'bought', 'bullish' → BUY; 'shorted', 'sold' → SELL" },
```

This file generates both the extraction JSON schema and the review panel. **It is the only
file to edit when the journal format changes.**

---

## 4. Components

| Piece | Responsibility |
|---|---|
| `app/page.tsx` | Text box + review panel. No logic. |
| `app/api/extract/route.ts` | Text → Gemini → validated JSON. Writes nothing. |
| `app/api/save/route.ts` | Confirmed fields → sheet rows |
| `core/fields.ts` | Column definitions — the single source of truth |
| `core/derive.ts` | The handful of computed fields (§6) |
| `services/gemini/schema.ts` | Field list → Gemini response schema |
| `services/gemini/extract.ts` | Prompt + API call + number coercion |
| `services/google/auth.ts` | OAuth, token storage and refresh |
| `services/google/sheets.ts` | Create once, read headers, append rows |
| `lib/store.ts` | Local JSON files for tokens and sheet id |

Ten files of substance. `core/` stays free of I/O so field logic is testable without mocks.

---

## 5. Extraction contract

**Provider: Google Gemini** (`gemini-2.5-flash`), chosen over the OpenAI Responses API named
in `prompt.md` because Gemini has a genuinely free tier — no card, no credits — which makes
the whole project free to run. Same Google account as the Sheets side.

- Structured output via `responseMimeType: "application/json"` + `responseSchema`.
- Schema generated from `core/fields.ts`.
- **The response is always a list of trades**, never a single object. One message often
  describes several trades, so the list is the normal shape and a single trade is a list of
  one — rather than multi-trade being a special case bolted on later.
- **Every field nullable.** `null` = not mentioned. The AI must never guess a price, and an
  unmentioned field must arrive as blank rather than as a plausible invention — this is the
  main correctness risk in the whole app.
- Enum fields constrained by the schema, so "BUY"/"SELL" can't come back as "long".
- One retry on malformed output, then surface the raw text so nothing is silently lost.

---

## 6. Derived fields

Only compute what needs no extra configuration:

| Field | From |
|---|---|
| Trade ID | timestamp-based |
| Date | stated date, else today (IST) |
| Time | stated time, else blank |
| Timezone | always `IST` |
| Week / Month / Year | the date |
| Created Timestamp | now (IST) |
| Risk Reward | entry, stop loss, target — if all three present |
| Result | WIN / LOSS / BE from stated PnL, if stated |

**PnL is not computed.** Working it out from lot size requires per-instrument contract specs
(0.03 lots of Gold means nothing without knowing Gold's contract size). For v1: if I state
the PnL, it gets extracted; if not, the cell stays blank. The instrument registry is a §9 item
— it's real work and not needed to make journaling stop being manual.

Anything derived is never shown as a question and never asked for.

---

## 7. Google access

- Google OAuth, scopes `drive.file` + `userinfo.email` — **both non-sensitive**, so Google
  requires no app verification. Access is limited to files this app created itself, never
  the rest of the Drive. The broad `spreadsheets` scope is deliberately avoided: it is
  classed sensitive and would force a verification review, and the Sheets API accepts
  `drive.file` for every call this app makes.
- Single account allow-listed in env.
- Refresh token stored server-side; all API calls server-side.
- The app creates the spreadsheet once, then stores its ID in config. Every save appends to
  that same sheet — see §10. No `Trades_1`/`Trades_2` rollover; at a few hundred trades a year
  those limits are decades away. Deferred to §9.

---

## 8. Build order

**Phase 1 — Write path.** OAuth, create the sheet, write headers, append a hardcoded row.
*Done when:* clicking the button twice leaves **two rows in one sheet** — not two sheets.

**Phase 2 — Extraction.** `fields.ts`, schema generation, `/extract`.
*Done when:* pasting the Gold example from `prompt.md` returns correct JSON in the terminal.

**Phase 3 — UI.** Text box, review panel, save.
*Done when:* a real trade goes from text to sheet in one screen.

Phase 1 first because Google auth is the only part with unknown friction — worth hitting early,
before any AI work depends on it.

---

## 9. Deferred

Kept out of v1 on purpose. None of these require restructuring later; the header-driven schema
and the `core`/`services` split are what keep them additive.

Coaching and AI suggestions · mistake detection · emotion categorisation · weekly and monthly
reviews · stats and search over history · trade quality score · conversational follow-up loop ·
instrument registry and automatic PnL · screenshot upload · sheet rollover · corrections and
editing past trades · voice input.

---

## 10. Decisions made

**Columns — keep only what something can fill.** Six of the 45 in `prompt.md` are dropped
because nothing in v1 produces them:

> Trade Quality Score · Mistake Category · AI Observation · AI Suggestion *(all removed with
> coaching)* · Screenshot Link *(no upload yet)* · Updated Timestamp *(no editing yet)*

**36 columns remain.** Every one is fillable — either extracted from what I write, or derived
(§6). A column stays blank only when I didn't mention it, never because the app can't handle
it. Adding any of the six back later is a spreadsheet edit plus one line in `core/fields.ts`.

**Spreadsheet — one sheet, forever.** The app creates the spreadsheet once on first run and
writes the header row. After that it **only ever appends rows to that same sheet.** Never a
new sheet, never a new tab, never a new file — one trade is one new row, exactly as
`prompt.md` says. The sheet ID is saved in config after creation, so every later save targets
the same file. Phase 1's test entry is what proves this: after two test saves the sheet must
show two rows, not two sheets.

**Timezone — IST (Asia/Kolkata).** All dates and times recorded in Indian Standard Time.
Stored explicitly in the `Timezone` column so it stays unambiguous if I ever travel or switch.
