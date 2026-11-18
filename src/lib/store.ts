import { promises as fs } from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";

/**
 * Enterprise Upstash Redis Store with seamless local fallback.
 *
 * In Production / Serverless:
 *   Redis provides persistent, sub-millisecond cloud storage for Google OAuth
 *   tokens, session keys, distributed locks, and economic calendar caches.
 *
 * In Local Development:
 *   If Redis credentials are not yet set, the app falls back to local `.data/`
 *   JSON files without throwing errors or halting development.
 */
const DATA_DIR = path.join(process.cwd(), ".data");

function cleanEnv(val?: string): string | undefined {
  if (!val) return undefined;
  return val.trim().replace(/^["']|["']$/g, "").trim();
}

function initRedis(): Redis | null {
  const url = cleanEnv(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL);
  const token = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN);

  if (url && token) {
    try {
      return new Redis({ url, token });
    } catch (err) {
      console.warn("[store] Failed to initialize Upstash Redis:", err);
    }
  }
  return null;
}

export const redis = initRedis();

const localLockSet = new Set<string>();

/**
 * Distributed Lock using Upstash Redis SET key "1" NX EX ttl.
 * Guarantees that concurrent save operations across multiple devices or
 * browser tabs never duplicate records or collide in Google Sheets.
 */
export async function acquireDistributedLock(lockKey: string, ttlSeconds = 15): Promise<boolean> {
  if (redis) {
    try {
      const result = await redis.set(lockKey, "1", { nx: true, ex: ttlSeconds });
      return Boolean(result);
    } catch (e) {
      console.warn(`[store] Redis lock acquisition failed for ${lockKey}:`, e);
    }
  }

  // In-process lock fallback for local single-process environments
  if (localLockSet.has(lockKey)) {
    return false;
  }
  localLockSet.add(lockKey);
  setTimeout(() => localLockSet.delete(lockKey), ttlSeconds * 1000);
  return true;
}

export async function releaseDistributedLock(lockKey: string): Promise<void> {
  localLockSet.delete(lockKey);
  if (redis) {
    try {
      await redis.del(lockKey);
    } catch (e) {
      console.warn(`[store] Redis lock release failed for ${lockKey}:`, e);
    }
  }
}

async function filePath(name: string) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  return path.join(DATA_DIR, `${name}.json`);
}

export async function readJson<T>(name: string): Promise<T | null> {
  // Check Upstash Redis first for multi-instance cloud consistency
  if (redis) {
    try {
      const data = await redis.get<T>(name);
      if (data !== null && data !== undefined) {
        return data;
      }
    } catch (e) {
      console.warn(`[store] Redis get("${name}") failed:`, e instanceof Error ? e.message : e);
    }
  }

  // Local filesystem fallback
  try {
    const raw = await fs.readFile(await filePath(name), "utf8");
    return JSON.parse(raw) as T;
  } catch {
    // File not found or read-only filesystem (Vercel)
  }

  return null;
}

export async function writeJson(name: string, value: unknown, ttlSeconds?: number): Promise<void> {
  // Sync to Upstash Redis if configured
  if (redis) {
    try {
      if (ttlSeconds && ttlSeconds > 0) {
        await redis.set(name, value, { ex: ttlSeconds });
      } else {
        await redis.set(name, value);
      }
    } catch (e) {
      console.warn(`[store] Redis set("${name}") failed:`, e instanceof Error ? e.message : e);
    }
  }

  // Write locally if filesystem allows
  try {
    await fs.writeFile(await filePath(name), JSON.stringify(value, null, 2), "utf8");
  } catch {
    // Read-only filesystem in cloud deployment (Vercel)
  }
}
