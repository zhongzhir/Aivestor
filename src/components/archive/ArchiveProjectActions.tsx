"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ArchiveProjectActions({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function deleteProject() {
    if (
      !window.confirm(
        `确定删除“${projectName}”吗？删除后将不再显示。`
      )
    ) {
      return;
    }

    setDeleting(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "删除失败，请稍后重试");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败，请稍后重试");
      setDeleting(false);
    }
  }

  return (
    <div className="relative shrink-0 text-right">
      <button
        type="button"
        onClick={deleteProject}
        disabled={deleting}
        className="rounded-md border border-transparent px-2 py-1 text-xs text-slate-400 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-wait disabled:opacity-60"
        aria-label={`删除项目 ${projectName}`}
      >
        {deleting ? "删除中…" : "删除"}
      </button>
      {error && (
        <p className="absolute right-0 top-8 z-10 w-48 rounded-md border border-red-100 bg-white p-2 text-left text-xs text-red-600 shadow-lg">
          {error}
        </p>
      )}
    </div>
  );
}
