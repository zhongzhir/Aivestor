"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { RESEARCH_KIND_LABELS, type ProjectResearchDraft, type ResearchJudgmentKind } from "@/lib/projectResearch";

async function read(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "暂时无法完成，请重试");
  return data;
}

export function ProjectResearchSave({ conversationId, projectId, messageVersion, disabled }: {
  conversationId: string; projectId: string; messageVersion: string; disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<ProjectResearchDraft | null>(null);
  const [revision, setRevision] = useState("");
  const [preparedVersion, setPreparedVersion] = useState("");
  const [savedVersion, setSavedVersion] = useState("");
  const [everSaved, setEverSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const preparation = useRef<AbortController | null>(null);
  const api = `/api/conversations/${conversationId}/project-research`;
  const current = savedVersion === messageVersion;

  useEffect(() => {
    let cancelled = false;
    void fetch(api).then(read).then((data) => {
      if (!cancelled) { setEverSaved(data.saved); if (data.current) setSavedVersion(messageVersion); }
    }).catch(() => { /* Errors are shown when the user opens the control. */ });
    return () => { cancelled = true; };
  }, [api, messageVersion]);
  useEffect(() => () => preparation.current?.abort(), []);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, [open]);

  async function prepare() {
    setOpen(true); setError("");
    if (draft && preparedVersion === messageVersion) return;
    setBusy(true); setDraft(null);
    const controller = new AbortController(); preparation.current = controller;
    try {
      const data = await read(await fetch(api, { method: "POST", signal: controller.signal }));
      if (controller.signal.aborted) return;
      setDraft(data.draft); setRevision(data.revision); setPreparedVersion(messageVersion); setEditing(false);
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "整理失败"); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }

  function close() { preparation.current?.abort(); setBusy(false); setOpen(false); triggerRef.current?.focus(); }

  async function save() {
    setBusy(true); setSaving(true); setError("");
    try {
      const data = await read(await fetch(api, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision, draft }) }));
      setSavedVersion(messageVersion); setEverSaved(true);
      window.dispatchEvent(new CustomEvent("project-research-saved", { detail: { projectId, points: data.points } }));
      close();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); }
    finally { setBusy(false); setSaving(false); }
  }

  const fieldClass = "mt-1 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm leading-6 text-slate-700 focus:border-accent focus:outline-none";
  return <>
    <button ref={triggerRef} type="button" disabled={disabled || busy} onClick={() => open ? close() : void prepare()}
      aria-expanded={open} aria-haspopup="dialog" className="min-h-10 rounded-lg px-3 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">
      {current ? "已保存到项目" : everSaved ? "更新项目成果" : "保存到项目"}
    </button>
    {open && createPortal(<div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/20 p-4" onClick={(event) => { if (event.target === event.currentTarget && !saving) close(); }}>
      <div ref={panelRef} role="dialog" aria-modal="true" tabIndex={-1} aria-label="保存研究成果到项目"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !saving) { event.stopPropagation(); close(); }
        if (event.key === "Tab") {
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled)'));
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last?.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}
      className="flex max-h-[min(82dvh,720px)] w-full max-w-[34rem] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl outline-none">
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div><h3 className="text-sm font-semibold text-slate-800">保存到项目</h3><p className="mt-1 text-xs leading-5 text-slate-500">一次保存，供后续分析、尽调和决策参考。可直接采用，也可修改。</p></div>
        <button type="button" onClick={close} disabled={saving} aria-label="关闭研究成果" className="min-h-9 min-w-9 rounded-lg text-slate-500 hover:bg-slate-50">×</button>
      </div>
      <div className="min-h-0 overflow-y-auto px-4 py-3">
        {busy && !draft && <p role="status" className="py-5 text-sm text-slate-500">正在整理本次讨论…</p>}
        {draft && <fieldset disabled={busy} className="min-w-0 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">{current ? "本次讨论已保存，可在这里继续修改" : "来源随成果保留，已有内容会合并更新"}</p>
            <button type="button" disabled={busy} onClick={() => setEditing(!editing)} className="shrink-0 rounded px-2 py-1 text-xs text-accent">{editing ? "完成编辑" : "编辑"}</button>
          </div>
          {editing ? <label className="block text-xs text-slate-500">研究摘要<textarea aria-label="研究摘要" value={draft.summary} maxLength={1500} rows={2} className={fieldClass} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} /></label>
            : draft.summary && <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{draft.summary}</p>}
          <section><h4 className="text-xs font-medium text-slate-800">研究判断 <span className="font-normal text-slate-500">· 用于后续分析</span></h4>
            <div className="mt-2 space-y-2">{draft.judgments.map((item, index) => editing ? <div key={index} className="rounded-lg bg-slate-50 p-2">
              <div className="flex justify-between"><select aria-label={`判断${index + 1}类型`} value={item.kind} className="min-h-8 rounded border border-slate-200 bg-white px-2 text-xs" onChange={(e) => setDraft({ ...draft, judgments: draft.judgments.map((j, i) => i === index ? { ...j, kind: e.target.value as ResearchJudgmentKind } : j) })}>
                {Object.entries(RESEARCH_KIND_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
                <button type="button" aria-label={`移除判断${index + 1}`} onClick={() => setDraft({ ...draft, judgments: draft.judgments.filter((_, i) => i !== index) })} className="min-h-8 min-w-8 text-slate-500">×</button></div>
              <textarea aria-label={`判断${index + 1}`} value={item.text} maxLength={800} rows={2} className={fieldClass} onChange={(e) => setDraft({ ...draft, judgments: draft.judgments.map((j, i) => i === index ? { ...j, text: e.target.value } : j) })} />
            </div> : <p key={index} className="text-sm leading-6 text-slate-700"><span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{RESEARCH_KIND_LABELS[item.kind]}</span>{item.text}</p>)}
            {!draft.judgments.length && <p className="text-xs text-slate-400">本次暂无新增判断</p>}
            {editing && draft.judgments.length < 10 && <button type="button" onClick={() => setDraft({ ...draft, judgments: [...draft.judgments, { kind: "hypothesis", text: "" }] })} className="text-xs text-accent">补充判断</button>}</div>
          </section>
          <section><h4 className="text-xs font-medium text-slate-800">待核实事项 <span className="font-normal text-slate-500">· 纳入尽调待办</span></h4>
            {editing ? <textarea aria-label="待核实事项" value={draft.questions.join("\n")} rows={3} className={fieldClass} placeholder="每行一项；留空表示本次不新增" onChange={(e) => setDraft({ ...draft, questions: e.target.value.split("\n") })} />
              : <ul className="mt-2 space-y-1 text-sm leading-6 text-slate-700">{draft.questions.map((q, i) => <li key={i}>· {q}</li>)}{!draft.questions.length && <li className="text-xs text-slate-400">本次暂无新增待办</li>}</ul>}
          </section>
          <section><h4 className="text-xs font-medium text-slate-800">决策参考 <span className="font-normal text-slate-500">· 保存为草稿</span></h4>
            {editing ? <textarea aria-label="决策参考" value={draft.decision} maxLength={3000} rows={3} className={fieldClass} placeholder="没有形成建议时可留空" onChange={(e) => setDraft({ ...draft, decision: e.target.value })} />
              : <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{draft.decision || "本次尚未形成决策建议"}</p>}
          </section>
        </fieldset>}
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
        <Link href={`/projects/${projectId}`} className="text-xs text-slate-500 hover:text-accent">查看项目</Link>
        <button type="button" disabled={busy || disabled} onClick={() => draft && preparedVersion === messageVersion ? void save() : void prepare()} className="min-h-10 rounded-lg bg-accent px-4 text-sm text-white disabled:opacity-50">
          {busy ? "处理中…" : draft && preparedVersion === messageVersion ? "保存到项目" : "重新整理"}
        </button>
      </div>
    </div></div>, document.body)}
  </>;
}
