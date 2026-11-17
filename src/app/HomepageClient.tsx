"use client";

import { useCallback, useEffect, useState } from "react";

export interface ConnectionStatus {
  connected: boolean;
  email?: string;
  environment?: "real" | "test";
  sheet?: { url: string; trades: number | null } | null;
}

interface EconomicEvent {
  id: string;
  title: string;
  country: string;
  date: string;
  impact: string;
  forecast: string;
  previous: string;
  affectedAssets: string[];
  formattedTimeIST: string;
  formattedTimeEST: string;
  isPast: boolean;
}

const SAMPLE_TRADES = [
  {
    asset: "XAUUSD",
    direction: "BUY",
    entry: "3990.00",
    exit: "4010.00",
    sl: "3980.00",
    lot: "0.05",
    rr: "2.00 R",
    pnl: "+$100.00",
    session: "London Session",
    condition: "Trending Smoothly",
    setup: "Breakout + Retest",
    reasonEntry: "Clean H1 structure break with volume expansion",
    reasonExit: "Take Profit Target hit at 4010 resistance",
    emotionBefore: "Calm & Patient",
    emotionDuring: "Calm & Detached",
    emotionAfter: "Satisfied (Followed Plan)",
    adherence: "FOLLOWED (100%)",
    mistakes: "NONE",
  },
  {
    asset: "EURUSD",
    direction: "SELL",
    entry: "1.0850",
    exit: "1.0805",
    sl: "1.0875",
    lot: "1.00",
    rr: "1.80 R",
    pnl: "+$450.00",
    session: "New York Session",
    condition: "News Volatility (Post-CPI)",
    setup: "Liquidity Sweep",
    reasonEntry: "Asian high swept with immediate bearish engulfing",
    reasonExit: "Hit pre-planned 1.0805 key demand zone",
    emotionBefore: "Focused & Ready",
    emotionDuring: "Confident & Patient",
    emotionAfter: "Satisfied (Followed Plan)",
    adherence: "FOLLOWED (100%)",
    mistakes: "NONE",
  },
  {
    asset: "NIFTY 50",
    direction: "BUY",
    entry: "24820",
    exit: "24960",
    sl: "24760",
    lot: "50",
    rr: "2.33 R",
    pnl: "+₹7,000",
    session: "Asia / IST Regular",
    condition: "Morning Gap & Go",
    setup: "Order Block Bounce",
    reasonEntry: "15m fair value gap filled after gap-up open",
    reasonExit: "Trailing stop hit near daily resistance 2",
    emotionBefore: "Patient",
    emotionDuring: "Relaxed",
    emotionAfter: "Satisfied",
    adherence: "FOLLOWED (100%)",
    mistakes: "NONE",
  },
];

