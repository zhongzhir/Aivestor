/**
 * Import ZJJR GP detail WordML reports into the public ZJJR data layer.
 *
 * This script deliberately does not write knowledge_base_entries. Reports are
 * archived in zjjr_gp_reports and chunked into zjjr_features for AI retrieval.
 *
 * Examples:
 *   npx ts-node -T services/zjjr-sync/import-gp-detail-docs.ts --input "C:\path\中鉴数据" --dry-run
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
  "C:\\Users\\46554\\WPSDrive\\421507599\\WPS云盘\\AIVESTOR\\中鉴数据";
const DEFAULT_BATCH = "GP详情-上海杭州-202607";
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
}

interface ImportStats {
  zipCount: number;
  reportCount: number;
  parsedCount: number;
  badInstitutionNames: number;
  badReportDates: number;
  textLengths: number[];
  reportInserted: number;
  reportUpdated: number;
  featuresInserted: number;
  featuresSkipped: number;
  embeddingSuccess: number;
  embeddingFailed: number;
  matchedInstitutions: number;
  createdInstitutions: number;
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

function inferRegion(filePath: string): string | null {
  const name = path.basename(filePath);
  if (name.includes("上海")) return "上海";
  if (name.includes("杭州")) return "杭州";
  if (name.includes("浙江")) return "浙江";
  return null;
}

export function planInputZips(filePaths: string[]): ZipPlan {
  const found = filePaths
    .filter((p) => path.basename(p).startsWith("GP详情") && p.toLowerCase().endsWith(".zip"))
    .map((p) => ({
      path: p,
      region: inferRegion(p) ?? "未知",
      sourceBatch: path.basename(p, path.extname(p)),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  const hasShanghai = found.some((x) => x.region.includes("上海"));
  const hasHangzhou = found.some((x) => x.region.includes("杭州"));
  const missing: string[] = [];
  if (!hasShanghai) missing.push("GP详情（上海）相关 ZIP");
  if (!hasHangzhou) missing.push("GP详情（杭州）相关 ZIP");

  return { found, missing };
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
  const base = path.basename(fileName).replace(/\.docx?$/i, "");
  const m = base.match(/^(.*?)(20\d{12})尽调报告$/);
  if (!m) return { institutionName: base.trim(), reportDate: null };
  const raw = m[2];
  return {
    institutionName: m[1].trim(),
    reportDate: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`,
  };
}

function isBadInstitutionName(name: string): boolean {
  return !name || name.includes("�") || /[\uFFFD]/.test(name) || name.length < 2;
}

function isBadReportDate(date: string | null): boolean {
  return !date || !/^20\d{2}-\d{2}-\d{2}$/.test(date);
}

export function normalizeInstitutionName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[（）()]/g, "")
    .replace(/私募基金管理/g, "")
    .replace(/基金管理/g, "")
    .replace(/股权投资管理/g, "")
    .replace(/投资管理/g, "")
    .replace(/有限责任公司$/g, "")
    .replace(/有限公司$/g, "")
    .replace(/有限合伙$/g, "")
    .replace(/合伙企业$/g, "")
    .replace(/中心$/g, "")
    .trim();
}

async function readZipReports(zipItem: ZipPlanItem): Promise<ReportDoc[]> {
  const gbkDecoder = new TextDecoder("gbk");
  const zip = await JSZip.loadAsync(fs.readFileSync(zipItem.path), {
    decodeFileName: (bytes) =>
      gbkDecoder.decode(bytes as Uint8Array<ArrayBufferLike>),
  });

  const reports: ReportDoc[] = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.toLowerCase().endsWith(".doc")) continue;
    const buffer = await entry.async("nodebuffer");
    const xml = buffer.toString("utf8");
    if (!xml.trimStart().startsWith("<?xml")) {
      throw new Error(`Unsupported .doc format: ${entry.name}`);
    }
    const text = parseWordMlText(xml);
    const { institutionName, reportDate } = parseInstitutionName(entry.name);
    reports.push({
      fileName: path.basename(entry.name),
      institutionName,
      reportDate,
      region: zipItem.region,
      sourceBatch: zipItem.sourceBatch,
      text,
      hash: sha256Buffer(buffer),
    });
  }
  return reports;
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
      "【GP尽调报告】",
      `机构：${report.institutionName}`,
      `地区：${report.region ?? "未识别"}`,
      `报告日期：${report.reportDate ?? "未识别"}`,
      `来源批次：${report.sourceBatch}`,
      `片段：${chunkIndex}/${total}`,
      "",
      chunk,
    ].join("\n");
    return {
      title: `${report.institutionName} 尽调报告片段 ${chunkIndex}/${total}`,
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
       ($1, $2, $2, '[]'::jsonb, '私募基金管理人', '[]'::jsonb,
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
  reports: ReportDoc[],
  opts: CliOptions,
  stats: ImportStats
): Promise<void> {
  const log = await pool.query<{ id: string }>(
    `INSERT INTO zjjr_sync_log (sync_type, status, records_fetched, records_upserted)
     VALUES ('gp_detail_doc_import', 'running', $1, 0)
     RETURNING id`,
    [reports.length]
  );
  const logId = log.rows[0].id;
  try {
    for (const report of reports) {
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
              records_upserted = $2,
              error_detail = $3
        WHERE id = $1`,
      [
        logId,
        stats.reportInserted + stats.reportUpdated,
        `features_inserted=${stats.featuresInserted}; features_skipped=${stats.featuresSkipped}`,
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
    textLengths: [],
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

function printDryRun(plan: ZipPlan, reports: ReportDoc[], stats: ImportStats): void {
  const lengths = stats.textLengths;
  const avg = lengths.length
    ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length)
    : 0;
  console.log(`found_zips=${plan.found.length}`);
  for (const item of plan.found) console.log(`found_zip=${item.path}`);
  for (const missing of plan.missing) console.log(`missing_zip=${missing}`);
  console.log(`reports=${stats.reportCount}`);
  console.log(`parsed=${stats.parsedCount}`);
  console.log(`bad_institution_names=${stats.badInstitutionNames}`);
  console.log(`bad_report_dates=${stats.badReportDates}`);
  console.log(
    `text_length_min=${lengths.length ? Math.min(...lengths) : 0} max=${
      lengths.length ? Math.max(...lengths) : 0
    } avg=${avg}`
  );
  for (const sample of reports.slice(0, 5)) {
    console.log(
      `sample=${sample.institutionName} | ${sample.reportDate ?? "no date"} | ${
        sample.region ?? "no region"
      } | ${sample.text.slice(0, 80).replace(/\n/g, " ")}`
    );
  }
}

async function collectReports(opts: CliOptions): Promise<{ plan: ZipPlan; reports: ReportDoc[]; stats: ImportStats }> {
  const filePaths = walkFiles(opts.input);
  const plan = planInputZips(filePaths);
  const stats = emptyStats(plan.found.length);
  const reports: ReportDoc[] = [];
  for (const zipItem of plan.found) {
    const zipReports = await readZipReports({
      ...zipItem,
      sourceBatch: opts.batchName || zipItem.sourceBatch,
    });
    for (const report of zipReports) {
      if (opts.limit && reports.length >= opts.limit) break;
      reports.push(report);
      stats.reportCount += 1;
      if (!report.text) continue;
      stats.parsedCount += 1;
      if (isBadInstitutionName(report.institutionName)) stats.badInstitutionNames += 1;
      if (isBadReportDate(report.reportDate)) stats.badReportDates += 1;
      stats.textLengths.push(report.text.length);
    }
    if (opts.limit && reports.length >= opts.limit) break;
  }
  return { plan, reports, stats };
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const { plan, reports, stats } = await collectReports(opts);
  printDryRun(plan, reports, stats);

  if (!opts.write) {
    if (!opts.dryRun) console.log("No --write flag provided; dry-run only.");
    return;
  }
  if (stats.badInstitutionNames > 0) {
    throw new Error("Stop: institution names contain decode anomalies.");
  }
  if (!process.env.ZJJR_SYNC_DATABASE_URL && !process.env.DATABASE_URL) {
    throw new Error("Set ZJJR_SYNC_DATABASE_URL or DATABASE_URL before --write.");
  }
  const pool = new Pool({
    connectionString: process.env.ZJJR_SYNC_DATABASE_URL || process.env.DATABASE_URL,
    max: 4,
  });
  await writeReports(pool, reports, opts, stats);
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
