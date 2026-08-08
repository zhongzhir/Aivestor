import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export type EvidenceStatus = "full" | "partial" | "unavailable";

export interface EvidenceResult {
  url: string;
  finalUrl: string;
  title?: string;
  text: string;
  publishedAt?: string;
  siteName?: string;
  evidenceStatus: EvidenceStatus;
  failureReason?: string;
}

export interface EvidenceCandidate {
  title: string;
  publishedAt?: string;
  sourceUrl: string | null;
  origin?: string;
  content: string;
  evidenceStatus?: EvidenceStatus;
  /** 临时内部字段；调用方应在持久化前消费并删除。 */
  evidencePublishedAt?: string;
}

export interface EvidenceAcquisitionStats {
  attempted: number;
  full: number;
  partial: number;
  unavailable: number;
}

export const EVIDENCE_LIMITS = {
  maxUrls: 16,
  concurrency: 4,
  timeoutMs: 10_000,
  maxResponseBytes: 2 * 1024 * 1024,
  maxRedirects: 3,
  maxTextChars: 24_000,
} as const;

type RawResponse = { statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer; location?: string };
type AddressResolver = (hostname: string) => Promise<string[]>;
type EvidenceRequester = (url: URL, address: string) => Promise<RawResponse>;

const USER_AGENT = "Aivestor-EvidenceFetcher/1.0";
const PUBLIC_IPV4_BLOCKS: Array<[number, number]> = [
  [ip4("0.0.0.0"), 8],
  [ip4("10.0.0.0"), 8],
  [ip4("100.64.0.0"), 10],
  [ip4("127.0.0.0"), 8],
  [ip4("169.254.0.0"), 16],
  [ip4("172.16.0.0"), 12],
  [ip4("192.0.0.0"), 24],
  [ip4("192.168.0.0"), 16],
  [ip4("198.18.0.0"), 15],
  [ip4("224.0.0.0"), 4],
];

function ip4(value: string): number {
  return value.split(".").reduce((result, part) => (result * 256) + Number(part), 0) >>> 0;
}

function ipv6Groups(value: string): string[] | null {
  const raw = value.toLowerCase().split("%")[0];
  const mapped = raw.includes(".") ? raw.replace(/([^:]+)$/, (_match, tail: string) => {
    const octets = tail.split(".").map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return tail;
    return `${((octets[0]! * 256) + octets[1]!).toString(16)}:${((octets[2]! * 256) + octets[3]!).toString(16)}`;
  }) : raw;
  const halves = mapped.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":").filter(Boolean) : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => group.padStart(4, "0"));
}

function isBlockedIp(value: string): boolean {
  const kind = net.isIP(value);
  if (kind === 4) {
    const number = ip4(value);
    return PUBLIC_IPV4_BLOCKS.some(([network, prefix]) => {
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      return (number & mask) === (network & mask);
    });
  }
  if (kind !== 6) return true;
  const groups = ipv6Groups(value);
  if (!groups) return true;
  if (groups.slice(0, 5).every((group) => group === "0000") && groups[5] === "ffff") {
    const v4 = `${parseInt(groups[6]!.slice(0, 2), 16)}.${parseInt(groups[6]!.slice(2), 16)}.${parseInt(groups[7]!.slice(0, 2), 16)}.${parseInt(groups[7]!.slice(2), 16)}`;
    return isBlockedIp(v4);
  }
  const first = parseInt(groups[0]!, 16);
  return groups.slice(0, 7).every((group) => group === "0000") && groups[7] === "0001"
    || groups.every((group) => group === "0000")
    || first >= 0xfc00 && first <= 0xfdff
    || first >= 0xfe80 && first <= 0xfebf
    || first >= 0xff00 && first <= 0xffff;
}

function hostnameIsBlocked(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "metadata.google.internal";
}

