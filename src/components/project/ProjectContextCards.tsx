"use client";

import { useEffect, useState } from "react";

type Relationship = {
  id: string;
  person_name: string;
  role_title: string | null;
  organization_name: string | null;
  relationship_type: string;
  relationship_strength: number;
  source_note: string | null;
  note: string | null;
};

type KnowledgeCard = {
  id: string;
  title: string | null;
  content: string;
  entry_type: string;
  source_type: string | null;
  created_at: string;
};

const TYPE_LABEL: Record<string, string> = {
  founder: "创始团队", co_investor: "共同投资人", expert: "专家", referrer: "项目来源", customer: "客户", other: "其他",
};

export function ProjectContextCards({ projectId }: { projectId: string }) {
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ person_name: "", role_title: "", organization_name: "", relationship_type: "founder", relationship_strength: "3", source_note: "", note: "" });
  const [error, setError] = useState("");

  async function load() {
    const [r, k] = await Promise.all([
      fetch(`/api/projects/${projectId}/relationships`),
      fetch(`/api/projects/${projectId}/knowledge-cards`),
    ]);
    if (r.ok) setRelationships((await r.json()).relationships ?? []);
    if (k.ok) setCards((await k.json()).cards ?? []);
  }
  useEffect(() => { load().catch(() => {}); }, [projectId]);

  async function addRelationship() {
    setError("");
    if (!form.person_name.trim()) { setError("请填写姓名或机构名称"); return; }
    const res = await fetch(`/api/projects/${projectId}/relationships`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    if (!res.ok) { setError((await res.json()).error ?? "保存失败"); return; }
    setForm({ person_name: "", role_title: "", organization_name: "", relationship_type: "founder", relationship_strength: "3", source_note: "", note: "" });
    setOpen(false); load().catch(() => {});
  }

  async function removeRelationship(id: string) {
    await fetch(`/api/projects/${projectId}/relationships/${id}`, { method: "DELETE" });
    setRelationships((items) => items.filter((item) => item.id !== id));
  }

  return (
    <section className="mt-6 grid gap-6 lg:grid-cols-2">
      <div className="rounded-lg border border-line bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="text-sm font-semibold text-ink">关系与来源</h2><p className="mt-1 text-xs text-ink-faint">记录项目来源、关键人物和沟通背景，方便回到判断现场。</p></div>
          <button onClick={() => setOpen((v) => !v)} className="text-xs font-medium text-accent hover:underline">{open ? "收起" : "+ 添加记录"}</button>
        </div>
        {open && <div className="mt-4 space-y-2 rounded-lg border border-line bg-surface p-3">
          <div className="grid gap-2 sm:grid-cols-2"><input className="w-full rounded-md border border-line bg-white px-3 py-2 text-xs" placeholder="姓名或机构名称" value={form.person_name} onChange={(e) => setForm({ ...form, person_name: e.target.value })} /><input className="w-full rounded-md border border-line bg-white px-3 py-2 text-xs" placeholder="职务 / 角色" value={form.role_title} onChange={(e) => setForm({ ...form, role_title: e.target.value })} /><input className="w-full rounded-md border border-line bg-white px-3 py-2 text-xs" placeholder="所属机构" value={form.organization_name} onChange={(e) => setForm({ ...form, organization_name: e.target.value })} /><select className="w-full rounded-md border border-line bg-white px-3 py-2 text-xs" value={form.relationship_type} onChange={(e) => setForm({ ...form, relationship_type: e.target.value })}>{Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select><select className="w-full rounded-md border border-line bg-white px-3 py-2 text-xs" value={form.relationship_strength} onChange={(e) => setForm({ ...form, relationship_strength: e.target.value })}><option value="1">关系强度：1 / 5</option><option value="2">关系强度：2 / 5</option><option value="3">关系强度：3 / 5</option><option value="4">关系强度：4 / 5</option><option value="5">关系强度：5 / 5</option></select></div>
          <input className="w-full rounded-md border border-line bg-white px-3 py-2 text-xs" placeholder="认识来源，例如：老股东介绍 / 行业会议" value={form.source_note} onChange={(e) => setForm({ ...form, source_note: e.target.value })} />
          <textarea className="min-h-16 w-full rounded-md border border-line bg-white px-3 py-2 text-xs" placeholder="补充备注" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          {error && <p className="text-xs text-red-600">{error}</p>}<button onClick={addRelationship} className="rounded-md bg-[#2f6f4f] px-3 py-2 text-xs font-medium text-white">保存关系记录</button>
        </div>}
        <div className="mt-4 space-y-2">{relationships.length === 0 ? <p className="text-xs text-ink-faint">还没有关系记录。</p> : relationships.map((r) => <div key={r.id} className="flex items-start justify-between gap-3 border-t border-line pt-3"><div><p className="text-sm text-ink">{r.person_name} <span className="text-xs text-ink-faint">{TYPE_LABEL[r.relationship_type] ?? "其他"}</span></p><p className="mt-1 text-xs text-ink-soft">{[r.role_title, r.organization_name, r.source_note].filter(Boolean).join(" · ") || "暂无背景记录"}</p></div><button onClick={() => removeRelationship(r.id)} className="text-xs text-ink-faint hover:text-red-600">删除</button></div>)}</div>
      </div>
      <div className="rounded-lg border border-line bg-white p-5"><h2 className="text-sm font-semibold text-ink">相关知识</h2><p className="mt-1 text-xs text-ink-faint">与本项目关联的历史判断和研究，可作为当前分析的参考。</p><div className="mt-4 space-y-3">{cards.length === 0 ? <p className="text-xs text-ink-faint">暂无关联知识。完成报告或判断后，可将有长期价值的内容沉淀下来。</p> : cards.map((card) => <article key={card.id} className="border-t border-line pt-3"><div className="flex items-center gap-2 text-xs text-ink-faint"><span>{card.source_type === "report" ? "分析报告" : "知识条目"}</span><span>{new Date(card.created_at).toLocaleDateString("zh-CN")}</span></div><h3 className="mt-1 text-sm font-medium text-ink">{card.title || "项目判断"}</h3><p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-ink-soft">{card.content}</p></article>)}</div></div>
    </section>
  );
}
