import { google } from "googleapis";
import { getAuthedClient } from "./auth";
import { readJson, writeJson } from "@/lib/store";
import { HEADERS, toRow, type TradeRow } from "@/core/fields";
import { DAILY_HEADERS, toDailyRow, type DailyReflectionRow } from "@/core/daily";
import { safeEmailKey } from "@/lib/session";

/**
 * ONE spreadsheet with TWO tabs per user, per environment (Real / Live vs Demo / Testing):
 * 1. "Trades" (one row per trade)
 * 2. "Daily Reflections" (one row per day for psychology/discipline)
 *
 * Each authenticated user can switch between:
 * - Real / Live: "Ledgerstone - Trading Journal"
 * - Demo / Testing: "Ledgerstone - Demo & Testing Journal"
 */

export type JournalEnvironment = "real" | "test";

const TAB = "Trades";
const DAILY_TAB = "Daily Reflections";
export const REAL_TITLE = "Ledgerstone - Trading Journal";
export const TEST_TITLE = "Ledgerstone - Demo & Testing Journal";

export interface SheetConfig {
  spreadsheetId?: string; // legacy fallback
  realSpreadsheetId?: string;
  testSpreadsheetId?: string;
  activeEnvironment?: JournalEnvironment;
  realTradesCount?: number;
  testTradesCount?: number;
}

function configKey(userEmail?: string): string {
  return userEmail ? `config_${safeEmailKey(userEmail)}` : "config";
}

async function api(userEmail?: string) {
  return google.sheets({ version: "v4", auth: await getAuthedClient(userEmail) });
}

async function driveApi(userEmail?: string) {
  return google.drive({ version: "v3", auth: await getAuthedClient(userEmail) });
}

export async function getSheetConfig(userEmail?: string): Promise<SheetConfig> {
  const key = configKey(userEmail);
  const userConfig = (await readJson<SheetConfig>(key)) || {};
  if (!userConfig.realSpreadsheetId && userConfig.spreadsheetId) {
    userConfig.realSpreadsheetId = userConfig.spreadsheetId;
  }
  const rootConfig = (await readJson<SheetConfig>("config")) || {};
  if (!userConfig.realSpreadsheetId && rootConfig.spreadsheetId) {
    userConfig.realSpreadsheetId = rootConfig.spreadsheetId;
  }
  if (!userConfig.activeEnvironment) {
    userConfig.activeEnvironment = rootConfig.activeEnvironment || "real";
  }
  return userConfig;
}

export async function saveSheetConfig(config: SheetConfig, userEmail?: string): Promise<void> {
  const key = configKey(userEmail);
  await writeJson(key, config);
  if (!userEmail) {
    await writeJson("config", config);
  }
}

export async function getActiveEnvironment(userEmail?: string): Promise<JournalEnvironment> {
  const config = await getSheetConfig(userEmail);
  return config.activeEnvironment === "test" ? "test" : "real";
}

export async function setActiveEnvironment(env: JournalEnvironment, userEmail?: string): Promise<SheetConfig> {
  const config = await getSheetConfig(userEmail);
  config.activeEnvironment = env;
  await saveSheetConfig(config, userEmail);
  return config;
}

/**
 * Look for a journal this app created earlier in the user's Drive for the specified environment.
 * `drive.file` scope means this search can only ever see our own files.
 */