async function lookupAddresses(hostname: string): Promise<string[]> {
  if (net.isIP(hostname)) return [hostname];
  return (await dns.lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
}

export async function validatePublicHttpUrl(value: string, resolver: AddressResolver = lookupAddresses): Promise<{ url: URL; addresses: string[] }> {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("invalid_url"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported_protocol");
  if (url.username || url.password) throw new Error("url_credentials_not_allowed");
  if (hostnameIsBlocked(url.hostname)) throw new Error("private_hostname");
  const addresses = await resolver(url.hostname);
  if (!addresses.length || addresses.some(isBlockedIp)) throw new Error("private_or_reserved_address");
  return { url, addresses };
}

function contentType(headers: http.IncomingHttpHeaders): string {
  return String(headers["content-type"] ?? "").split(";", 1)[0]!.trim().toLowerCase();
}

function requestOnce(url: URL, address: string): Promise<RawResponse> {
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request({
      protocol: url.protocol,
      hostname: address,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: `${url.pathname || "/"}${url.search}`,
      method: "GET",
      headers: { Accept: "text/html, text/plain;q=0.9", "User-Agent": USER_AGENT, Host: url.host },
      servername: net.isIP(url.hostname) ? undefined : url.hostname,
      timeout: EVIDENCE_LIMITS.timeoutMs,
      rejectUnauthorized: true,
    }, (response) => {
      const expected = Number(response.headers["content-length"] ?? 0);
      if (expected > EVIDENCE_LIMITS.maxResponseBytes) {
        response.resume();
        reject(new Error("response_too_large"));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > EVIDENCE_LIMITS.maxResponseBytes) {
          request.destroy(new Error("response_too_large"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ statusCode: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks), location: response.headers.location }));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", reject);
    request.end();
  });
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

function firstMatch(html: string, pattern: RegExp): string | undefined {
  const match = html.match(pattern);
  return match?.[1]?.trim() || undefined;
}

function bodyPublishedAt(text: string): string | undefined {
  return firstMatch(text, /(20\d{2}[年\/-]\d{1,2}[月\/-]\d{1,2}(?:日)?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)/);
}

function stripNoise(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "").replace(/<\s*(script|style|nav|footer|form|iframe|noscript|svg|aside)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, "");
}

function htmlToText(html: string): string {
  return decodeEntities(html.replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/[ \t\r\f]+/g, " ").replace(/\n\s+/g, "\n")).split("\n").map((line) => line.trim()).filter(Boolean).join("\n").slice(0, EVIDENCE_LIMITS.maxTextChars);
}

function stripBoilerplatePrefix(text: string, title?: string): string {
  const shell = /网易首页|快速导航|行情中心|数据中心|首页\s+新闻|首页\s+社区|登录\s+注册|新闻\s+国内\s+国际[\s\S]{0,120}NBA\s+CBA/;
  if (!shell.test(text)) return text;
  if (title) {
    const titleIndex = text.indexOf(title);
    if (titleIndex > 80) return text.slice(titleIndex);
  }
  const bodyMarker = text.lastIndexOf("正文");
  if (bodyMarker > 80) return text.slice(bodyMarker + 2);
  return "";
}

function jsonLdPublishedAt(html: string): string | undefined {
  const scripts = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const visit = (value: unknown): string | undefined => {
    if (Array.isArray(value)) for (const item of value) { const found = visit(item); if (found) return found; }
    if (value && typeof value === "object") {
      const row = value as Record<string, unknown>;
      for (const key of ["datePublished", "dateCreated", "uploadDate"]) if (typeof row[key] === "string" && row[key].trim()) return row[key].trim();
      for (const child of Object.values(row)) { const found = visit(child); if (found) return found; }
    }
    return undefined;
  };
  for (const script of scripts) { try { const found = visit(JSON.parse(script[1]!)); if (found) return found; } catch { /* malformed JSON-LD */ } }
  return undefined;
}

