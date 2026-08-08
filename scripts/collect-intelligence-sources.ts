import { createHash } from "node:crypto";
import pg from "pg";
import { HIGH_VALUE_INTELLIGENCE_SOURCES, sourceTags, type IntelligenceSourceDefinition } from "@/lib/intelligenceSources";

const FETCH_TIMEOUT_MS = 20_000;
const MAX_ITEMS_PER_SOURCE = 40;
const pool = new pg.Pool({ connectionString: process.env.ZJJR_SYNC_DATABASE_URL || process.env.DATABASE_URL });

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanText(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function tagValue(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? cleanText(match[1]) : "";
}

function tagRawValue(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? match[1].trim() : "";
}

function resolveUrl(value: string, base: string): string | null {
  try {
    const url = new URL(value, base);
    if (url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function parseDate(value: string, fallback: Date): Date {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : fallback;
}

interface CollectedItem {
  title: string;
  summary: string;
  url: string;
  publishedAt: Date;
}

function parseFeed(body: string, source: IntelligenceSourceDefinition, fetchedAt: Date): CollectedItem[] {
  const blocks = [...body.matchAll(/<(?:item|entry)(?:\s[^>]*)?>[\s\S]*?<\/(?:item|entry)>/gi)].map((match) => match[0]);
  const items: CollectedItem[] = [];
  for (const block of blocks) {
    const title = tagValue(block, "title");
    const rawLink = tagRawValue(block, "link") || block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || "";
    const url = resolveUrl(rawLink, source.homepage);
    if (!title || !url || !source.articlePath.test(url)) continue;
    const summary = tagValue(block, "description") || tagValue(block, "summary") || tagValue(block, "content:encoded");
    const published = tagValue(block, "pubDate") || tagValue(block, "published") || tagValue(block, "updated");
    items.push({ title, summary: summary.slice(0, 4000), url, publishedAt: parseDate(published, fetchedAt) });
  }
  return items;
}

function parseHtml(body: string, source: IntelligenceSourceDefinition, fetchedAt: Date): CollectedItem[] {
  const items: CollectedItem[] = [];
  const seen = new Set<string>();
  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of body.matchAll(linkPattern)) {
    const url = resolveUrl(match[1], source.endpoint);
    const title = cleanText(match[2]);
    if (!url || !title || title.length < 8 || title.length > 240 || !source.articlePath.test(url) || seen.has(url)) continue;
    seen.add(url);
    const contextStart = Math.max(0, (match.index ?? 0) - 500);
    const context = body.slice(contextStart, (match.index ?? 0) + match[0].length + 500);
    const summary = cleanText(context).replace(title, "").slice(0, 800);
    items.push({ title, summary, url, publishedAt: fetchedAt });
    if (items.length >= MAX_ITEMS_PER_SOURCE) break;
  }
  return items;
}

async function fetchSource(source: IntelligenceSourceDefinition): Promise<CollectedItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(source.endpoint, {
      signal: controller.signal,
      headers: { "user-agent": "Aivestor-IntelligenceMonitor/1.0" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.text();
    const fetchedAt = new Date();
    return source.kind === "rss" ? parseFeed(body, source, fetchedAt) : parseHtml(body, source, fetchedAt);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  let inserted = 0;
  for (const source of HIGH_VALUE_INTELLIGENCE_SOURCES) {
    try {
      const items = await fetchSource(source);
      for (const item of items) {
        const rawHash = createHash("sha256").update(`${source.key}:${item.url}:${item.title}`).digest("hex");
        await pool.query(
          `INSERT INTO intelligence_source_items
             (source_key, source_name, source_type, source_homepage, canonical_url, title, summary, published_at, subjects, raw_hash)
           VALUES ($1,$2,'official',$3,$4,$5,$6,$7,$8::jsonb,$9)
           ON CONFLICT (canonical_url) DO UPDATE SET
             title = EXCLUDED.title,
             summary = EXCLUDED.summary,
             published_at = EXCLUDED.published_at,
             subjects = EXCLUDED.subjects,
             raw_hash = EXCLUDED.raw_hash`,
          [source.key, source.name, source.homepage, item.url, item.title, item.summary, item.publishedAt.toISOString(), JSON.stringify(sourceTags(source)), rawHash]
        );
        inserted += 1;
      }
      console.log(`[intelligence-source] ${source.key}: ${items.length} item(s)`);
    } catch (error) {
      console.error(`[intelligence-source] ${source.key} failed:`, error instanceof Error ? error.message : error);
    }
  }
  console.log(`intelligence source collection completed: ${inserted} item(s)`);
  await pool.end();
}

main().catch((error) => {
  console.error("intelligence source collection failed", error);
  pool.end().catch(() => {});
  process.exitCode = 1;
});
