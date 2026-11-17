/**
 * Daily-level reflection fields and helpers.
 *
 * Logged once per trading day into the "Daily Reflections" tab in Google Sheets.
 * Drives the daily psychology, discipline, and emotional tracking.
 */

import { extractNumber } from "./derive";

export interface DailyField {
  key: string;
  header: string;
  type: "text" | "number" | "enum" | "date";
  values?: readonly string[];
  options?: readonly string[];
  desc: string;
  question: string;
}

export const DAILY_FIELDS: readonly DailyField[] = [
  {
    key: "date",
    header: "Date",
    type: "date",
    desc: "Date of the trading session (YYYY-MM-DD)",
    question: "Which date does this reflection cover?",
  },
  {
    key: "sleepEnergy",
    header: "Sleep & Energy",
    type: "enum",
    values: ["HIGH", "MODERATE", "LOW"],
    options: ["High Energy & Rested", "Moderate", "Low / Fatigued"],
    desc: "Sleep, energy, focus, and stress levels today (HIGH, MODERATE, or LOW)",
    question: "How were your sleep, energy, focus, and stress levels today?",
  },
  {
    key: "dominantEmotion",
    header: "Dominant Emotion",
    type: "enum",
    values: ["CALM", "FOCUSED", "ANXIOUS", "EXCITED", "TIRED", "FRUSTRATED", "CONFIDENT"],
    options: ["Calm", "Focused", "Anxious", "Excited", "Tired", "Frustrated", "Confident"],
    desc: "Dominant emotion before or during the session",
    question: "What was your dominant emotion before starting the session?",
  },
  {
    key: "startingBalance",
    header: "Starting Balance",
    type: "number",
    desc: "Account starting balance for the day (clean digits)",
    question: "What was your account starting balance for today?",
  },
  {
    key: "endingBalance",
    header: "Ending Balance",
    type: "number",
    desc: "Account ending balance for the day (clean digits)",
    question: "What was your account ending balance for today?",
  },
  {
    key: "limitsFollowed",
    header: "Limits Followed",
    type: "enum",
    values: ["YES", "NO"],
    options: ["Yes, followed limits", "No, exceeded limits"],
    desc: "Whether daily loss limit and maximum trade limit were followed (YES or NO)",
    question: "Did you follow your daily loss limit and maximum trade limit?",
  },
  {
    key: "impulsiveTrades",
    header: "Impulsive / Revenge",
    type: "enum",
    values: ["NONE", "IMPULSIVE", "REVENGE", "BOREDOM"],
    options: ["None (Disciplined)", "Impulsive Trade", "Revenge Traded", "Boredom Trade"],
    desc: "Any impulsive, revenge, or boredom trades taken (NONE, IMPULSIVE, REVENGE, or BOREDOM)",
    question: "Did you take any impulsive, revenge, or boredom trades?",
  },
  {
    key: "skippedSetups",
    header: "Valid Setups Skipped",
    type: "text",
    options: ["None skipped", "Hesitated on trigger", "Missed session open"],
    desc: "Any valid setups skipped and why",
    question: "Were there any valid setups you skipped today, and why?",
  },
  {
    key: "biggestMistake",
    header: "Biggest Mistake",
    type: "text",
    options: ["None / Followed plan", "Early exit", "Chased price", "Moved SL"],
    desc: "The biggest mistake made today",
    question: "What was your biggest mistake today?",
  },
  {
    key: "bestDecision",
    header: "Best Decision",
    type: "text",
    options: ["Followed trading plan", "Patient entry", "Cut loss quickly", "Respected stop loss"],
    desc: "The best decision made today regardless of profit or loss",
    question: "What was your best decision today, regardless of profit or loss?",
  },
  {
    key: "marketConditions",
    header: "Market Conditions",
    type: "text",
    options: ["Trending smoothly", "Choppy / Ranging", "High volatility / News", "Normal conditions"],
    desc: "Market conditions or news that influenced trading today",
    question: "What market conditions or news influenced your trading today?",
  },
  {
    key: "improvementGoal",
    header: "One Thing to Improve",
    type: "text",
    options: ["Better patience", "Strict stop loss discipline", "Wait for candle close", "Manage risk size"],
    desc: "The one thing to improve in the next session",
    question: "What is the single most important thing to improve for your next session?",
  },
  {
    key: "createdAt",
    header: "Logged Timestamp",
    type: "text",
    desc: "When this daily reflection was recorded, IST",
    question: "",
  },
] as const;

export type DailyFieldKey = (typeof DAILY_FIELDS)[number]["key"];

export type DailyReflectionRow = Partial<Record<DailyFieldKey, string | number | null>>;

export const DAILY_HEADERS: string[] = DAILY_FIELDS.map((f) => f.header);

/**
 * Normalizes daily reflection answers into standard enum values, numbers, and clean text strings.
 * Prevents enum pollution (e.g. "PARTIAL" going into Limits Followed or long strings in Sleep).
 */
