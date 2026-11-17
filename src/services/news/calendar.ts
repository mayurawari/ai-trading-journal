import { GoogleGenAI } from "@google/genai";
import { readJson, writeJson } from "@/lib/store";

export interface EconomicEvent {
  id: string;
  title: string;
  country: string;
  date: string; // ISO string
  impact: "High" | "Medium" | "Low" | "Holiday";
  forecast: string;
  previous: string;
  affectedAssets: string[];
  formattedTimeIST: string;
  formattedTimeEST: string;
  isPast: boolean;
}

const CALENDAR_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

const ASSET_IMPACT_MAP: Record<string, string[]> = {
  USD: ["Gold (XAUUSD)", "DXY (Dollar Index)", "US500 / S&P", "US100 / Nasdaq", "EURUSD", "GBPUSD"],
  EUR: ["EURUSD", "EURGBP", "EURJPY", "GER40 (DAX)"],
  GBP: ["GBPUSD", "EURGBP", "GBPJPY", "FTSE100"],
  JPY: ["USDJPY", "GBPJPY", "EURJPY", "Nikkei 225"],
  CAD: ["USDCAD", "Crude Oil (WTI)"],
  AUD: ["AUDUSD", "Gold (XAUUSD)", "AUDJPY"],
  NZD: ["NZDUSD", "AUDNZD"],
  CHF: ["USDCHF", "EURCHF"],
};

function mapAssets(country: string): string[] {
  return ASSET_IMPACT_MAP[country.toUpperCase()] ?? ["Forex Majors", "Global Equities"];
}

function formatIST(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function formatEST(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

// In-memory cache to strictly avoid FairEconomy 429 rate limits
let cachedEvents: EconomicEvent[] | null = null;
let lastFetchTime = 0;
const CACHE_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Fetches the economic calendar feed from FairEconomy (Forex Factory feed).
 * Uses in-memory caching to respect rate limits.
 */
export async function fetchCalendarEvents(): Promise<EconomicEvent[]> {
  const now = Date.now();
  if (cachedEvents && cachedEvents.length > 0 && now - lastFetchTime < CACHE_DURATION_MS) {
    return cachedEvents;
  }

  // Check shared Upstash Redis cache first
  try {
    const redisEvents = await readJson<EconomicEvent[]>("cache_economic_calendar");
    if (redisEvents && Array.isArray(redisEvents) && redisEvents.length > 0) {
      cachedEvents = redisEvents;
      lastFetchTime = now;
      return redisEvents;
    }
  } catch {
    // Continue to live fetch
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(CALENDAR_URL, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Ledgerstone/1.0",
        Accept: "application/json",
      },
    });

    clearTimeout(timeout);

    if (res.status === 429) {
      console.warn("FairEconomy rate limited (429). Using cached or fallback events.");
      if (cachedEvents && cachedEvents.length > 0) return cachedEvents;
      return getFallbackMacroEvents();
    }

    if (!res.ok) {
      throw new Error(`Calendar feed responded with ${res.status}`);
    }

    const raw = (await res.json()) as Array<{
      title?: string;
      country?: string;
      date?: string;
      impact?: string;
      forecast?: string;
      previous?: string;
    }>;

    const nowDate = new Date();

    const parsed = raw.map((item, idx) => {
      const eventDate = item.date ? new Date(item.date) : nowDate;
      const country = item.country ?? "USD";
      const impactStr = item.impact ?? "Low";
      const impact: EconomicEvent["impact"] =
        impactStr === "High" ? "High" : impactStr === "Medium" ? "Medium" : impactStr === "Holiday" ? "Holiday" : "Low";

      return {
        id: `event-${idx}-${country}-${eventDate.getTime()}`,
        title: item.title ?? "Economic Release",
        country,
        date: eventDate.toISOString(),
        impact,
        forecast: item.forecast || "N/A",
        previous: item.previous || "N/A",
        affectedAssets: mapAssets(country),
        formattedTimeIST: formatIST(eventDate),
        formattedTimeEST: formatEST(eventDate),
        isPast: eventDate.getTime() < nowDate.getTime(),
      };
    });

    cachedEvents = parsed;
    lastFetchTime = now;
    void writeJson("cache_economic_calendar", parsed, 900);
    return parsed;
  } catch (error) {
    console.error("Failed to fetch calendar feed:", error);
    if (cachedEvents && cachedEvents.length > 0) return cachedEvents;
    return getFallbackMacroEvents();
  }
}

