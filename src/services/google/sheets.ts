import { google } from "googleapis";
import { getAuthedClient } from "./auth";
import { readJson, writeJson } from "@/lib/store";
import { HEADERS, toRow, type TradeRow } from "@/core/fields";

/**
 * ONE spreadsheet, ONE tab, one row per trade. Forever.
 *
 * The id is saved to .data/config.json the first time the sheet is created, and
 * every later save reuses it. Nothing in this file ever creates a second
 * spreadsheet or a second tab once that id exists (ARCHITECTURE.md §10).
 */

const TAB = "Trades";
const TITLE = "AI Trading Journal";

interface SheetConfig {
  spreadsheetId: string;
}

async function api() {
  return google.sheets({ version: "v4", auth: await getAuthedClient() });
}

async function driveApi() {
  return google.drive({ version: "v3", auth: await getAuthedClient() });
}

/**
 * Look for a journal this app created earlier but never recorded — which happens if
 * creation succeeded and something afterwards failed. Without this, that half-finished
 * state would silently produce a SECOND spreadsheet on the next run.
 *
 * `drive.file` scope means this search can only ever see our own files.
 */
async function findExistingJournal(): Promise<string | null> {
  try {
    const drive = await driveApi();
    const { data } = await drive.files.list({
      q:
        `mimeType='application/vnd.google-apps.spreadsheet' ` +
        `and name='${TITLE}' and trashed=false`,
      fields: "files(id)",
      orderBy: "createdTime",
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

export async function getSavedSpreadsheetId(): Promise<string | null> {
  return (await readJson<SheetConfig>("config"))?.spreadsheetId ?? null;
}

/**
 * Returns the journal spreadsheet, creating it only if we have never made one
 * (or the saved one was deleted from Drive).
 */
export async function getOrCreateSpreadsheet(): Promise<{
  spreadsheetId: string;
  url: string;
  created: boolean;
}> {
  const sheets = await api();
  const savedId = await getSavedSpreadsheetId();

  if (savedId) {
    try {
      await sheets.spreadsheets.get({ spreadsheetId: savedId, fields: "spreadsheetId" });
      return { spreadsheetId: savedId, url: sheetUrl(savedId), created: false };
    } catch {
      // Saved sheet is gone (deleted or trashed). Fall through and make a new one.
    }
  }

  // Adopt an untracked journal from a previous half-finished attempt, if one exists.
  const orphan = await findExistingJournal();
  if (orphan) {
    await writeJson("config", { spreadsheetId: orphan } satisfies SheetConfig);
    return { spreadsheetId: orphan, url: sheetUrl(orphan), created: false };
  }

  const { data } = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: TITLE },
      sheets: [{ properties: { title: TAB } }],
    },
    // Ask for the tab's id too. Naming the tab makes Google assign a random id
    // rather than 0, so it has to be read back rather than assumed.
    fields: "spreadsheetId,sheets.properties.sheetId",
  });

  const spreadsheetId = data.spreadsheetId;
  if (!spreadsheetId) throw new Error("Google did not return a spreadsheet id.");

  // Record the id IMMEDIATELY. Everything below is refinement, and if any of it
  // fails we must still remember this sheet — otherwise the next run creates
  // another one and the "one sheet, forever" guarantee is broken by an error path.
  await writeJson("config", { spreadsheetId } satisfies SheetConfig);

  // Row 1 = the column headings from core/fields.ts.
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${TAB}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADERS] },
  });

  // Freeze + bold the header row. Cosmetic only — never let it break a save.
  const sheetId = data.sheets?.[0]?.properties?.sheetId;
  if (sheetId != null) {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              updateSheetProperties: {
                properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
                fields: "gridProperties.frozenRowCount",
              },
            },
            {
              repeatCell: {
                range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                cell: { userEnteredFormat: { textFormat: { bold: true } } },
                fields: "userEnteredFormat.textFormat.bold",
              },
            },
          ],
        },
      });
    } catch {
      // A plain unformatted header row is perfectly usable.
    }
  }

  return { spreadsheetId, url: sheetUrl(spreadsheetId), created: true };
}

/** Row 1 of the live sheet. This — not FIELDS — decides column order on write. */
export async function getSheetHeaders(spreadsheetId: string): Promise<string[]> {
  const sheets = await api();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${TAB}!1:1`,
  });
  return (data.values?.[0] ?? []).map(String);
}

/**
 * Append trades as new rows — one row each, in order. Never creates a sheet or tab.
 *
 * All rows go in a SINGLE append call, so journaling three trades either lands all three
 * or none. Looping one call per trade would risk a half-written batch if the network
 * dropped midway.
 */
export async function appendTrades(trades: TradeRow[]): Promise<{
  url: string;
  updatedRange: string;
  rows: number;
}> {
  if (trades.length === 0) throw new Error("Nothing to save.");

  const { spreadsheetId, url } = await getOrCreateSpreadsheet();
  const sheets = await api();

  const headers = await getSheetHeaders(spreadsheetId);
  if (headers.length === 0) throw new Error("Sheet has no header row.");

  const { data } = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${TAB}!A:A`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: trades.map((trade) => toRow(trade, headers)) },
  });

  return {
    url,
    updatedRange: data.updates?.updatedRange ?? "",
    rows: data.updates?.updatedRows ?? trades.length,
  };
}

/** How many trades are stored (excludes the header row). */
export async function countTrades(spreadsheetId: string): Promise<number> {
  const sheets = await api();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${TAB}!A:A`,
  });
  return Math.max(0, (data.values?.length ?? 0) - 1);
}