export function normalizeDailyReflection(raw: Record<string, unknown>): DailyReflectionRow {
  const clean: DailyReflectionRow = {};

  for (const field of DAILY_FIELDS) {
    const rawVal = raw[field.key];
    if (rawVal === null || rawVal === undefined || rawVal === "") continue;

    const str = String(rawVal).trim();
    if (!str) continue;

    if (field.type === "number") {
      const num = extractNumber(rawVal);
      if (num != null) {
        clean[field.key as DailyFieldKey] = num;
      }
    } else if (field.key === "sleepEnergy") {
      const lower = str.toLowerCase();
      if (
        lower.includes("high") ||
        lower.includes("rested") ||
        lower.includes("great") ||
        lower.includes("fresh")
      ) {
        clean.sleepEnergy = "HIGH";
      } else if (
        lower.includes("low") ||
        lower.includes("poor") ||
        lower.includes("tired") ||
        lower.includes("fatigue") ||
        lower.includes("exhaust") ||
        lower.includes("sleepy")
      ) {
        clean.sleepEnergy = "LOW";
      } else if (
        lower.includes("mod") ||
        lower.includes("med") ||
        lower.includes("balanc") ||
        lower.includes("avg") ||
        lower.includes("average") ||
        lower.includes("ok")
      ) {
        clean.sleepEnergy = "MODERATE";
      } else {
        clean.sleepEnergy = str.length > 20 ? "MODERATE" : str;
      }
    } else if (field.key === "dominantEmotion") {
      const upper = str.toUpperCase().trim();
      const valid = ["CALM", "FOCUSED", "ANXIOUS", "EXCITED", "TIRED", "FRUSTRATED", "CONFIDENT"];
      const match = valid.find((v) => upper.includes(v));
      clean.dominantEmotion = match || (upper.length > 20 ? "CALM" : upper);
    } else if (field.key === "limitsFollowed") {
      const upper = str.toUpperCase().trim();
      if (upper.includes("YES") || upper.includes("FOLLOWED") || upper.includes("100%")) {
        clean.limitsFollowed = "YES";
      } else if (
        upper.includes("NO") ||
        upper.includes("EXCEED") ||
        upper.includes("BROKE") ||
        upper.includes("PARTIAL")
      ) {
        clean.limitsFollowed = "NO";
      } else {
        clean.limitsFollowed = upper === "YES" ? "YES" : "NO";
      }
    } else if (field.key === "impulsiveTrades") {
      const upper = str.toUpperCase().trim();
      if (
        upper.includes("NONE") ||
        upper.includes("DISCIPLIN") ||
        upper === "NO" ||
        upper.includes("ZERO") ||
        upper.includes("NO IMPULSIVE")
      ) {
        clean.impulsiveTrades = "NONE";
      } else if (upper.includes("REVENGE")) {
        clean.impulsiveTrades = "REVENGE";
      } else if (upper.includes("BOREDOM")) {
        clean.impulsiveTrades = "BOREDOM";
      } else if (upper.includes("IMPULSIVE") || upper.includes("FOMO")) {
        clean.impulsiveTrades = "IMPULSIVE";
      } else {
        clean.impulsiveTrades = upper;
      }
    } else {
      clean[field.key as DailyFieldKey] = str;
    }
  }

  return clean;
}

export function toDailyRow(data: DailyReflectionRow, sheetHeaders: string[]): (string | number)[] {
  const byHeader = new Map<string, DailyFieldKey>(
    DAILY_FIELDS.map((f) => [f.header.toLowerCase(), f.key as DailyFieldKey]),
  );

  return sheetHeaders.map((heading) => {
    const key = byHeader.get(heading.trim().toLowerCase());
    if (!key) return "";
    const value = data[key];
    return value === null || value === undefined ? "" : value;
  });
}

export interface NextDailyQuestion {
  key: DailyFieldKey;
  header: string;
  question: string;
  options: string[];
  stepNumber: number;
  totalSteps: number;
}

/**
 * Returns the single next empty field in strict Google Sheet column order.
 * Ensures the assistant asks ONLY ONE question at a time and presents ONLY that field's options.
 */
export function getNextEmptyDailyField(answers: DailyReflectionRow): NextDailyQuestion | null {
  const sequence: DailyFieldKey[] = [
    "sleepEnergy",
    "dominantEmotion",
    "startingBalance",
    "endingBalance",
    "limitsFollowed",
    "impulsiveTrades",
    "skippedSetups",
    "biggestMistake",
    "bestDecision",
    "marketConditions",
    "improvementGoal",
  ];

  for (let i = 0; i < sequence.length; i++) {
    const key = sequence[i];
    const val = answers[key];
    const isEmpty = val === null || val === undefined || val === "";
    if (isEmpty) {
      const field = DAILY_FIELDS.find((f) => f.key === key);
      if (!field) continue;
      return {
        key,
        header: field.header,
        question: field.question,
        options: field.options ? [...field.options] : [],
        stepNumber: i + 1,
        totalSteps: sequence.length,
      };
    }
  }

  return null;
}
