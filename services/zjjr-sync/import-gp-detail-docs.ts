/**
 * Import ZJJR GP detail WordML reports into the public ZJJR data layer.
 *
 * This script deliberately does not write knowledge_base_entries. Reports are
 * archived in zjjr_gp_reports and chunked into zjjr_features for AI retrieval.
 *
 * Examples:
 *   npx ts-node -T services/zjjr-sync/import-gp-detail-docs.ts --input "C:\path\zjjr-data" --dry-run
 *   npx ts-node -T services/zjjr-sync/import-gp-detail-docs.ts --input "/var/www/aivestor-app/data/imports/zjjr-gp-details" --write --resume
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import JSZip from "jszip";
import { Pool, type PoolClient } from "pg";
import {
  EMBEDDING_MODEL,
  generateEmbeddingWithBailian,
} from "../../src/lib/embedding";

const DEFAULT_INPUT =
  "C:\\Users\\46554\\WPSDrive\\421507599\\WPS\u4e91\u76d8\\AIVESTOR\\\u4e2d\u9274\u6570\u636e";
const DEFAULT_BATCH = "GP\u8be6\u60c5-\u4e0a\u6d77\u676d\u5dde-202607";
const DEFAULT_CHUNK_SIZE = 3000;
const DEFAULT_CHUNK_OVERLAP = 200;
const DEFAULT_MAX_CHUNKS = 20;
const DEFAULT_VALID_DAYS = 365;
const FEATURE_KIND = "gp_due_diligence_report";
const SOURCE_KIND = "gp_due_diligence_report";

export interface ReportDoc {
  fileName: string;
  institutionName: string;
  reportDate: string | null;
  region: string | null;
  sourceBatch: string;
  text: string;
  hash: string;
}

export interface FeatureChunk {
  content: string;
  title: string;
  metadata: Record<string, unknown>;
}

interface ZipPlanItem {
  path: string;
  region: string;
  sourceBatch: string;
}

interface ZipPlan {
  found: ZipPlanItem[];
  missing: string[];
}

type InputMode = "auto" | "zip" | "extracted";

interface InputPlan {
  kind: "zip" | "extracted";
  zipPlan: ZipPlan;
  extractedFiles: string[];
}

interface ChunkOptions {
  chunkSize: number;
  chunkOverlap: number;
  maxChunksPerReport: number;
}

interface CliOptions extends ChunkOptions {
  input: string;
  dryRun: boolean;
  write: boolean;
  resume: boolean;
  skipEmbedding: boolean;
  limit: number | null;
  batchName: string;
  mode: InputMode;
}

interface ImportStats {
  zipCount: number;
  reportCount: number;
  parsedCount: number;
  badInstitutionNames: number;
  badReportDates: number;
  textLengthMin: number;
  textLengthMax: number;
  textLengthSum: number;
  textLengthCount: number;
  reportInserted: number;
  reportUpdated: number;
  featuresInserted: number;
  featuresSkipped: number;
  embeddingSuccess: number;
  embeddingFailed: number;
  matchedInstitutions: number;
  createdInstitutions: number;
}

interface DryRunSample {
  institutionName: string;
  reportDate: string | null;
  region: string | null;
  preview: string;
}

interface SourcePlanOptions {
  input: string;
  mode: InputMode;
  batchName: string;
}

interface ExtractedReadOptions {
  inputRoot: string;
  region: string | null;
  sourceBatch: string;
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function intArg(name: string, fallback: number): number {
  const raw = arg(name);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function modeArg(): InputMode {
  const raw = arg("--mode");
  if (raw === "zip" || raw === "extracted" || raw === "auto") return raw;
  return "auto";
}

function parseArgs(): CliOptions {
  const limitRaw = arg("--limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : null;
  return {
    input: arg("--input") ?? arg("--zip") ?? DEFAULT_INPUT,
    dryRun: hasFlag("--dry-run"),
    write: hasFlag("--write"),
    resume: hasFlag("--resume"),
    skipEmbedding: hasFlag("--skip-embedding"),
    limit: limit && limit > 0 ? limit : null,
    batchName: arg("--batch-name") ?? DEFAULT_BATCH,
    mode: modeArg(),
    chunkSize: intArg("--chunk-size", DEFAULT_CHUNK_SIZE),
    chunkOverlap: intArg("--chunk-overlap", DEFAULT_CHUNK_OVERLAP),
    maxChunksPerReport: intArg("--max-chunks-per-report", DEFAULT_MAX_CHUNKS),
  };
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function sha256Buffer(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function computeFileHash(filePath: string): string {
  return sha256Buffer(fs.readFileSync(filePath));
}

function walkFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const st = fs.statSync(root);
  if (st.isFile()) return [root];
  const out: string[] = [];
  for (const name of fs.readdirSync(root)) {
    const full = path.join(root, name);
    const child = fs.statSync(full);
    if (child.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

function hasWordMlPrefix(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(4096);
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
      const head = buffer.subarray(0, bytesRead).toString("utf8").trimStart();
      return head.startsWith("<?xml") && /<w:wordDocument|<w:document/.test(head);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
}

function isExtractedReportPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".doc" || ext === ".xml") return true;
  if (!ext) return hasWordMlPrefix(filePath);
  return false;
}

function inferRegion(filePath: string): string | null {
  const name = filePath;
  if (name.includes("\u4e0a\u6d77") || name.includes("涓婃捣")) return "\u4e0a\u6d77";
  if (name.includes("\u676d\u5dde") || name.includes("鏉窞")) return "\u676d\u5dde";
  if (name.includes("\u6d59\u6c5f") || name.includes("娴欐睙")) return "\u6d59\u6c5f";
  return null;
}

export function planInputZips(filePaths: string[]): ZipPlan {
  const found = filePaths
    .filter((p) => {
      const base = path.basename(p);
      return (
        (base.startsWith("GP\u8be6\u60c5") || base.startsWith("GP璇︽儏")) &&
        p.toLowerCase().endsWith(".zip")
      );
    })
    .map((p) => ({
      path: p,
      region: inferRegion(p) ?? "\u672a\u77e5",
      sourceBatch: path.basename(p, path.extname(p)),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const hasShanghai = found.some((x) => x.region.includes("\u4e0a\u6d77"));
  const hasHangzhou = found.some((x) => x.region.includes("\u676d\u5dde"));
  const missing: string[] = [];
  if (!hasShanghai) missing.push("GP\u8be6\u60c5\uff08\u4e0a\u6d77\uff09\u76f8\u5173 ZIP");
  if (!hasHangzhou) missing.push("GP\u8be6\u60c5\uff08\u676d\u5dde\uff09\u76f8\u5173 ZIP");

  return { found, missing };
}

export function planInputSources(filePaths: string[], opts: SourcePlanOptions): InputPlan {
  const zipPlan = planInputZips(filePaths);
  const extractedFiles = filePaths
    .filter((p) => fs.existsSync(p) && fs.statSync(p).isFile() && isExtractedReportPath(p))
    .sort((a, b) => a.localeCompare(b));

  if (opts.mode === "zip") {
    return { kind: "zip", zipPlan, extractedFiles: [] };
  }
  if (opts.mode === "extracted") {
    return {
      kind: "extracted",
      zipPlan: { found: [], missing: [] },
      extractedFiles,
    };
  }
  if (zipPlan.found.length > 0) {
    return { kind: "zip", zipPlan, extractedFiles: [] };
  }
  return {
    kind: "extracted",
    zipPlan: { found: [], missing: [] },
    extractedFiles,
  };
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripXmlTags(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

export function parseWordMlText(xml: string): string {
  const paragraphs: string[] = [];
  const paraMatches = xml.match(/<w:p[\s\S]*?<\/w:p>/g) ?? [];

  for (const para of paraMatches) {
    const pieces: string[] = [];
    const tokenRe =
      /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/?>|<w:br\s*\/?>/g;
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(para))) {
      if (m[1] !== undefined) pieces.push(decodeXml(stripXmlTags(m[1])));
      else pieces.push(" ");
    }
    const line = pieces.join("").replace(/[ \t\u3000]+/g, " ").trim();
    if (line) paragraphs.push(line);
  }

  return paragraphs
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\u0000/g, "")
    .trim();
}

export function parseInstitutionName(fileName: string): {
  institutionName: string;
  reportDate: string | null;
} {
  const base = path.basename(fileName).replace(/\.(docx?|xml)$/i, "");
  const m = base.match(/^(.*?)(20\d{12}).*$/);
  if (!m) return { institutionName: base.trim(), reportDate: null };
  const raw = m[2];
  return {
    institutionName: m[1].trim(),
    reportDate: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`,
  };
}

function isBadInstitutionName(name: string): boolean {
  return !name || name.includes("\u951f") || /[\uFFFD]/.test(name) || name.length < 2;
}

function isBadReportDate(date: string | null): boolean {
  return !date || !/^20\d{2}-\d{2}-\d{2}$/.test(date);
}

export function normalizeInstitutionName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[\uff08\uff09()]/g, "")
    .replace(/\u79c1\u52df\u57fa\u91d1\u7ba1\u7406/g, "")
    .replace(/\u57fa\u91d1\u7ba1\u7406/g, "")
    .replace(/\u80a1\u6743\u6295\u8d44\u7ba1\u7406/g, "")
    .replace(/\u6295\u8d44\u7ba1\u7406/g, "")
    .replace(/\u6709\u9650\u8d23\u4efb\u516c\u53f8$/g, "")
    .replace(/\u6709\u9650\u516c\u53f8$/g, "")
    .replace(/\u6709\u9650\u5408\u4f19$/g, "")
    .replace(/\u5408\u4f19\u4f01\u4e1a$/g, "")
    .replace(/\u4e2d\u5fc3$/g, "")
    .trim();
}

async function* iterateZipReports(zipItem: ZipPlanItem): AsyncIterable<ReportDoc> {
  const gbkDecoder = new TextDecoder("gbk");
  const zip = await JSZip.loadAsync(fs.readFileSync(zipItem.path), {
    decodeFileName: (bytes) =>
      gbkDecoder.decode(bytes as Uint8Array<ArrayBufferLike>),
  });

  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.toLowerCase().endsWith(".doc")) continue;
    const buffer = await entry.async("nodebuffer");
    const xml = buffer.toString("utf8");
    if (!xml.trimStart().startsWith("<?xml")) {
      throw new Error(`Unsupported .doc format: ${entry.name}`);
    }
    const text = parseWordMlText(xml);
    const { institutionName, reportDate } = parseInstitutionName(entry.name);
    yield {
      fileName: path.basename(entry.name),
      institutionName,
      reportDate,
      region: zipItem.region,
      sourceBatch: zipItem.sourceBatch,
      text,
      hash: sha256Buffer(buffer),
    };
  }
}

export function readExtractedReportDoc(filePath: string, opts: ExtractedReadOptions): ReportDoc {
  const buffer = fs.readFileSync(filePath);
  const xml = buffer.toString("utf8");
  if (!xml.trimStart().startsWith("<?xml")) {
    throw new Error(`Unsupported WordML file: ${filePath}`);
  }
  const text = parseWordMlText(xml);
  const { institutionName, reportDate } = parseInstitutionName(filePath);
  return {
    fileName: path.relative(opts.inputRoot, filePath) || path.basename(filePath),
    institutionName,
    reportDate,
    region: opts.region,
    sourceBatch: opts.sourceBatch,
    text,
    hash: sha256Buffer(buffer),
  };
}

function splitText(text: string, opts: ChunkOptions): string[] {
  if (!text) return [];
  const chunkSize = Math.max(1, opts.chunkSize);
  const overlap = Math.min(Math.max(0, opts.chunkOverlap), chunkSize - 1);
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length && chunks.length < opts.maxChunksPerReport) {
    const end = Math.min(text.length, start + chunkSize);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - overlap;
  }
  return chunks;
}

export function buildFeatureChunks(
  report: ReportDoc,
  opts: ChunkOptions
): FeatureChunk[] {
  const chunks = splitText(report.text, opts);
  const total = chunks.length;
  return chunks.map((chunk, index) => {
    const chunkIndex = index + 1;
    const content = [
      "\u3010GP\u5c3d\u8c03\u62a5\u544a\u3011",
      `\u673a\u6784\uff1a${report.institutionName}`,
      `\u5730\u533a\uff1a${report.region ?? "\u672a\u8bc6\u522b"}`,
      `\u62a5\u544a\u65e5\u671f\uff1a${report.reportDate ?? "\u672a\u8bc6\u522b"}`,
      `\u6765\u6e90\u6279\u6b21\uff1a${report.sourceBatch}`,
      `\u7247\u6bb5\uff1a${chunkIndex}/${total}`,
      "",
      chunk,
    ].join("\n");
    return {
      title: `${report.institutionName} \u5c3d\u8c03\u62a5\u544a\u7247\u6bb5 ${chunkIndex}/${total}`,
      content,
      metadata: {
        source_kind: SOURCE_KIND,
        source_batch: report.sourceBatch,
        source_file_name: report.fileName,
        source_file_hash: report.hash,
        institution_name: report.institutionName,
        report_date: report.reportDate,
        region: report.region,
        chunk_index: chunkIndex,
        total_chunks: total,
        parser: "wordml_xml",
      },
    };
  });
}

export function buildCreatedInstitutionMetadata(sourceBatch: string): Record<string, unknown> {
  return {
    created_from: "gp_detail_doc_import",
    source_batch: sourceBatch,
    needs_review: true,
  };
}

async function findInstitution(
  client: PoolClient,
  institutionName: string,
  sourceBatch: string
): Promise<{ id: string; created: boolean }> {
  const exact = await client.query<{ id: string }>(
    `SELECT id FROM zjjr_institutions
      WHERE name = $1 OR canonical_name = $1
      LIMIT 1`,
    [institutionName]
  );
  if (exact.rows[0]) return { id: exact.rows[0].id, created: false };

  const normalized = normalizeInstitutionName(institutionName);
  if (normalized.length >= 2) {
    const candidates = await client.query<{ id: string; name: string; canonical_name: string }>(
      `SELECT id, name, canonical_name
         FROM zjjr_institutions
        WHERE name ILIKE $1 OR canonical_name ILIKE $1
        LIMIT 50`,
      [`%${normalized.slice(0, Math.min(4, normalized.length))}%`]
    );
    for (const row of candidates.rows) {
      if (
        normalizeInstitutionName(row.name) === normalized ||
        normalizeInstitutionName(row.canonical_name) === normalized
      ) {
        return { id: row.id, created: false };
      }
    }
  }

  const sourceId = `gp_doc:${sha256(normalized || institutionName).slice(0, 16)}`;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO zjjr_institutions
       (source_id, name, canonical_name, aliases, institution_type, focus_sectors,
        focus_stages, region, raw, metadata, source_updated_at)
     VALUES
       ($1, $2, $2, '[]'::jsonb, '\u79c1\u52df\u57fa\u91d1\u7ba1\u7406\u4eba', '[]'::jsonb,
        '[]'::jsonb, NULL, '{}'::jsonb, $3::jsonb, NOW())
     ON CONFLICT (source_id) DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [
      sourceId,
      institutionName,
      JSON.stringify(buildCreatedInstitutionMetadata(sourceBatch)),
    ]
  );
  return { id: inserted.rows[0].id, created: true };
}

async function upsertReport(
  client: PoolClient,
  report: ReportDoc,
  institutionId: string
): Promise<{ id: string; inserted: boolean }> {
  const metadata = {
    parser: "wordml_xml",
    source_kind: SOURCE_KIND,
    normalized_institution_name: normalizeInstitutionName(report.institutionName),
  };
  const res = await client.query<{ id: string; inserted: boolean }>(
    `INSERT INTO zjjr_gp_reports
       (institution_id, institution_name, report_date, region, source_batch,
        source_file_name, source_file_hash, raw_text, text_length, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     ON CONFLICT (source_file_hash) DO UPDATE SET
       institution_id = EXCLUDED.institution_id,
       institution_name = EXCLUDED.institution_name,
       report_date = EXCLUDED.report_date,
       region = EXCLUDED.region,
       source_batch = EXCLUDED.source_batch,
       source_file_name = EXCLUDED.source_file_name,
       raw_text = EXCLUDED.raw_text,
       text_length = EXCLUDED.text_length,
       metadata = zjjr_gp_reports.metadata || EXCLUDED.metadata,
       updated_at = NOW()
     RETURNING id, (xmax = 0) AS inserted`,
    [
      institutionId,
      report.institutionName,
      report.reportDate,
      report.region,
      report.sourceBatch,
      report.fileName,
      report.hash,
      report.text,
      report.text.length,
      JSON.stringify(metadata),
    ]
  );
  return res.rows[0];
}

async function existingFeature(
  client: PoolClient,
  fileHash: string,
  chunkIndex: number
): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM zjjr_features
      WHERE metadata->>'source_file_hash' = $1
        AND metadata->>'chunk_index' = $2
      LIMIT 1`,
    [fileHash, String(chunkIndex)]
  );
  return res.rows.length > 0;
}

async function insertFeature(
  client: PoolClient,
  institutionId: string,
  reportId: string,
  chunk: FeatureChunk,
  embedding: number[] | null,
  reportDate: string | null
): Promise<void> {
  const dataAsOf = reportDate ?? new Date().toISOString().slice(0, 10);
  const validUntil = new Date(
    Date.now() + DEFAULT_VALID_DAYS * 24 * 60 * 60 * 1000
  )
    .toISOString()
    .slice(0, 10);
  await client.query(
    `INSERT INTO zjjr_features
       (feature_kind, institution_id, title, content, embedding,
        data_as_of, valid_until, metadata)
     VALUES ($1,$2,$3,$4,$5::vector,$6,$7,$8::jsonb)`,
    [
      FEATURE_KIND,
      institutionId,
      chunk.title,
      chunk.content,
      embedding ? `[${embedding.join(",")}]` : null,
      dataAsOf,
      validUntil,
      JSON.stringify({ ...chunk.metadata, report_id: reportId }),
    ]
  );
}

async function embedOne(
  text: string,
  skipEmbedding: boolean
): Promise<{ vector: number[] | null; ok: boolean | null }> {
  if (skipEmbedding) return { vector: null, ok: null };
  const res = await generateEmbeddingWithBailian(text);
  const vector = res?.[0]?.vector ?? null;
  if (!vector) return { vector: null, ok: false };
  if (vector.length !== 1536) {
    console.warn(`[embedding] unexpected dimension=${vector.length}`);
    return { vector: null, ok: false };
  }
  return { vector, ok: true };
}

async function writeReports(
  pool: Pool,
  reports: AsyncIterable<ReportDoc>,
  opts: CliOptions,
  stats: ImportStats
): Promise<void> {
  const log = await pool.query<{ id: string }>(
    `INSERT INTO zjjr_sync_log (sync_type, status, records_fetched, records_upserted)
     VALUES ('gp_detail_doc_import', 'running', $1, 0)
     RETURNING id`,
    [0]
  );
  const logId = log.rows[0].id;
  try {
    for await (const report of reports) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const institution = await findInstitution(client, report.institutionName, report.sourceBatch);
        if (institution.created) stats.createdInstitutions += 1;
        else stats.matchedInstitutions += 1;

        const saved = await upsertReport(client, report, institution.id);
        if (saved.inserted) stats.reportInserted += 1;
        else stats.reportUpdated += 1;

        const chunks = buildFeatureChunks(report, opts);
        for (const chunk of chunks) {
          const chunkIndex = Number(chunk.metadata.chunk_index);
          if (opts.resume && (await existingFeature(client, report.hash, chunkIndex))) {
            stats.featuresSkipped += 1;
            continue;
          }
          const embedded = await embedOne(chunk.content, opts.skipEmbedding);
          if (embedded.ok === true) stats.embeddingSuccess += 1;
          if (embedded.ok === false) stats.embeddingFailed += 1;
          await insertFeature(
            client,
            institution.id,
            saved.id,
            chunk,
            embedded.vector,
            report.reportDate
          );
          stats.featuresInserted += 1;
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        console.warn(`[write] skipped report ${report.fileName}:`, e);
      } finally {
        client.release();
      }
    }

    await pool.query(
      `UPDATE zjjr_sync_log
          SET status = 'success',
              finished_at = NOW(),
              records_fetched = $4,
              records_upserted = $2,
              error_detail = $3
        WHERE id = $1`,
      [
        logId,
        stats.reportInserted + stats.reportUpdated,
        `features_inserted=${stats.featuresInserted}; features_skipped=${stats.featuresSkipped}`,
        stats.reportCount,
      ]
    );
  } catch (e) {
    await pool.query(
      `UPDATE zjjr_sync_log
          SET status = 'failed', finished_at = NOW(), error_detail = $2
        WHERE id = $1`,
      [logId, e instanceof Error ? e.message : String(e)]
    );
    throw e;
  }
}

function emptyStats(zipCount: number): ImportStats {
  return {
    zipCount,
    reportCount: 0,
    parsedCount: 0,
    badInstitutionNames: 0,
    badReportDates: 0,
    textLengthMin: 0,
    textLengthMax: 0,
    textLengthSum: 0,
    textLengthCount: 0,
    reportInserted: 0,
    reportUpdated: 0,
    featuresInserted: 0,
    featuresSkipped: 0,
    embeddingSuccess: 0,
    embeddingFailed: 0,
    matchedInstitutions: 0,
    createdInstitutions: 0,
  };
}

function recordReportStats(report: ReportDoc, stats: ImportStats, samples: DryRunSample[]): void {
  stats.reportCount += 1;
  if (report.text) {
    stats.parsedCount += 1;
    const len = report.text.length;
    stats.textLengthMin = stats.textLengthCount === 0 ? len : Math.min(stats.textLengthMin, len);
    stats.textLengthMax = Math.max(stats.textLengthMax, len);
    stats.textLengthSum += len;
    stats.textLengthCount += 1;
  }
  if (isBadInstitutionName(report.institutionName)) stats.badInstitutionNames += 1;
  if (isBadReportDate(report.reportDate)) stats.badReportDates += 1;
  if (samples.length < 5) {
    samples.push({
      institutionName: report.institutionName,
      reportDate: report.reportDate,
      region: report.region,
      preview: report.text.slice(0, 80).replace(/\n/g, " "),
    });
  }
}

async function* iterateReports(plan: InputPlan, opts: Pick<CliOptions, "batchName" | "limit" | "input">): AsyncIterable<ReportDoc> {
  let emitted = 0;
  if (plan.kind === "zip") {
    for (const zipItem of plan.zipPlan.found) {
      const zipReports = iterateZipReports({
        ...zipItem,
        sourceBatch: opts.batchName || zipItem.sourceBatch,
      });
      for await (const report of zipReports) {
        if (opts.limit && emitted >= opts.limit) return;
        emitted += 1;
        yield report;
      }
    }
    return;
  }

  for (const filePath of plan.extractedFiles) {
    if (opts.limit && emitted >= opts.limit) return;
    const report = readExtractedReportDoc(filePath, {
      inputRoot: opts.input,
      region: inferRegion(filePath),
      sourceBatch: opts.batchName,
    });
    emitted += 1;
    yield report;
  }
}

export async function collectDryRun(
  opts: Pick<CliOptions, "input" | "mode" | "batchName" | "limit">
): Promise<{ plan: InputPlan; stats: ImportStats; samples: DryRunSample[] }> {
  const filePaths = walkFiles(opts.input);
  const plan = planInputSources(filePaths, opts);
  const stats = emptyStats(plan.zipPlan.found.length);
  const samples: DryRunSample[] = [];
  for await (const report of iterateReports(plan, opts)) {
    recordReportStats(report, stats, samples);
  }
  return { plan, stats, samples };
}

async function* countedReports(
  reports: AsyncIterable<ReportDoc>,
  stats: ImportStats,
  samples: DryRunSample[]
): AsyncIterable<ReportDoc> {
  for await (const report of reports) {
    recordReportStats(report, stats, samples);
    yield report;
  }
}

function printDryRun(plan: InputPlan, samples: DryRunSample[], stats: ImportStats): void {
  const avg = stats.textLengthCount ? Math.round(stats.textLengthSum / stats.textLengthCount) : 0;
  console.log(`input_mode=${plan.kind}`);
  console.log(`found_zips=${plan.zipPlan.found.length}`);
  for (const item of plan.zipPlan.found) console.log(`found_zip=${item.path}`);
  for (const missing of plan.zipPlan.missing) console.log(`missing_zip=${missing}`);
  console.log(`found_extracted_files=${plan.extractedFiles.length}`);
  console.log(`reports=${stats.reportCount}`);
  console.log(`parsed=${stats.parsedCount}`);
  console.log(`bad_institution_names=${stats.badInstitutionNames}`);
  console.log(`bad_report_dates=${stats.badReportDates}`);
  console.log(
    `text_length_min=${stats.textLengthMin} max=${stats.textLengthMax} avg=${avg}`
  );
  for (const sample of samples) {
    console.log(
      `sample=${sample.institutionName} | ${sample.reportDate ?? "no date"} | ${
        sample.region ?? "no region"
      } | ${sample.preview}`
    );
  }
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const dryRun = await collectDryRun(opts);
  printDryRun(dryRun.plan, dryRun.samples, dryRun.stats);

  if (!opts.write) {
    if (!opts.dryRun) console.log("No --write flag provided; dry-run only.");
    return;
  }
  if (dryRun.stats.badInstitutionNames > 0) {
    throw new Error("Stop: institution names contain decode anomalies.");
  }
  if (!process.env.ZJJR_SYNC_DATABASE_URL && !process.env.DATABASE_URL) {
    throw new Error("Set ZJJR_SYNC_DATABASE_URL or DATABASE_URL before --write.");
  }
  const filePaths = walkFiles(opts.input);
  const plan = planInputSources(filePaths, opts);
  const stats = emptyStats(plan.zipPlan.found.length);
  const samples: DryRunSample[] = [];
  const pool = new Pool({
    connectionString: process.env.ZJJR_SYNC_DATABASE_URL || process.env.DATABASE_URL,
    max: 4,
  });
  await writeReports(pool, countedReports(iterateReports(plan, opts), stats, samples), opts, stats);
  await pool.end();
  console.log(`report_inserted=${stats.reportInserted}`);
  console.log(`report_updated=${stats.reportUpdated}`);
  console.log(`features_inserted=${stats.featuresInserted}`);
  console.log(`features_skipped=${stats.featuresSkipped}`);
  console.log(`embedding_success=${stats.embeddingSuccess}`);
  console.log(`embedding_failed=${stats.embeddingFailed}`);
  console.log(`matched_institutions=${stats.matchedInstitutions}`);
  console.log(`created_institutions=${stats.createdInstitutions}`);
  console.log(`embedding_model=${EMBEDDING_MODEL}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