async function findExistingJournal(userEmail?: string, env: JournalEnvironment = "real"): Promise<string | null> {
  try {
    const drive = await driveApi(userEmail);
    const title = env === "test" ? TEST_TITLE : REAL_TITLE;
    const query =
      env === "test"
        ? `mimeType='application/vnd.google-apps.spreadsheet' and name='${TEST_TITLE}' and trashed=false`
        : `mimeType='application/vnd.google-apps.spreadsheet' and (name='${REAL_TITLE}' or name='AI Trading Journal' or name='Ledgerstone') and trashed=false`;

    const { data } = await drive.files.list({
      q: query,
      fields: "files(id)",
      orderBy: "createdTime desc",
      pageSize: 1,
    });
    return data.files?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

export function sheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

export async function getSavedSpreadsheetId(userEmail?: string, env?: JournalEnvironment): Promise<string | null> {
  const config = await getSheetConfig(userEmail);
  const targetEnv = env || config.activeEnvironment || "real";
  if (targetEnv === "test") {
    return config.testSpreadsheetId ?? null;
  }
  return (config.realSpreadsheetId || config.spreadsheetId) ?? null;
}

/**
 * Returns the journal spreadsheet for the given user and environment (Real vs Demo/Test),
 * creating it in their Google Drive if one doesn't exist yet.
 */
export async function getOrCreateSpreadsheet(
  userEmail?: string,
  env?: JournalEnvironment,
): Promise<{
  spreadsheetId: string;
  url: string;
  created: boolean;
  environment: JournalEnvironment;
}> {
  const config = await getSheetConfig(userEmail);
  const targetEnv: JournalEnvironment = env || config.activeEnvironment || "real";
  const title = targetEnv === "test" ? TEST_TITLE : REAL_TITLE;

  const sheets = await api(userEmail);
  const savedId = await getSavedSpreadsheetId(userEmail, targetEnv);

  if (savedId) {
    try {
      await sheets.spreadsheets.get({ spreadsheetId: savedId, fields: "spreadsheetId" });
      await syncSheetHeaders(savedId, userEmail);
      return { spreadsheetId: savedId, url: sheetUrl(savedId), created: false, environment: targetEnv };
    } catch {
      // Saved sheet is gone or inaccessible. Fall through to create/adopt.
    }
  }

  // Adopt an untracked journal from a previous attempt in this user's Drive
  const orphan = await findExistingJournal(userEmail, targetEnv);
  if (orphan) {
    if (targetEnv === "test") {
      config.testSpreadsheetId = orphan;
    } else {
      config.realSpreadsheetId = orphan;
      config.spreadsheetId = orphan;
    }
    await saveSheetConfig(config, userEmail);
    await syncSheetHeaders(orphan, userEmail);
    return { spreadsheetId: orphan, url: sheetUrl(orphan), created: false, environment: targetEnv };
  }

  // Create new spreadsheet in user's Drive with both Trades and Daily Reflections tabs
  const { data } = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title },
      sheets: [
        { properties: { title: TAB } },
        { properties: { title: DAILY_TAB } },
      ],
    },
    fields: "spreadsheetId,sheets.properties.sheetId,sheets.properties.title",
  });

  const spreadsheetId = data.spreadsheetId;
  if (!spreadsheetId) throw new Error("Google did not return a spreadsheet id.");

  // Save the ID scoped per environment
  if (targetEnv === "test") {
    config.testSpreadsheetId = spreadsheetId;
  } else {
    config.realSpreadsheetId = spreadsheetId;
    config.spreadsheetId = spreadsheetId;
  }
  config.activeEnvironment = targetEnv;
  await saveSheetConfig(config, userEmail);

  // Initialize Trades headers
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${TAB}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADERS] },
  });

  // Initialize Daily Reflections headers
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${DAILY_TAB}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [DAILY_HEADERS] },
  });

  // Freeze row 1 and format headers on both sheets
  const tradesSheetId = data.sheets?.find((s) => s.properties?.title === TAB)?.properties?.sheetId;
  const dailySheetId = data.sheets?.find((s) => s.properties?.title === DAILY_TAB)?.properties?.sheetId;

  const formatRequests = [];
  if (tradesSheetId != null) {
    formatRequests.push(
      {
        updateSheetProperties: {
          properties: { sheetId: tradesSheetId, gridProperties: { frozenRowCount: 1 } },
          fields: "gridProperties.frozenRowCount",
        },
      },
      {
        repeatCell: {
          range: { sheetId: tradesSheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: "userEnteredFormat.textFormat.bold",
        },
      },
    );
  }
  if (dailySheetId != null) {
    formatRequests.push(
      {
        updateSheetProperties: {
          properties: { sheetId: dailySheetId, gridProperties: { frozenRowCount: 1 } },
          fields: "gridProperties.frozenRowCount",
        },
      },
      {
        repeatCell: {
          range: { sheetId: dailySheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: "userEnteredFormat.textFormat.bold",
        },
      },
    );
  }

  if (formatRequests.length > 0) {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: formatRequests },
      });
    } catch {
      // cosmetic formatting only
    }
  }

  return { spreadsheetId, url: sheetUrl(spreadsheetId), created: true, environment: targetEnv };
}

/** Row 1 of the live sheet for this user. */
export async function getSheetHeaders(spreadsheetId: string, userEmail?: string): Promise<string[]> {
  const sheets = await api(userEmail);
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${TAB}'!1:1`,
  });
  return (data.values?.[0] ?? []).map(String);
}

