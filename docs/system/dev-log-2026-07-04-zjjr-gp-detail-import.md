# ZJJR GP Detail Import Dev Log - 2026-07-04

## 1. Target

Import ZJJR GP due diligence reports for Shanghai Hongkou and Hangzhou into the Aivestor public ZJJR data layer, so the reports become AI-searchable and injectable data assets.

## 2. Data Sources

- `GP&#x8BE6;&#x60C5;&#xFF08;&#x4E0A;&#x6D77;&#x8679;&#x53E3;&#xFF09;.zip`
- `GP&#x8BE6;&#x60C5;&#xFF08;&#x676D;&#x5DDE;&#xFF09;.zip`

## 3. Final Database Results

`source_batch`: `GP&#x8BE6;&#x60C5;-&#x4E0A;&#x6D77;&#x676D;&#x5DDE;-202607`

`zjjr_gp_reports`:

- total: 783
- Shanghai: 112
- Hangzhou: 671

`zjjr_features`:

- total: 4189
- Shanghai: 677
- Hangzhou: 3512
- embedded: 4189
- no_embedding: 0

Institution matching:

- matched_institutions: 768
- created_institutions: 15

Embedding:

- embedding_model: `text-embedding-v4`

## 4. Deduplication Verification

Second execution result:

```text
report_inserted=0
report_updated=783
features_inserted=0
features_skipped=4189
embedding_success=0
embedding_failed=0
matched_institutions=783
created_institutions=0
```

## 5. Key Implementation

- Added and updated `services/zjjr-sync/import-gp-detail-docs.ts`.
- Supports `--mode extracted`.
- Recursively scans `.doc`, `.xml`, and extensionless WordML files.
- Parses and processes one file at a time to avoid JSZip loading the 1.6G Hangzhou ZIP into Node memory.
- Writes only to:
  - `zjjr_gp_reports`
  - `zjjr_features`
  - `zjjr_institutions`
  - `zjjr_sync_log`
- Does not write:
  - `knowledge_base_entries`
  - `org_id`
  - `visibility`

## 6. Production Issues And Resolution

1. Original ZIP mode caused Node OOM when processing the 1.6G Hangzhou ZIP, which triggered an ECS restart.
2. Production switched to system `unzip`, then imported with `--mode extracted` so reports are parsed one file at a time.
3. Production writes use the dedicated `zjjr_sync` database account; the `aivestor` account has only `SELECT` permission on this data layer.
4. `ZJJR_SYNC_DATABASE_URL` has been written to `.env.local`.
5. Temporary swap was enabled as import protection, then disabled and removed after import.
6. `zjjr-sync` PM2 reported missing `dist/fixtures/sample.json`; the build now copies `services/zjjr-sync/fixtures` into `services/zjjr-sync/dist/fixtures`.

## 7. Production Directory Notes

Original ZIP directory, temporarily retained:

```text
/var/www/Aivestor/data/imports/zjjr-gp-details
```

Extracted directory, temporarily retained:

```text
/var/www/Aivestor/data/imports/zjjr-gp-details-extracted
```

Keep both directories until frontend AI search and injection verification is complete.

## 8. zjjr-insights PM2 Behavior

`zjjr-insights` is configured as a cron-style one-shot PM2 task. It runs on its cron schedule, generates the weekly market insight, and exits. Therefore `stopped` can be normal between scheduled executions and does not by itself indicate a fault.

## 9. Follow-Up Verification

1. Verify that frontend institution lookup can retrieve GP due diligence report snippets.
2. Verify that AI chat and report generation can inject `gp_due_diligence_report` features.
3. Manually review the 15 institutions with `created_from=gp_detail_doc_import` and merge where needed.
4. Clean up ZIP and extracted temporary directories after verification is complete.