function getFallbackMacroEvents(): EconomicEvent[] {
  const now = new Date();
  return [
    {
      id: "fallback-cpi",
      title: "Core CPI m/m",
      country: "USD",
      date: new Date(now.getTime() + 1000 * 60 * 60 * 3).toISOString(),
      impact: "High",
      forecast: "0.3%",
      previous: "0.3%",
      affectedAssets: ["Gold (XAUUSD)", "DXY (Dollar Index)", "US500 / S&P", "EURUSD"],
      formattedTimeIST: "07:00 PM",
      formattedTimeEST: "08:30 AM",
      isPast: false,
    },
    {
      id: "fallback-nfp",
      title: "Non-Farm Employment Change (NFP)",
      country: "USD",
      date: new Date(now.getTime() + 1000 * 60 * 60 * 24).toISOString(),
      impact: "High",
      forecast: "165K",
      previous: "180K",
      affectedAssets: ["Gold (XAUUSD)", "DXY (Dollar Index)", "US100 / Nasdaq", "GBPUSD"],
      formattedTimeIST: "07:00 PM",
      formattedTimeEST: "08:30 AM",
      isPast: false,
    },
    {
      id: "fallback-powell",
      title: "Fed Chair Powell Speaks",
      country: "USD",
      date: new Date(now.getTime() + 1000 * 60 * 60 * 48).toISOString(),
      impact: "High",
      forecast: "N/A",
      previous: "N/A",
      affectedAssets: ["Gold (XAUUSD)", "DXY (Dollar Index)", "US500", "US100"],
      formattedTimeIST: "11:00 PM",
      formattedTimeEST: "12:30 PM",
      isPast: false,
    },
  ];
}

/**
 * Filter for High-Impact (Red Folder) events.
 * If today has none (e.g. weekend/bank holiday), returns upcoming high-impact events this week.
 */
export async function getHighImpactEvents(): Promise<{
  events: EconomicEvent[];
  isToday: boolean;
  dateLabel: string;
}> {
  const allEvents = await fetchCalendarEvents();
  const now = new Date();
  const todayDateStr = now.toLocaleDateString("en-CA"); // YYYY-MM-DD

  const highImpact = allEvents.filter((e) => e.impact === "High");

  // Today's high impact events
  const todayHigh = highImpact.filter((e) => {
    const d = new Date(e.date);
    return d.toLocaleDateString("en-CA") === todayDateStr;
  });

  if (todayHigh.length > 0) {
    return {
      events: todayHigh,
      isToday: true,
      dateLabel: now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
    };
  }

  // If no high impact today, return upcoming high impact events
  const upcomingHigh = highImpact.filter((e) => new Date(e.date).getTime() >= now.getTime() - 1000 * 60 * 60 * 2);

  if (upcomingHigh.length > 0) {
    return {
      events: upcomingHigh.slice(0, 5),
      isToday: false,
      dateLabel: "Upcoming High-Voltage Releases",
    };
  }

  // If weekend or past Friday close, show this week's key high-impact releases for session review
  return {
    events: highImpact.slice(0, 5),
    isToday: false,
    dateLabel: "This Week's High-Voltage Releases",
  };
}

/**
 * Generates an AI volatility analysis using Gemini based on high impact events.
 */