export interface AppendTradesResult {
  url: string;
  updatedRange: string;
  rows: number;
  alreadySaved: boolean;
  skippedDuplicates: number;
}

/**
 * Computes a deterministic identity signature for a trade.
 * Trades taken on the same date with identical asset, direction, entry price, SL, and lot size
 * share the exact same signature.
 */
export function tradeSignature(trade: TradeRow): string {
  const date = String(trade.date ?? "").trim();
  const asset = String(trade.asset || trade.symbol || "").toUpperCase().trim();
  const dir = String(trade.direction ?? "").toUpperCase().trim();
  const entry =
    trade.entryPrice != null && trade.entryPrice !== ""
      ? Number(String(trade.entryPrice).replace(/[, ]/g, "")).toFixed(2)
      : "";
  const sl =
    trade.stopLoss != null && trade.stopLoss !== ""
      ? Number(String(trade.stopLoss).replace(/[, ]/g, "")).toFixed(2)
      : "";
  const lot =
    trade.lotSize != null && trade.lotSize !== ""
      ? Number(String(trade.lotSize).replace(/[, ]/g, "")).toFixed(2)
      : "";
  return `${date}|${asset}|${dir}|${entry}|${sl}|${lot}`;
}

/**
 * Reads existing trade rows from the user's sheet and extracts their signatures.
 */
export async function getExistingTradeSignatures(spreadsheetId: string, userEmail?: string): Promise<Set<string>> {
  try {
    const sheets = await api(userEmail);
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${TAB}'!A:Z`,
    });

    const rows = data.values ?? [];
    const signatures = new Set<string>();
    if (rows.length <= 1) return signatures;

    const headerRow = (rows[0] ?? []).map((h) => String(h).trim().toLowerCase());
    const dateIdx = headerRow.indexOf("date");
    const assetIdx = headerRow.indexOf("asset");
    const dirIdx = headerRow.indexOf("buy / sell");
    const entryIdx = headerRow.indexOf("entry price");
    const slIdx = headerRow.indexOf("stop loss");
    const lotIdx = headerRow.indexOf("lot size");

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length === 0) continue;

      const date = dateIdx >= 0 ? String(r[dateIdx] ?? "").trim() : "";
      const asset = assetIdx >= 0 ? String(r[assetIdx] ?? "").toUpperCase().trim() : "";
      const dir = dirIdx >= 0 ? String(r[dirIdx] ?? "").toUpperCase().trim() : "";
      const entry =
        entryIdx >= 0 && r[entryIdx] !== "" && r[entryIdx] != null
          ? Number(String(r[entryIdx]).replace(/[, ]/g, "")).toFixed(2)
          : "";
      const sl =
        slIdx >= 0 && r[slIdx] !== "" && r[slIdx] != null
          ? Number(String(r[slIdx]).replace(/[, ]/g, "")).toFixed(2)
          : "";
      const lot =
        lotIdx >= 0 && r[lotIdx] !== "" && r[lotIdx] != null
          ? Number(String(r[lotIdx]).replace(/[, ]/g, "")).toFixed(2)
          : "";

      if (asset && dir && entry) {
        signatures.add(`${date}|${asset}|${dir}|${entry}|${sl}|${lot}`);
      }
    }

    return signatures;
  } catch (err) {
    console.warn("[sheets] Could not retrieve existing signatures, continuing:", err);
    return new Set<string>();
  }
}

/**
 * Append trades to the user's spreadsheet with strict deduplication.
 * Prevents multiple entries if the user double-clicks or triggers multiple saves.
 * Scoped by target environment (Real vs Demo/Test).
 */
