import { promises as fs } from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";

/**
 * One interface, two backends.
 *
 * Locally these are plain JSON files under `.data/` — a single-user app on one
 * machine wants nothing more, and the files are easy to open and eyeball.
 * On Vercel every function runs on a read-only filesystem, so the same values
 * live in Redis instead. Which backend is active depends purely on whether the
 * Upstash credentials are set, so local development needs no extra setup and
 * `.data/` keeps working exactly as before.
 */
const DATA_DIR = path.join(process.cwd(), ".data");

const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      })
    : null;

async function filePath(name: string) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  return path.join(DATA_DIR, `${name}.json`);
}

export async function readJson<T>(name: string): Promise<T | null> {
  if (redis) {
    // The REST client already parses JSON, so this comes back as an object.
    return (await redis.get<T>(name)) ?? null;
  }

  try {
    return JSON.parse(await fs.readFile(await filePath(name), "utf8")) as T;
  } catch {
    // Missing or unreadable file just means "not set up yet".
    return null;
  }
}

export async function writeJson(name: string, value: unknown): Promise<void> {
  if (redis) {
    await redis.set(name, value);
    return;
  }

  await fs.writeFile(await filePath(name), JSON.stringify(value, null, 2), "utf8");
}