export async function generateAIVolatilityBrief(events: EconomicEvent[]): Promise<string> {
  if (events.length === 0) {
    return "No high-voltage economic releases scheduled for this session. Market conditions are expected to be driven primarily by technical structure, liquidity sweeps, and baseline order flow.";
  }

  // Check cache first (1 hour TTL) to prevent redundant API calls on page refreshes
  const eventIds = events.map((e) => e.id).join("_");
  const cacheKey = `cache_volatility_brief_${eventIds.substring(0, 40)}`;
  const cached = await readJson<string>(cacheKey);
  if (cached) return cached;

  const eventsSummary = events
    .map(
      (e) =>
        `- ${e.country} ${e.title} at ${e.formattedTimeIST} IST (${e.formattedTimeEST} EST). Affects: ${e.affectedAssets.join(", ")}. Forecast: ${e.forecast}, Previous: ${e.previous}.`,
    )
    .join("\n");

  const prompt = [
    "You are Ledgerstone Market Analyst, an institutional risk management and volatility analyst for active traders.",
    "Analyze these high-impact economic releases and write a concise, hard-hitting 3-4 sentence volatility brief for active traders (especially Gold/XAUUSD, Forex, and Index traders):",
    eventsSummary,
    "",
    "Focus on:",
    "1. Expected volatility window & liquidity sweep risk around release times.",
    "2. Specific asset impact (e.g. Gold spikes, DXY expansion, Index whipsaws).",
    "3. Direct risk rule (e.g. avoid entering 5 min before news, widen stop-loss, wait for the 15-minute close).",
    "Keep it professional, sharp, and actionable without fluff. Do not use emojis, icons, or italic formatting.",
  ].join("\n");

  // Try Groq first for instant response with high quota
  const groqKey = process.env.GROQ_API_KEY || process.env.GROK_API_KEY;
  if (groqKey) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${groqKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const text = data.choices?.[0]?.message?.content?.trim();
        if (text) {
          void writeJson(cacheKey, text, 3600);
          return text;
        }
      }
    } catch {
      // fallback to Gemini
    }
  }

  // Fallback to Gemini
  const apiKey = (process.env.GEMINI_API_KEY || "").split(",")[0]?.trim();
  if (apiKey) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const res = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
        contents: prompt,
        config: {
          temperature: 0.2,
        },
      });

      const text = res.text?.trim();
      if (text) {
        void writeJson(cacheKey, text, 3600);
        return text;
      }
    } catch (err) {
      console.warn("AI brief generation failed, using rule-based summary:", err);
    }
  }

  const fallbackBrief = buildRuleBasedBrief(events);
  void writeJson(cacheKey, fallbackBrief, 3600);
  return fallbackBrief;
}

function buildRuleBasedBrief(events: EconomicEvent[]): string {
  const titles = events.map((e) => `${e.country} ${e.title} (${e.formattedTimeIST} IST)`).join(", ");
  const assets = Array.from(new Set(events.flatMap((e) => e.affectedAssets))).slice(0, 4).join(", ");

  return `High-voltage market volatility anticipated today around ${titles}. Active instruments (${assets}) will likely experience sharp spread expansion and fast liquidity sweeps. Protect capital by avoiding premature breakout entries and verifying stop-loss buffers before news releases.`;
}

const TIER_1_KEYWORDS = [
  "cpi",
  "fomc",
  "non-farm",
  "nfp",
  "employment change",
  "interest rate",
  "rate decision",
  "powell",
  "gdp",
  "ppi",
  "pce",
  "retail sales",
  "unemployment rate",
];

export function isTier1Event(event: { title: string; impact: string }): boolean {
  if (event.impact !== "High") return false;
  const lower = event.title.toLowerCase();
  return TIER_1_KEYWORDS.some((kw) => lower.includes(kw));
}

export interface EventWithWindow {
  event: EconomicEvent;
  window: "24h_advance" | "60m_urgent";
  minutesUntil: number;
}

/**
 * Scans upcoming Tier-1 events to find those in either:
 * - 24-hour advance window (18h to 30h ahead)
 * - 60-minute urgent reminder window (20m to 90m ahead)
 */
export async function getUpcomingAlertEvents(now = new Date()): Promise<EventWithWindow[]> {
  const all = await fetchCalendarEvents();
  const results: EventWithWindow[] = [];

  for (const event of all) {
    if (!isTier1Event(event)) continue;

    const eventTime = new Date(event.date).getTime();
    const diffMinutes = Math.round((eventTime - now.getTime()) / (1000 * 60));

    // 60-Minute Urgent Window: between 20 and 90 minutes ahead
    if (diffMinutes >= 20 && diffMinutes <= 90) {
      results.push({
        event,
        window: "60m_urgent",
        minutesUntil: diffMinutes,
      });
    }
    // 24-Hour Advance Window: between 18 hours (1080m) and 30 hours (1800m) ahead
    else if (diffMinutes >= 1080 && diffMinutes <= 1800) {
      results.push({
        event,
        window: "24h_advance",
        minutesUntil: diffMinutes,
      });
    }
  }

  return results;
}