export async function appendTrades(
  trades: TradeRow[],
  userEmail?: string,
  env?: JournalEnvironment,
): Promise<AppendTradesResult> {
  if (trades.length === 0) throw new Error("Nothing to save.");

  const { spreadsheetId, url, environment } = await getOrCreateSpreadsheet(userEmail, env);
  const sheets = await api(userEmail);

  const headers = await getSheetHeaders(spreadsheetId, userEmail);
  if (headers.length === 0) throw new Error("Sheet has no header row.");

  // Check for duplicates in existing sheet rows
  const existingSignatures = await getExistingTradeSignatures(spreadsheetId, userEmail);

  // Scoped deduplication cache per environment
  const savedKey = `saved_signatures_${environment}_${safeEmailKey(userEmail || "anonymous")}`;
  const localSaved = (await readJson<string[]>(savedKey)) || [];
  for (const s of localSaved) {
    existingSignatures.add(s);
  }

  // Filter out any trade that is already present in the sheet
  const newTrades: TradeRow[] = [];
  let skippedCount = 0;

  for (const trade of trades) {
    const sig = tradeSignature(trade);
    if (existingSignatures.has(sig)) {
      skippedCount++;
      console.log(`[sheets] [${environment}] Deduplication: trade already recorded, skipping duplicate: ${sig}`);
    } else {
      newTrades.push(trade);
      existingSignatures.add(sig); // prevent duplicates within the same batch
    }
  }

  // If all trades in this batch were already saved, return safely without creating duplicate rows
  if (newTrades.length === 0) {
    return {
      url,
      updatedRange: "",
      rows: 0,
      alreadySaved: true,
      skippedDuplicates: skippedCount,
    };
  }

  // Append ONLY the new non-duplicate trades
  const { data } = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${TAB}'!A:A`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: newTrades.map((trade) => toRow(trade, headers)) },
  });

  // Update recent saved cache
  const updatedLocal = Array.from(existingSignatures).slice(-100);
  await writeJson(savedKey, updatedLocal);

  // Update cached trade count in config
  try {
    const cfg = await getSheetConfig(userEmail);
    const addedCount = data.updates?.updatedRows ?? newTrades.length;
    if (environment === "test") {
      cfg.testTradesCount = (cfg.testTradesCount ?? 0) + addedCount;
    } else {
      cfg.realTradesCount = (cfg.realTradesCount ?? 0) + addedCount;
    }
    await saveSheetConfig(cfg, userEmail);
  } catch {}

  return {
    url,
    updatedRange: data.updates?.updatedRange ?? "",
    rows: data.updates?.updatedRows ?? newTrades.length,
    alreadySaved: false,
    skippedDuplicates: skippedCount,
  };
}

/** How many trades are stored for this user's spreadsheet. */
export async function countTrades(spreadsheetId: string, userEmail?: string): Promise<number> {
  const sheets = await api(userEmail);
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${TAB}'!A:A`,
  });
  const count = Math.max(0, (data.values?.length ?? 0) - 1);
  try {
    if (userEmail) {
      const cfg = await getSheetConfig(userEmail);
      if (cfg.realSpreadsheetId === spreadsheetId) cfg.realTradesCount = count;
      if (cfg.testSpreadsheetId === spreadsheetId) cfg.testTradesCount = count;
      await saveSheetConfig(cfg, userEmail);
    }
  } catch {}
  return count;
}

/** Ensure the Daily Reflections tab exists in the user's journal. */
export async function ensureDailyTab(spreadsheetId: string, userEmail?: string): Promise<void> {
  const sheets = await api(userEmail);
  const { data } = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title)",
  });
  const hasDaily = data.sheets?.some((s) => s.properties?.title === DAILY_TAB);
  if (hasDaily) return;

  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: DAILY_TAB } } }],
    },
  });
  const newSheetId = addRes.data.replies?.[0]?.addSheet?.properties?.sheetId;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${DAILY_TAB}'!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [DAILY_HEADERS] },
  });

  if (newSheetId != null) {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: { sheetId: newSheetId, gridProperties: { frozenRowCount: 1 } },
                fields: "gridProperties.frozenRowCount",
              },
            },
            {
              repeatCell: {
                range: { sheetId: newSheetId, startRowIndex: 0, endRowIndex: 1 },
                cell: { userEnteredFormat: { textFormat: { bold: true } } },
                fields: "userEnteredFormat.textFormat.bold",
              },
            },
          ],
        },
      });
    } catch {
      // cosmetic formatting only
    }
  }
}

