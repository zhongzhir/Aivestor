"use client";

import { Suspense } from "react";
import { IntelligenceWorkspace } from "./IntelligenceWorkspace";

export default function IntelligenceSubscriptions() {
  return (
    <Suspense fallback={<div className="rounded-lg border border-line bg-white px-4 py-8 text-sm text-ink-faint">正在加载情报工作空间…</div>}>
      <IntelligenceWorkspace />
    </Suspense>
  );
}