export function extractHtmlEvidence(html: string): Pick<EvidenceResult, "title" | "text" | "publishedAt"> & { contentRoot: boolean } {
  const clean = stripNoise(html);
  const title = decodeEntities(firstMatch(clean, /<title\b[^>]*>([\s\S]*?)<\/title>/i) || firstMatch(clean, /<meta\b[^>]*(?:property|name)=["'](?:og:title|twitter:title)["'][^>]*content=["']([^"']+)["'][^>]*>/i) || "");
  const semanticRoots = [...clean.matchAll(/<\s*(article|main)\b[^>]*>([\s\S]*?)<\/\s*\1\s*>/gi)].map((match) => match[2]!);
  const classRoots = [...clean.matchAll(/<div\b[^>]*(?:class|id)=["'][^"']*(?:article|post|content|detail|正文)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)].map((match) => match[1]!);
  const roots = [...semanticRoots, ...classRoots].sort((a, b) => b.length - a.length);
  const body = firstMatch(clean, /<body\b[^>]*>([\s\S]*?)<\/body>/i) || clean;
  const text = stripBoilerplatePrefix(htmlToText(roots[0] || body), title);
  const publishedAt = jsonLdPublishedAt(html)
    || firstMatch(clean, /<meta\b[^>]*(?:property|name|itemprop)=["'](?:article:published_time|datePublished|datepublished|publishdate)["'][^>]*content=["']([^"']+)["'][^>]*>/i)
    || firstMatch(clean, /<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/i)
    || bodyPublishedAt(text);
  return { title: title || undefined, text, publishedAt, contentRoot: roots.length > 0 };
}

function unavailable(url: string, finalUrl: string, reason: unknown): EvidenceResult {
  return { url, finalUrl, text: "", evidenceStatus: "unavailable", failureReason: reason instanceof Error ? reason.message : String(reason) };
}

export async function fetchPublicEvidence(value: string, options: { resolveAddresses?: AddressResolver; request?: EvidenceRequester } = {}): Promise<EvidenceResult> {
  const original = value;
  let current = value;
  try {
    for (let redirect = 0; redirect <= EVIDENCE_LIMITS.maxRedirects; redirect += 1) {
      const { url, addresses } = await validatePublicHttpUrl(current, options.resolveAddresses);
      const response = await (options.request || requestOnce)(url, addresses[0]!);
      if (Number(response.headers["content-length"] ?? 0) > EVIDENCE_LIMITS.maxResponseBytes || response.body.length > EVIDENCE_LIMITS.maxResponseBytes) return unavailable(original, current, "response_too_large");
      if (response.statusCode >= 300 && response.statusCode < 400 && response.location) {
        if (redirect === EVIDENCE_LIMITS.maxRedirects) return unavailable(original, current, "too_many_redirects");
        current = new URL(response.location, url).toString();
        continue;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) return unavailable(original, current, `http_${response.statusCode}`);
      const type = contentType(response.headers);
      if (type !== "text/html" && type !== "text/plain") return unavailable(original, current, "unsupported_content_type");
      if (type === "text/plain") {
        const text = response.body.toString("utf8").replace(/\s+/g, " ").trim().slice(0, EVIDENCE_LIMITS.maxTextChars);
        return { url: original, finalUrl: current, text, evidenceStatus: text.length >= 500 ? "full" : text.length >= 120 ? "partial" : "unavailable", failureReason: text.length < 120 ? "insufficient_text" : undefined };
      }
      const extracted = extractHtmlEvidence(response.body.toString("utf8"));
      const status: EvidenceStatus = extracted.contentRoot && extracted.text.length >= 500 ? "full" : extracted.contentRoot && extracted.text.length >= 120 ? "partial" : "unavailable";
      const { contentRoot: _contentRoot, ...page } = extracted;
      return { url: original, finalUrl: current, ...page, text: extracted.text, evidenceStatus: status, failureReason: status === "unavailable" ? "insufficient_text" : undefined };
    }
    return unavailable(original, current, "too_many_redirects");
  } catch (error) {
    return unavailable(original, current, error);
  }
}

export async function acquireEvidence<T extends EvidenceCandidate>(candidates: T[], options: { maxUrls?: number; concurrency?: number } = {}): Promise<{ candidates: T[]; stats: EvidenceAcquisitionStats }> {
  const targets = candidates.filter((candidate) => candidate.origin === "web-search" && !!candidate.sourceUrl).slice(0, options.maxUrls ?? EVIDENCE_LIMITS.maxUrls);
  const stats: EvidenceAcquisitionStats = { attempted: targets.length, full: 0, partial: 0, unavailable: 0 };
  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const index = cursor++;
      const candidate = targets[index]!;
      const evidence = await fetchPublicEvidence(candidate.sourceUrl!);
      candidate.evidenceStatus = evidence.evidenceStatus;
      if (evidence.evidenceStatus !== "unavailable") candidate.content = evidence.text;
      if (evidence.title && candidate.title.length < 12) candidate.title = evidence.title;
      if (evidence.publishedAt) candidate.evidencePublishedAt = evidence.publishedAt;
      stats[evidence.evidenceStatus] += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? EVIDENCE_LIMITS.concurrency, Math.max(1, targets.length)) }, worker));
  return { candidates, stats };
}
