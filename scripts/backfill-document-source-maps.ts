import { query } from "../src/lib/db";
import { readFileBuffer } from "../src/lib/fileStorage";
import { parseFile } from "../src/lib/fileParser";
import { processDocumentChunks } from "../src/lib/documentChunks";

interface DocumentRow {
  id: string;
  user_id: string;
  filename: string;
  file_type: string;
  file_url: string;
}

async function main() {
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const requestedLimit = Number(limitArg?.split("=")[1] ?? 50);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(500, Math.floor(requestedLimit)))
    : 50;
  const docs = await query<DocumentRow>(
    `SELECT id, user_id, filename, file_type, file_url
       FROM documents
      WHERE file_url IS NOT NULL
        AND file_type = ANY($1::text[])
        AND jsonb_array_length(COALESCE(source_map, '[]'::jsonb)) = 0
      ORDER BY created_at ASC
      LIMIT $2`,
    [["pdf", "docx", "pptx", "xlsx", "xls"], limit]
  );
  let completed = 0;
  let failed = 0;
  for (const doc of docs) {
    try {
      const buffer = await readFileBuffer(doc.file_url);
      const parsed = await parseFile(buffer, doc.file_type, doc.filename);
      if (parsed.sourceMap.length === 0) throw new Error("没有生成定位信息");
      await query(
        `UPDATE documents
            SET extracted_text = $1, source_map = $2, updated_at = NOW()
          WHERE id = $3`,
        [parsed.text, JSON.stringify(parsed.sourceMap), doc.id]
      );
      await query("DELETE FROM document_chunks WHERE document_id = $1", [doc.id]);
      await processDocumentChunks(doc.id, doc.user_id, parsed.text, parsed.sourceMap);
      completed++;
      console.log(`[source-map] ${doc.id} ${doc.filename}: ${parsed.sourceMap.length} locators`);
    } catch (error) {
      failed++;
      console.error(`[source-map] ${doc.id} ${doc.filename}:`, error);
    }
  }
  console.log(JSON.stringify({ selected: docs.length, completed, failed, limit }));
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