/** Synchronize both tabs with the latest canonical headers without corrupting existing rows. */
export async function syncSheetHeaders(spreadsheetId: string, userEmail?: string): Promise<void> {
  try {
    const sheets = await api(userEmail);

    // 1. Check Trades tab
    const tradesRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${TAB}'!A1:ZZ1`,
    });
    const currentTradeHeaders = (tradesRes.data.values?.[0] ?? []).map(String);

    if (currentTradeHeaders.length !== HEADERS.length || !HEADERS.every((h, i) => currentTradeHeaders[i] === h)) {
      console.log(`[sheets] Syncing Trades tab headers to canonical ${HEADERS.length} columns...`);
      const allRowsRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${TAB}'!A1:ZZ500`,
      });
      const allRows = allRowsRes.data.values ?? [];
      if (allRows.length > 0) {
        const oldHeaders = (allRows[0] ?? []).map((h) => String(h).trim().toLowerCase());
        const remappedRows = [HEADERS];

        for (let r = 1; r < allRows.length; r++) {
          const row = allRows[r];
          const rowMap: Record<string, string> = {};
          oldHeaders.forEach((h, idx) => {
            rowMap[h] = row[idx] !== undefined && row[idx] !== null ? String(row[idx]) : "";
          });
          const remapped = HEADERS.map((h) => rowMap[h.trim().toLowerCase()] ?? "");
          remappedRows.push(remapped);
        }

        await sheets.spreadsheets.values.clear({
          spreadsheetId,
          range: `'${TAB}'!A1:ZZ500`,
        });

        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${TAB}'!A1`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: remappedRows },
        });
      }
    }

    // 2. Check Daily Reflections tab
    await ensureDailyTab(spreadsheetId, userEmail);
    const dailyRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${DAILY_TAB}'!A1:ZZ1`,
    });
    const currentDailyHeaders = (dailyRes.data.values?.[0] ?? []).map(String);
    if (currentDailyHeaders.length !== DAILY_HEADERS.length || !DAILY_HEADERS.every((h, i) => currentDailyHeaders[i] === h)) {
      console.log(`[sheets] Syncing Daily Reflections tab headers to canonical ${DAILY_HEADERS.length} columns...`);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${DAILY_TAB}'!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [DAILY_HEADERS] },
      });
    }
  } catch (syncErr) {
    console.warn("[sheets] syncSheetHeaders non-fatal warning:", syncErr);
  }
}

export async function getDailySheetHeaders(spreadsheetId: string, userEmail?: string): Promise<string[]> {
  await ensureDailyTab(spreadsheetId, userEmail);
  const sheets = await api(userEmail);
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${DAILY_TAB}'!1:1`,
  });
  return (data.values?.[0] ?? []).map(String);
}

/**
 * Append or update a daily reflection row in "Daily Reflections" tab.
 * Deduplicates by date: if a reflection for this date already exists, it updates it,
 * merging with existing columns so partial reflection turns never blank out previously saved fields.
 */
export async function appendDailyReflection(
  daily: DailyReflectionRow,
  userEmail?: string,
  env?: JournalEnvironment,
): Promise<{
  url: string;
  updatedRange: string;
  alreadySaved: boolean;
}> {
  const { spreadsheetId, url } = await getOrCreateSpreadsheet(userEmail, env);
  await ensureDailyTab(spreadsheetId, userEmail);
  const sheets = await api(userEmail);
  const headers = await getDailySheetHeaders(spreadsheetId, userEmail);

  const row = toDailyRow(daily, headers);

  // Check if today's reflection already exists to prevent duplicate rows
  const { data: existingData } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${DAILY_TAB}'!A:Z`,
  });

  const existingRows = existingData.values ?? [];
  const headerRow = (existingRows[0] ?? []).map((h) => String(h).trim().toLowerCase());
  const dateIdx = headerRow.indexOf("date");

  const targetDate = String(daily.date ?? "").trim();
  let existingRowIndex = -1;

  if (dateIdx >= 0 && targetDate) {
    for (let i = 1; i < existingRows.length; i++) {
      if (String(existingRows[i]?.[dateIdx] ?? "").trim() === targetDate) {
        existingRowIndex = i + 1; // 1-based index for Google Sheets API
        break;
      }
    }
  }

  if (existingRowIndex > 0) {
    // Merge existing row values so partial updates don't overwrite previous columns with blanks
    const existingValues = existingRows[existingRowIndex - 1] ?? [];
    const mergedRow = headers.map((heading, colIdx) => {
      const newVal = row[colIdx];
      if (newVal !== "" && newVal !== null && newVal !== undefined) {
        return newVal;
      }
      return existingValues[colIdx] ?? "";
    });

    const updateRes = await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${DAILY_TAB}'!A${existingRowIndex}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [mergedRow] },
    });
    return {
      url,
      updatedRange: updateRes.data.updatedRange ?? "",
      alreadySaved: true,
    };
  }

  // Otherwise append new row
  const { data } = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `'${DAILY_TAB}'!A:A`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [row] },
  });

  return {
    url,
    updatedRange: data.updates?.updatedRange ?? "",
    alreadySaved: false,
  };
}
