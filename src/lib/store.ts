import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Dead-simple local JSON storage. This is a single-user app running on one
 * machine, so files are the right amount of database for tokens and config.
 * `.data/` is gitignored — it holds real Google credentials.
 */
const DATA_DIR = path.join(process.cwd(), ".data");

async function filePath(name: string) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  return path.join(DATA_DIR, `${name}.json`);
}

export async function readJson<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(await filePath(name), "utf8")) as T;
  } catch {
    // Missing or unreadable file just means "not set up yet".
    return null;
  }
}

export async function writeJson(name: string, value: unknown): Promise<void> {
  await fs.writeFile(await filePath(name), JSON.stringify(value, null, 2), "utf8");
}