const SHEET_CATEGORIES = [
  {
    id: "execution",
    label: "Execution & Identity",
    count: 11,
    cols: [
      { name: "Trade ID", desc: "Collision-resistant hash (e.g. T-20261117-091522-a1f4)" },
      { name: "Date", desc: "Session execution date (YYYY-MM-DD)" },
      { name: "Time", desc: "Opening timestamp in IST 24-hour" },
      { name: "Timezone", desc: "Standardized to Asia/Kolkata (IST)" },
      { name: "Week Number", desc: "ISO-8601 week number for weekly performance reviews" },
      { name: "Month & Year", desc: "Normalized calendar period markers" },
      { name: "Asset & Symbol", desc: "Plain instrument & standardized ticker (Gold -> XAUUSD)" },
      { name: "Buy / Sell", desc: "Strict execution direction" },
      { name: "Entry Price", desc: "Verified opening price" },
      { name: "Exit Price", desc: "Verified closing price" },
      { name: "Stop Loss & Target", desc: "Pre-planned risk boundary and take-profit target" },
    ],
  },
  {
    id: "math",
    label: "Mathematics & Outcome",
    count: 5,
    cols: [
      { name: "Risk Reward (R:R)", desc: "Calculated ratio of planned reward vs. planned risk" },
      { name: "Lot Size", desc: "Contracts, lots, or shares executed" },
      { name: "Gross PnL", desc: "Computed via exact contract multiplier (100oz Gold, 100k FX)" },
      { name: "Result", desc: "Automated classification: WIN, LOSS, BE, or MANUAL_CLOSE" },
      { name: "Created Timestamp", desc: "Deterministic audit timestamp of sheet write" },
    ],
  },
  {
    id: "context",
    label: "Market Context & Setup",
    count: 6,
    cols: [
      { name: "Session", desc: "Trading window: ASIA, LONDON, NEW YORK, or OVERLAP" },
      { name: "Market Condition", desc: "Trending Smoothly, Choppy / Ranging, News Volatility" },
      { name: "Setup Name", desc: "Named execution pattern (Breakout, Order Block, Liquidity)" },
      { name: "Strategy Used", desc: "Broader trading system / framework" },
      { name: "Reason for Entry", desc: "Exact technical confluence and trigger in your own words" },
      { name: "Reason for Exit", desc: "Closing rationale (Hit TP, Hit SL, Trailing Stop, Manual)" },
    ],
  },
  {
    id: "psychology",
    label: "Psychology & Discipline",
    count: 6,
    cols: [
      { name: "Emotion Before", desc: "Mindset prior to execution (Calm, Confident, Anxious, FOMO)" },
      { name: "Emotion During", desc: "State while holding trade (Calm, Anxious, Tempted to exit early)" },
      { name: "Emotion After", desc: "Post-close reflection (Satisfied, Relieved, Regretful)" },
      { name: "Rule Adherence", desc: "Plan compliance: FOLLOWED (100%), PARTIAL, BROKE RULES" },
      { name: "Execution Mistakes", desc: "NONE, FOMO, REVENGE, EARLY ENTRY, MOVED SL, OVERTRADING" },
      { name: "Rule Broken", desc: "Specific rule violated if broken" },
    ],
  },
  {
    id: "daily",
    label: "Daily Reflection (Tab 2)",
    count: 13,
    cols: [
      { name: "Date", desc: "Trading session date (YYYY-MM-DD)" },
      { name: "Sleep & Energy", desc: "Physical energy level (HIGH, MODERATE, LOW)" },
      { name: "Dominant Emotion", desc: "Primary emotional posture before session" },
      { name: "Starting & Ending Balance", desc: "Account equity balance for daily PnL auditing" },
      { name: "Limits Followed", desc: "Did you respect your daily loss and max trade ceiling?" },
      { name: "Impulsive / Revenge", desc: "Tracking non-system trades (NONE, IMPULSIVE, REVENGE)" },
      { name: "Valid Setups Skipped", desc: "Hesitation tracking on valid triggers" },
      { name: "Biggest Mistake & Best Decision", desc: "Qualitative behavioral audit for the day" },
      { name: "One Thing to Improve", desc: "Primary actionable focus for tomorrow's session" },
    ],
  },
];

const FAQS = [
  {
    question: "Where is my trading data stored?",
    answer:
      "Directly inside your personal Google Drive in your own Google Sheet. Ledgerstone operates on a zero-knowledge architecture: we never store your trades, balances, or financial data on our servers. You maintain 100% sovereign ownership of your trading records forever.",
  },
  {
    question: "What permissions does Google OAuth ask for?",
    answer:
      "Ledgerstone requests strictly the `drive.file` scope. This security standard means Ledgerstone can ONLY view and edit spreadsheets created by Ledgerstone itself. It has zero access to your other Google Drive files, personal photos, or private documents.",
  },
  {
    question: "How does the conversational logging work?",
    answer:
      "You describe your trades naturally in plain English (e.g. 'Bought 0.05 lots of Gold at 3990, SL 3980, TP 4010'). Ledgerstone extracts the positions, verifies mandatory parameters (Entry, Stop Loss, Target, Lot Size), asks targeted follow-up questions for any missing fields with quick-reply chips, and writes the validated record to your sheet.",
  },
  {
    question: "Are profit and loss (PnL) and Risk-Reward (R:R) numbers guessed by AI?",
    answer:
      "No. Ledgerstone enforces the Sacred Law of Zero Hallucination: numbers, Risk-Reward ratios, contract multipliers (100 oz per Gold lot, 100,000 units per Forex lot), and Win/Loss statuses are derived deterministically using pure mathematical formulas. The AI is used strictly for linguistic comprehension.",
  },
  {
    question: "What is the Dual-Environment (Real vs Demo) feature?",
    answer:
      "You can switch between your Real/Live Journal and a Demo & Testing Journal with a single click. Both tabs maintain independent spreadsheets, separate Google Drive IDs, and scoped deduplication so test trades never pollute your real funded trading metrics.",
  },
];

function readClientAuthHint(): ConnectionStatus | null {
  if (typeof window === "undefined") return null;
  try {
    const match = document.cookie.match(/(?:^|;\s*)ledgerstone_user=([^;]+)/);
    const email = match ? decodeURIComponent(match[1]).trim() : localStorage.getItem("ledgerstone_user_hint");
    if (email && email.includes("@")) {
      return { connected: true, email };
    }
  } catch {}
  return null;
}

