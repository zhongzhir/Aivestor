import assert from "node:assert/strict";
import {
  REPORT_CONTEXT_DOC_KINDS,
  buildReportContextText,
  isUsableReportContextDocument,
  isUsableReportContextMetadata,
} from "@/lib/reportContext";

const allowedKinds = ["bp", "research", "financial_model", "other"];
const excludedKinds = [
  "contract",
  "news",
  "post_financial_report",
  "post_audit_report",
  "post_operating_report",
  "post_board_material",
  "post_shareholder_material",
];

assert.deepEqual([...REPORT_CONTEXT_DOC_KINDS], allowedKinds);

for (const docKind of allowedKinds) {
  assert.equal(
    isUsableReportContextMetadata({ docKind, parseStatus: "done", chars: 1 }),
    true,
    `${docKind} should satisfy the UI report gate when parsed with content`
  );
  assert.equal(
    isUsableReportContextDocument({ doc_kind: docKind, extracted_text: "正文" }),
    true,
    `${docKind} should satisfy the API report gate when text is present`
  );
  assert.equal(
    buildReportContextText([{ doc_kind: docKind, extracted_text: "  正文  " }]),
    "正文",
    `${docKind} should provide trimmed context to the report endpoint`
  );
}

for (const docKind of excludedKinds) {
  assert.equal(
    isUsableReportContextMetadata({ docKind, parseStatus: "done", chars: 100 }),
    false,
    `${docKind} must not satisfy the UI report gate`
  );
  assert.equal(
    isUsableReportContextDocument({ doc_kind: docKind, extracted_text: "正文" }),
    false,
    `${docKind} must not satisfy the API report gate`
  );
  assert.equal(
    buildReportContextText([{ doc_kind: docKind, extracted_text: "正文" }]),
    "",
    `${docKind} must not provide context to the report endpoint`
  );
}

for (const parseStatus of ["pending", "processing", "failed", "error"]) {
  assert.equal(
    isUsableReportContextMetadata({ docKind: "bp", parseStatus, chars: 100 }),
    false,
    `${parseStatus} documents must not satisfy the UI report gate`
  );
}

for (const chars of [0, -1, Number.NaN]) {
  assert.equal(
    isUsableReportContextMetadata({ docKind: "bp", parseStatus: "done", chars }),
    false,
    `${String(chars)} characters must not satisfy the UI report gate`
  );
}

for (const extractedText of [null, undefined, "", "   \n\t  "]) {
  assert.equal(
    isUsableReportContextDocument({ doc_kind: "bp", extracted_text: extractedText }),
    false,
    "empty extracted text must not satisfy the API report gate"
  );
  assert.equal(
    buildReportContextText([{ doc_kind: "bp", extracted_text: extractedText }]),
    "",
    "empty extracted text must keep the report endpoint gate closed"
  );
}

assert.equal(
  buildReportContextText([
    { doc_kind: "contract", extracted_text: "合同正文" },
    { doc_kind: "bp", extracted_text: "  BP 正文  " },
    { doc_kind: "research", extracted_text: "研究正文" },
    { doc_kind: "other", extracted_text: "   " },
  ]),
  "BP 正文\n\n---\n\n研究正文"
);

console.log("report context gate matrix passed");
