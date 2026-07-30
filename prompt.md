# AI Trading Journal - Personal Project Specification

## Project Overview

Build a **personal AI-powered trading journal** whose primary goal is to eliminate manual trade journaling.

This is **not** a SaaS product. It is a personal productivity tool that I will use daily. Prioritize practicality, speed, maintainability, and accuracy over visual complexity.

The application should feel like talking to ChatGPT while automatically maintaining a structured trading journal in Google Sheets.

---

# Primary Goal

Instead of manually filling Excel or Google Sheets after every trade, I want to simply explain my trade in natural language exactly like I would explain it to another trader.

Example:

> I bought Gold today around London open at 3385.20 with 0.03 lots after a liquidity sweep above Asia high. My stop loss was 3381.50 and target was 3397. I got emotional because I missed the first entry so I entered a bit late. Eventually price hit target. Looking back I think I should have waited for candle confirmation.

The AI should:

* Understand everything.
* Extract structured information.
* Detect missing information.
* Ask follow-up questions only for required fields.
* Save the completed trade automatically.
* Give immediate feedback on the trade.
* Build a database that can later be analyzed for recurring mistakes.

The application should remove almost all manual work from journaling.

---

# Core Philosophy

The application should behave like an AI trading assistant rather than a form.

The user should almost never have to manually fill fields.

Conversation first.

Structured data second.

---

# Technology Stack

## Frontend

* Next.js (latest App Router)
* TypeScript
* Tailwind CSS
* shadcn/ui
* React Hook Form (only where needed)
* Lucide Icons

Keep the UI clean and minimal.

No unnecessary animations.

No dashboards filled with meaningless charts.

Fast.

Responsive.

Easy to use.

---

## AI

Use OpenAI Responses API (preferred).

Design prompts so the AI always returns structured JSON for extracted fields.

The AI must:

* Extract information
* Detect missing fields
* Ask follow-up questions
* Categorize mistakes
* Categorize emotions
* Generate observations
* Give coaching suggestions

---

## Database

Primary storage:

Google Sheets

Do NOT use PostgreSQL.

Do NOT use Supabase.

Google Sheets is the database.

One row = one trade.

---

## File Storage

Google Drive

Store:

* Screenshots
* Weekly reports
* Monthly reports
* Future exported PDFs

The Sheet should store the Drive link.

---

## Authentication

Google OAuth.

The application should have access only to my own Drive and Sheets.

No multi-user logic.

No organization support.

No roles.

Single-user application.

---

# Google Sheets Design

The AI should automatically maintain one master workbook.

If the current sheet reaches Google's maximum row limit, automatically:

* Create a new sheet
* Continue writing there
* Keep naming consistent

Example:

Trades_1

Trades_2

Trades_3

The user should never need to think about this.

Everything should happen automatically.

---

# Required Trade Columns

Every trade should eventually contain:

Trade ID

Date

Time

Timezone

Week Number

Month

Year

Asset

Symbol

Buy / Sell

Entry Price

Exit Price

Stop Loss

Target

Risk Reward

Lot Size

Position Size

Session

Market Condition

Setup Name

Strategy Used

Reason for Entry

Reason for Exit

Emotion Before Trade

Emotion During Trade

Emotion After Trade

Confidence Rating (1-10)

Trade Quality Score

Mistake Category

Rule Broken

Result

PnL

PnL %

Holding Time

Screenshot Link

TradingView Link

Lessons Learned

Additional Notes

AI Observation

AI Suggestion

Created Timestamp

Updated Timestamp

---

# Conversation Flow

The experience should feel exactly like talking to ChatGPT.

User:

"I bought Gold."

AI:

"What was your entry?"

User:

"3385"

AI:

"Stop loss?"

User:

"3381"

AI:

"Target?"

Continue until all required fields exist.

Only ask questions for missing required information.

Never ask unnecessary questions.

---

# Natural Language Understanding

The AI should understand casual language.

Examples:

"I bought gold"

"Longed XAU"

"Went long"

"Bought XAUUSD"

All mean:

BUY

Likewise:

"Shorted"

"Sold"

"Bearish entry"

should map to

SELL

Understand abbreviations.

Understand trading terminology.

Understand casual English.

---

# Automatic Calculations

Calculate automatically whenever possible:

Risk Reward

Holding Time

Profit/Loss

Win Rate

Average RR

Risk %

Trade Duration

Trade Number

Week Number

Month

Quarter

Year

Do not ask the user for values that can be calculated.

---

# AI Suggestions

Immediately after saving a trade, provide useful coaching.

Example:

You entered before confirmation.

Your stop loss placement was good.

RR was excellent.

Emotion affected execution.

You broke your own rule.

Your patience was good today.

Suggestions should be short, actionable, and based on the user's journal, not generic trading advice.

---

# Mistake Detection

The AI should categorize recurring mistakes.

Examples:

FOMO

Revenge Trading

Moved Stop Loss

Closed Early

Entered Early

No Confirmation

Overtrading

Poor Risk Management

Ignored Trend

Counter Trend

News Trading

No Setup

Greed

Fear

Impatience

The categories should remain consistent over time so historical analysis is meaningful.

---

# Weekly Review

The AI should analyze all trades from the previous week.

Generate:

Win Rate

Average RR

Average Holding Time

Most Profitable Setup

Worst Performing Setup

Most Common Mistake

Most Common Emotion

Session Performance

Average Confidence

Rule Violations

Three things done well

Three improvements for next week

---

# Monthly Review

Provide a detailed coaching report.

Examples:

Your biggest weakness is entering before candle confirmation.

82% of losing trades happened after your first loss of the day.

Your best setup has a 71% win rate.

You consistently perform better during London Session.

Your average RR is increasing every month.

Your confidence score does not correlate with actual results.

Generate observations only from actual journal data.

---

# Search

The AI should answer questions like:

Show all losing Gold trades.

Show all FOMO trades.

Show every London Session winner.

Which setup performs best?

How many revenge trades did I take?

What mistakes repeat the most?

Which weekday do I lose the most?

Show trades where confidence was above 8 but I still lost.

---

# Future Features

Design the architecture so these can be added later:

Screenshot analysis

TradingView integration

Automatic chart upload

Voice journaling

Speech-to-text

PDF reports

Calendar view

Performance graphs

RAG over journal history

Custom strategy tracking

Playbook generation

AI coach

Daily reminders

---

# UI Requirements

The UI should feel like ChatGPT.

Main screen:

Conversation window.

Input box.

Optional screenshot upload.

Sidebar containing:

Trade History

Weekly Review

Monthly Review

Settings

Google Connection Status

No complex dashboards.

No unnecessary statistics on the home page.

The conversation should always be the primary interface.

---

# Code Quality

Use clean architecture.

Separate:

AI extraction

Google Sheets service

Google Drive service

Prompt management

Business logic

Calculations

UI

Avoid putting business logic inside components.

Keep everything modular and easy to extend.

---

# Success Criteria

The application is successful if I can finish a trade, open the app, describe it naturally in one conversation, answer a few follow-up questions if needed, and have everything automatically extracted, validated, calculated, categorized, and stored in Google Sheets without touching a spreadsheet manually.

After 100–200 trades, I should be able to ask the AI questions about my trading behavior and receive data-backed insights that help me become a better trader. The application should become an AI trading coach built from my own trading history rather than just a digital notebook.