export default function HomepageClient({ initialStatus }: { initialStatus?: ConnectionStatus }) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    initialStatus ?? { connected: false },
  );
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [activeSampleIndex, setActiveSampleIndex] = useState(0);
  const [activeSheetTab, setActiveSheetTab] = useState("execution");
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);
  const [upcomingEvents, setUpcomingEvents] = useState<EconomicEvent[]>([]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      setConnectionStatus(data);
      if (typeof window !== "undefined") {
        if (data.connected && data.email) {
          try {
            localStorage.setItem("ledgerstone_user_hint", data.email);
          } catch {}
        } else if (!data.connected) {
          try {
            localStorage.removeItem("ledgerstone_user_hint");
          } catch {}
        }
      }
    } catch {
      setConnectionStatus((prev) => prev);
    } finally {
      setIsLoadingStatus(false);
    }
  }, []);

  const fetchNews = useCallback(async () => {
    try {
      const res = await fetch("/api/news");
      const data = await res.json();
      if (data.ok && Array.isArray(data.events)) {
        setUpcomingEvents(data.events.slice(0, 5));
      }
    } catch {
      setUpcomingEvents([]);
    }
  }, []);

  useEffect(() => {
    if (!initialStatus?.connected) {
      const hint = readClientAuthHint();
      if (hint) {
        setConnectionStatus(hint);
      }
    }
    void fetchStatus();
    void fetchNews();
  }, [fetchStatus, fetchNews, initialStatus]);

  const activeSample = SAMPLE_TRADES[activeSampleIndex];
  const activeCategory = SHEET_CATEGORIES.find((c) => c.id === activeSheetTab) || SHEET_CATEGORIES[0];

  return (
    <div className="min-h-screen bg-[#f1f0ea] text-[#2d232e] font-body selection:bg-[#2d232e] selection:text-[#f1f0ea]">
      <header id="top-navigation" className="sticky top-0 z-50 border-b-2 border-[#2d232e] bg-[#f1f0ea]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6 py-3.5">
          <a href="/" className="flex items-center gap-2.5 group">
            <div className="relative size-9 rounded-lg border-2 border-[#2d232e] overflow-hidden bg-[#2d232e] shadow-xs">
              <img src="/icon.jpg" alt="Ledgerstone" className="size-full object-cover" />
            </div>
            <div>
              <span className="font-heading text-lg font-bold tracking-tight text-[#2d232e] leading-none block">
                Ledgerstone
              </span>
              <span className="font-heading text-[10px] font-bold uppercase tracking-widest text-[#534b52]">
                Every trade leaves a mark
              </span>
            </div>
          </a>

          <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-[#534b52]">
            <a href="#how-it-works" className="hover:text-[#2d232e] transition">How It Works</a>
            <a href="#pillars" className="hover:text-[#2d232e] transition">Pillars</a>
            <a href="#sheet-vault" className="hover:text-[#2d232e] transition">32-Column Vault</a>
            <a href="#catalyst-radar" className="hover:text-[#2d232e] transition">Catalyst Radar</a>
            <a href="#faq" className="hover:text-[#2d232e] transition">FAQ</a>
          </nav>

          <div className="flex items-center gap-2.5">
            {!isLoadingStatus && connectionStatus?.connected ? (
              <div className="flex items-center gap-2">
                <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-[#534b52]/30 bg-[#e0ddcf] px-2.5 py-1 text-[11px] font-medium text-[#2d232e]">
                  <span className="size-1.5 rounded-full bg-[#2d232e]" />
                  {connectionStatus.email?.split("@")[0]}
                </span>
                <a
                  href="/journal"
                  className="font-heading inline-flex items-center gap-1.5 rounded-lg bg-[#2d232e] px-4 py-2 text-xs font-bold text-[#f1f0ea] shadow-xs transition hover:bg-[#474448] active:scale-95"
                >
                  Launch Journal &rarr;
                </a>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <a
                  href="/journal?mode=demo"
                  className="font-heading hidden sm:inline-flex items-center gap-1.5 rounded-lg border-2 border-[#2d232e] bg-transparent px-3.5 py-1.5 text-xs font-bold text-[#2d232e] hover:bg-[#e0ddcf] transition active:scale-95"
                >
                  <span>▲ Try Demo Sandbox</span>
                </a>
                <a
                  href="/api/auth/google"
                  className="font-heading inline-flex items-center gap-1.5 rounded-lg bg-[#2d232e] px-4 py-2 text-xs font-bold text-[#f1f0ea] shadow-xs transition hover:bg-[#474448] active:scale-95"
                >
                  Connect with Google &rarr;
                </a>
              </div>
            )}
          </div>
        </div>
      </header>

      <section id="hero" className="relative border-b-2 border-[#2d232e] px-4 sm:px-6 pt-12 pb-16 sm:pt-20 sm:pb-24">
        <div className="mx-auto max-w-5xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border-2 border-[#2d232e] bg-[#e0ddcf] px-3.5 py-1 mb-6 shadow-xs">
            <span className="size-2 rounded-full bg-[#2d232e] animate-pulse" />
            <span className="font-heading text-[11px] font-bold uppercase tracking-wider text-[#2d232e]">
              Institutional Execution Journal &bull; Zero SaaS Lock-in
            </span>
          </div>

          <h1 className="font-heading text-3xl sm:text-5xl md:text-6xl font-bold tracking-tight text-[#2d232e] leading-[1.1] mb-6">
            Master Your Execution.
            <br />
            <span className="underline decoration-[#534b52]/40 decoration-4 underline-offset-8">
              Eliminate Spreadsheet Fatigue.
            </span>
          </h1>

          <p className="mx-auto max-w-2xl text-sm sm:text-base leading-relaxed text-[#534b52] mb-8 font-body">
            Stop wasting 30 minutes every evening manually copying tickets. Describe your trades in natural language—Ledgerstone extracts positions, verifies stop loss and sizing, conducts an 11-step psychological audit, and logs structured records directly to your private Google Sheet.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 mb-10">
            <a
              href="/journal?mode=demo"
              className="font-heading inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-[#2d232e] px-6 sm:px-8 py-3.5 text-sm font-bold text-[#f1f0ea] shadow-sm hover:bg-[#474448] active:scale-98 transition cursor-pointer"
            >
              ▲ Try Demo Sandbox (No Login Required) &rarr;
            </a>
            <a
              href={connectionStatus?.connected ? "/journal" : "/api/auth/google"}
              className="font-heading inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl border-2 border-[#2d232e] bg-[#f1f0ea] px-6 sm:px-8 py-3.5 text-sm font-bold text-[#2d232e] hover:bg-[#e0ddcf] active:scale-98 transition cursor-pointer"
            >
              {connectionStatus?.connected ? "Open Live Journal" : "Connect with Google Drive"}
            </a>
          </div>

          <div aria-label="trust-badges" className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 max-w-3xl mx-auto pt-2 text-left">
            <div className="rounded-lg border border-[#534b52]/30 bg-[#e0ddcf]/60 p-2.5">
              <span className="font-heading block text-[11px] font-bold uppercase tracking-wider text-[#2d232e]">
                100% Sovereign
              </span>
              <span className="font-body text-[11px] text-[#534b52]">Lives in your Google Drive</span>
            </div>
            <div className="rounded-lg border border-[#534b52]/30 bg-[#e0ddcf]/60 p-2.5">
              <span className="font-heading block text-[11px] font-bold uppercase tracking-wider text-[#2d232e]">
                Zero Cloud Storage
              </span>
              <span className="font-body text-[11px] text-[#534b52]">No trades on our servers</span>
            </div>
            <div className="rounded-lg border border-[#534b52]/30 bg-[#e0ddcf]/60 p-2.5">
              <span className="font-heading block text-[11px] font-bold uppercase tracking-wider text-[#2d232e]">
                Deterministic Math
              </span>
              <span className="font-body text-[11px] text-[#534b52]">R:R & multipliers derived</span>
            </div>
            <div className="rounded-lg border border-[#534b52]/30 bg-[#e0ddcf]/60 p-2.5">
              <span className="font-heading block text-[11px] font-bold uppercase tracking-wider text-[#2d232e]">
                Real &bull; Demo Dual
              </span>
              <span className="font-body text-[11px] text-[#534b52]">Partitioned sandbox mode</span>
            </div>
          </div>
        </div>
      </section>

      <section id="execution-showcase" className="border-b-2 border-[#2d232e] bg-[#e0ddcf]/40 px-4 sm:px-6 py-12 sm:py-16">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <span className="font-heading text-xs font-bold uppercase tracking-wider text-[#534b52]">
                Interactive Demonstration
              </span>
              <h2 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight text-[#2d232e]">
                From Natural Dialogue to Structured Math
              </h2>
            </div>
            <div role="tablist" aria-label="sample-instruments" className="flex items-center gap-1.5 p-1 rounded-lg border-2 border-[#2d232e] bg-[#f1f0ea]">
              {SAMPLE_TRADES.map((sample, idx) => (
                <button
                  key={sample.asset}
                  onClick={() => setActiveSampleIndex(idx)}
                  className={`font-heading px-3 py-1 rounded text-xs font-bold tracking-wider transition cursor-pointer ${
                    activeSampleIndex === idx
                      ? "bg-[#2d232e] text-[#f1f0ea]"
                      : "text-[#534b52] hover:text-[#2d232e]"
                  }`}
                >
                  {sample.asset}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div aria-label="natural-input-card" className="lg:col-span-5 rounded-xl border-2 border-[#2d232e] bg-[#f1f0ea] p-5 shadow-xs flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3 border-b border-[#e0ddcf] pb-2">
                  <span className="font-heading text-xs font-bold uppercase tracking-wider text-[#534b52]">
                    Natural Input
                  </span>
                  <span className="font-heading text-[10px] rounded bg-[#e0ddcf] px-2 py-0.5 font-bold uppercase text-[#2d232e]">
                    Trader Voice / Text
                  </span>
                </div>
                <div className="font-body text-xs sm:text-sm leading-relaxed text-[#2d232e] bg-[#e0ddcf]/30 rounded-lg p-3.5 border border-[#534b52]/20">
                  &ldquo;I {activeSample.direction === "BUY" ? "longed" : "shorted"} {activeSample.lot} lots of {activeSample.asset} at {activeSample.entry}, stop loss was {activeSample.sl}, and exited at {activeSample.exit}. It was a {activeSample.setup} during {activeSample.session}. {activeSample.reasonEntry}. Emotion: {activeSample.emotionBefore}. Followed plan 100%.&rdquo;
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-[#e0ddcf] text-xs text-[#534b52]">
                <span className="font-heading font-bold text-[#2d232e]">Zero Hallucination</span>: Prices, stop loss, and contract sizing are extracted strictly as stated. R:R and Gross PnL are derived with zero rounding drift.
              </div>
            </div>

            <div aria-label="structured-record-card" className="lg:col-span-7 rounded-xl border-2 border-[#2d232e] bg-[#f1f0ea] p-5 shadow-xs">
              <div className="flex items-center justify-between mb-3 border-b border-[#e0ddcf] pb-2">
                <div className="flex items-center gap-2">
                  <span className="font-heading text-sm font-bold text-[#2d232e]">{activeSample.asset}</span>
                  <span className="font-heading rounded bg-[#2d232e] px-2 py-0.5 text-[10px] font-bold text-[#f1f0ea]">
                    {activeSample.direction}
                  </span>
                  <span className="font-heading rounded border border-[#2d232e] bg-[#e0ddcf] px-1.5 py-0.5 text-[9px] font-bold text-[#2d232e]">
                    VERIFIED
                  </span>
                </div>
                <span className="font-heading text-xs font-bold text-[#2d232e]">{activeSample.pnl} ({activeSample.rr})</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-3">
                <div className="rounded border border-[#e0ddcf] bg-[#e0ddcf]/30 p-2">
                  <span className="block text-[10px] uppercase font-bold text-[#534b52]">Entry</span>
                  <span className="font-bold text-[#2d232e]">{activeSample.entry}</span>
                </div>
                <div className="rounded border border-[#e0ddcf] bg-[#e0ddcf]/30 p-2">
                  <span className="block text-[10px] uppercase font-bold text-[#534b52]">Stop Loss</span>
                  <span className="font-bold text-[#2d232e]">{activeSample.sl}</span>
                </div>
                <div className="rounded border border-[#e0ddcf] bg-[#e0ddcf]/30 p-2">
                  <span className="block text-[10px] uppercase font-bold text-[#534b52]">Exit Price</span>
                  <span className="font-bold text-[#2d232e]">{activeSample.exit}</span>
                </div>
                <div className="rounded border border-[#e0ddcf] bg-[#e0ddcf]/30 p-2">
                  <span className="block text-[10px] uppercase font-bold text-[#534b52]">Lot Size</span>
                  <span className="font-bold text-[#2d232e]">{activeSample.lot} Lots</span>
                </div>
              </div>

              <div className="space-y-1.5 text-xs border-t border-[#e0ddcf] pt-3">
                <div className="flex justify-between">
                  <span className="text-[#534b52]">Market Context:</span>
                  <span className="font-medium text-[#2d232e]">{activeSample.session} &bull; {activeSample.condition}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#534b52]">Entry Trigger:</span>
                  <span className="font-medium text-[#2d232e]">{activeSample.setup}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#534b52]">Emotional State:</span>
                  <span className="font-medium text-[#2d232e]">{activeSample.emotionBefore} &rarr; {activeSample.emotionDuring}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#534b52]">Discipline Compliance:</span>
                  <span className="font-bold text-[#2d232e]">{activeSample.adherence} (Mistakes: {activeSample.mistakes})</span>
                </div>
              </div>

              <div className="mt-3.5 flex items-center justify-between rounded-lg bg-[#2d232e] px-3.5 py-2 text-xs text-[#f1f0ea]">
                <span>Appended directly to your Google Sheet</span>
                <span className="font-heading font-bold text-[#e0ddcf]">&rarr; Row 1 in &quot;Trades&quot; Tab</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="catalyst-radar" className="border-b-2 border-[#2d232e] bg-[#2d232e] px-4 sm:px-6 py-6 text-[#f1f0ea]">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-[#f1f0ea] animate-ping" />
              <span className="font-heading text-xs font-bold uppercase tracking-wider text-[#e0ddcf]">
                Macroeconomic Catalyst Radar &bull; Live Feed
              </span>
            </div>
            <span className="text-xs text-[#e0ddcf]/80">
              Dual-Stage Alerts: 24h Advance Brief + 60m Execution Alert via Email
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5">
            {upcomingEvents.length > 0 ? (
              upcomingEvents.map((evt) => (
                <div
                  key={evt.id}
                  className="rounded-lg border border-[#e0ddcf]/30 bg-[#474448] p-2.5 text-xs transition hover:border-[#f1f0ea]"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-heading font-bold text-[#f1f0ea]">{evt.country}</span>
                    <span className="font-heading rounded bg-[#2d232e] px-1.5 py-0.2 text-[9px] font-bold text-[#e0ddcf] uppercase">
                      {evt.impact}
                    </span>
                  </div>
                  <div className="font-bold text-[11px] text-[#f1f0ea] truncate" title={evt.title}>
                    {evt.title}
                  </div>
                  <div className="text-[10px] text-[#e0ddcf]/70 mt-1">
                    {evt.formattedTimeIST} IST
                  </div>
                </div>
              ))
            ) : (
              <div className="col-span-full rounded-lg border border-[#e0ddcf]/20 bg-[#474448]/50 p-3 text-center text-xs text-[#e0ddcf]/80">
                Institutional economic calendar feed synchronized. No imminent Tier-1 releases in the next window.
              </div>
            )}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="border-b-2 border-[#2d232e] px-4 sm:px-6 py-14 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="font-heading text-xs font-bold uppercase tracking-wider text-[#534b52]">
              Workflow Architecture
            </span>
            <h2 className="font-heading text-2xl sm:text-4xl font-bold tracking-tight text-[#2d232e] mt-1 mb-3">
              How Ledgerstone Works
            </h2>
            <p className="text-xs sm:text-sm text-[#534b52] leading-relaxed">
              Designed from first principles to remove every friction point between trade execution and disciplined self-review.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="rounded-xl border-2 border-[#2d232e] bg-[#f1f0ea] p-6 shadow-xs flex flex-col justify-between">
              <div>
                <span className="font-heading text-xs font-bold text-[#534b52] uppercase tracking-wider block mb-2">
                  01 &bull; Ingestion
                </span>
                <h3 className="font-heading text-lg font-bold text-[#2d232e] mb-2">
                  Dictate or Type Naturally
                </h3>
                <p className="text-xs text-[#534b52] leading-relaxed">
                  Enter one or multiple trades in a single sentence. Mention your instrument, entry, stop loss, and target. The assistant extracts positions and asks targeted one-question-at-a-time follow-ups for any missing fields.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-[#e0ddcf] font-heading text-[11px] font-bold text-[#2d232e]">
                &bull; Instant Multi-Position Extraction
              </div>
            </div>

            <div className="rounded-xl border-2 border-[#2d232e] bg-[#f1f0ea] p-6 shadow-xs flex flex-col justify-between">
              <div>
                <span className="font-heading text-xs font-bold text-[#534b52] uppercase tracking-wider block mb-2">
                  02 &bull; Verification & Reflection
                </span>
                <h3 className="font-heading text-lg font-bold text-[#2d232e] mb-2">
                  Math Derivation & Psychology
                </h3>
                <p className="text-xs text-[#534b52] leading-relaxed">
                  Gross PnL, R:R ratios, and multipliers are calculated deterministically. Complete a guided 11-question daily reflection on energy, limits followed, revenge trading, and key improvement goals.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-[#e0ddcf] font-heading text-[11px] font-bold text-[#2d232e]">
                &bull; 0ms Local Memory Transitions
              </div>
            </div>

            <div className="rounded-xl border-2 border-[#2d232e] bg-[#f1f0ea] p-6 shadow-xs flex flex-col justify-between">
              <div>
                <span className="font-heading text-xs font-bold text-[#534b52] uppercase tracking-wider block mb-2">
                  03 &bull; Persistence
                </span>
                <h3 className="font-heading text-lg font-bold text-[#2d232e] mb-2">
                  Immutable Google Sheets Write
                </h3>
                <p className="text-xs text-[#534b52] leading-relaxed">
                  Once verified, a single batch write commits records to your private Google Sheet across two dedicated tabs (&quot;Trades&quot; and &quot;Daily Reflections&quot;). Cryptographic deduplication prevents double saves.
                </p>
              </div>
              <div className="mt-4 pt-3 border-t border-[#e0ddcf] font-heading text-[11px] font-bold text-[#2d232e]">
                &bull; 100% Private Drive Storage
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="pillars" className="border-b-2 border-[#2d232e] bg-[#e0ddcf]/40 px-4 sm:px-6 py-14 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="font-heading text-xs font-bold uppercase tracking-wider text-[#534b52]">
              Institutional Standards
            </span>
            <h2 className="font-heading text-2xl sm:text-4xl font-bold tracking-tight text-[#2d232e] mt-1 mb-3">
              Built for Serious Capital Operators
            </h2>
            <p className="text-xs sm:text-sm text-[#534b52] leading-relaxed">
              Why professional traders prefer sovereign, deterministic logging over black-box AI tools.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="rounded-xl border-2 border-[#2d232e] bg-[#f1f0ea] p-5 sm:p-6 shadow-xs">
              <div className="font-heading text-xs font-bold uppercase tracking-wider text-[#2d232e] mb-1">
                Pillar 1
              </div>
              <h3 className="font-heading text-base sm:text-lg font-bold text-[#2d232e] mb-2">
                Sacred Law of Zero Hallucination
              </h3>
              <p className="text-xs text-[#534b52] leading-relaxed">
                Large language models are probabilistic and prone to fabricating numbers. In Ledgerstone, LLMs are restricted strictly to language comprehension. Every price calculation, risk multiple, and profit computation is processed deterministically with pure TypeScript mathematics.
              </p>
            </div>

            <div className="rounded-xl border-2 border-[#2d232e] bg-[#f1f0ea] p-5 sm:p-6 shadow-xs">
              <div className="font-heading text-xs font-bold uppercase tracking-wider text-[#2d232e] mb-1">
                Pillar 2
              </div>
              <h3 className="font-heading text-base sm:text-lg font-bold text-[#2d232e] mb-2">
                11-Step Psychological Attribution
              </h3>
              <p className="text-xs text-[#534b52] leading-relaxed">
                Trading edge is 80% emotional governance. Ledgerstone systematically audits sleep, starting balance, ending balance, compliance with daily loss limits, revenge/impulsive trades, and skipped setups to isolate the behavioral leaks draining your account.
              </p>
            </div>

            <div className="rounded-xl border-2 border-[#2d232e] bg-[#f1f0ea] p-5 sm:p-6 shadow-xs">
              <div className="font-heading text-xs font-bold uppercase tracking-wider text-[#2d232e] mb-1">
                Pillar 3
              </div>
              <h3 className="font-heading text-base sm:text-lg font-bold text-[#2d232e] mb-2">
                Dual-Environment Sandbox Mode
              </h3>
              <p className="text-xs text-[#534b52] leading-relaxed">
                Seamlessly toggle between &quot;Real Journal&quot; (for live capital) and &quot;Demo &amp; Testing Journal&quot; (for practicing strategy execution and testing). Both environments maintain isolated spreadsheets, separate IDs, and partitioned deduplication keys.
              </p>
            </div>

            <div className="rounded-xl border-2 border-[#2d232e] bg-[#f1f0ea] p-5 sm:p-6 shadow-xs">
              <div className="font-heading text-xs font-bold uppercase tracking-wider text-[#2d232e] mb-1">
                Pillar 4
              </div>
              <h3 className="font-heading text-base sm:text-lg font-bold text-[#2d232e] mb-2">
                Sovereign Google Drive Architecture
              </h3>
              <p className="text-xs text-[#534b52] leading-relaxed">
                No proprietary database locks in your trade history. We connect via Google OAuth using strictly the `drive.file` scope. Your journal lives in Google Sheets, openable on your phone, exportable to Excel, and owned by you forever.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section id="sheet-vault" className="border-b-2 border-[#2d232e] px-4 sm:px-6 py-14 sm:py-20">
        <div className="mx-auto max-w-5xl">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <span className="font-heading text-xs font-bold uppercase tracking-wider text-[#534b52]">
              Sovereign Schema
            </span>
            <h2 className="font-heading text-2xl sm:text-4xl font-bold tracking-tight text-[#2d232e] mt-1 mb-3">
              The 32-Column Sheet Vault
            </h2>
            <p className="text-xs sm:text-sm text-[#534b52] leading-relaxed">
              Every row written to your Google Sheet matches a canonical, institutional data schema.
            </p>
          </div>

          <div role="tablist" aria-label="column-categories" className="flex flex-wrap items-center justify-center gap-2 mb-8">
            {SHEET_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveSheetTab(cat.id)}
                className={`font-heading rounded-lg border-2 border-[#2d232e] px-3.5 py-1.5 text-xs font-bold transition cursor-pointer ${
                  activeSheetTab === cat.id
                    ? "bg-[#2d232e] text-[#f1f0ea]"
                    : "bg-[#f1f0ea] text-[#2d232e] hover:bg-[#e0ddcf]"
                }`}
              >
                {cat.label} ({cat.count})
              </button>
            ))}
          </div>

          <div aria-label="columns-grid" className="rounded-xl border-2 border-[#2d232e] bg-[#f1f0ea] p-5 sm:p-6 shadow-xs">
            <div className="mb-4 flex items-center justify-between border-b border-[#e0ddcf] pb-3">
              <span className="font-heading text-sm font-bold text-[#2d232e]">
                {activeCategory.label} Columns ({activeCategory.cols.length})
              </span>
              <span className="text-xs text-[#534b52]">Auto-synchronized to row 1</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {activeCategory.cols.map((col) => (
                <div
                  key={col.name}
                  className="rounded-lg border border-[#e0ddcf] bg-[#e0ddcf]/30 p-3 text-xs"
                >
                  <span className="font-heading font-bold text-[#2d232e] block mb-1">
                    {col.name}
                  </span>
                  <span className="font-body text-[#534b52] text-[11px] leading-tight block">
                    {col.desc}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="faq" className="border-b-2 border-[#2d232e] bg-[#e0ddcf]/40 px-4 sm:px-6 py-14 sm:py-20">
        <div className="mx-auto max-w-4xl">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <span className="font-heading text-xs font-bold uppercase tracking-wider text-[#534b52]">
              Clarity &amp; Transparency
            </span>
            <h2 className="font-heading text-2xl sm:text-4xl font-bold tracking-tight text-[#2d232e] mt-1 mb-3">
              Frequently Asked Questions
            </h2>
          </div>

          <div className="space-y-3">
            {FAQS.map((faq, idx) => (
              <div
                key={faq.question}
                className="rounded-xl border-2 border-[#2d232e] bg-[#f1f0ea] overflow-hidden shadow-xs"
              >
                <button
                  onClick={() => setOpenFaqIndex(openFaqIndex === idx ? null : idx)}
                  className="w-full flex items-center justify-between p-4 sm:p-5 text-left font-heading text-xs sm:text-sm font-bold text-[#2d232e] hover:bg-[#e0ddcf]/30 transition cursor-pointer"
                >
                  <span>{faq.question}</span>
                  <span className="font-mono text-sm ml-2">
                    {openFaqIndex === idx ? "&minus;" : "+"}
                  </span>
                </button>
                {openFaqIndex === idx && (
                  <div className="px-4 pb-4 sm:px-5 sm:pb-5 pt-1 text-xs sm:text-sm leading-relaxed text-[#534b52] border-t border-[#e0ddcf]">
                    {faq.answer}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="call-to-action" className="px-4 sm:px-6 py-16 sm:py-24 text-center">
        <div className="mx-auto max-w-3xl">
          <h2 className="font-heading text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-[#2d232e] mb-4">
            Every trade leaves a mark.
            <br />
            Make sure yours are recorded.
          </h2>
          <p className="text-sm sm:text-base text-[#534b52] max-w-xl mx-auto mb-8 font-body">
            Join disciplined traders who log executions in seconds and maintain pristine sovereign records directly inside their own Google Drive.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="/journal?mode=demo"
              className="font-heading inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-[#2d232e] px-8 py-4 text-sm font-bold text-[#f1f0ea] shadow-sm hover:bg-[#474448] active:scale-98 transition cursor-pointer"
            >
              ▲ Enter Demo Sandbox (Instant Access) &rarr;
            </a>
            <a
              href={connectionStatus?.connected ? "/journal" : "/api/auth/google"}
              className="font-heading inline-flex w-full sm:w-auto items-center justify-center rounded-xl border-2 border-[#2d232e] bg-[#f1f0ea] px-7 py-4 text-sm font-bold text-[#2d232e] hover:bg-[#e0ddcf] active:scale-98 transition cursor-pointer"
            >
              {connectionStatus?.connected ? "Launch Live Journal" : "Connect with Google Drive"}
            </a>
          </div>
        </div>
      </section>

      <footer id="site-footer" className="border-t-2 border-[#2d232e] bg-[#2d232e] text-[#f1f0ea] px-4 sm:px-6 py-10">
        <div className="mx-auto max-w-6xl flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="size-8 rounded-lg border border-[#e0ddcf] overflow-hidden bg-[#2d232e]">
              <img src="/icon.jpg" alt="Ledgerstone" className="size-full object-cover" />
            </div>
            <div>
              <span className="font-heading text-sm font-bold text-[#f1f0ea] block">
                Ledgerstone Journal
              </span>
              <span className="text-[10px] uppercase tracking-widest text-[#e0ddcf]/70">
                Institutional Conversational Journal
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-6 text-xs text-[#e0ddcf]/80 font-heading">
            <a href="#how-it-works" className="hover:text-[#f1f0ea] transition">Workflow</a>
            <a href="#pillars" className="hover:text-[#f1f0ea] transition">Pillars</a>
            <a href="#sheet-vault" className="hover:text-[#f1f0ea] transition">32 Columns</a>
            <a href="#catalyst-radar" className="hover:text-[#f1f0ea] transition">Economic Calendar</a>
            <a href="/journal" className="hover:text-[#f1f0ea] transition">Journal Terminal</a>
          </div>

          <div className="text-center md:text-right text-[11px] text-[#e0ddcf]/60">
            <div>IST Timezone Standardized</div>
            <div>&copy; {new Date().getFullYear()} Ledgerstone. All rights reserved.</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
