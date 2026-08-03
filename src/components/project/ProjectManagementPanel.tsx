"use client";

import { useEffect, useMemo, useState } from "react";

interface Option { id: string; name: string }

interface Props {
  projectId: string;
  compact?: boolean;
}

export function ProjectManagementPanel({ projectId, compact = false }: Props) {
  const [categories, setCategories] = useState<Option[]>([]);
  const [tags, setTags] = useState<Option[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [projectTags, setProjectTags] = useState<Option[]>([]);
  const [isPriority, setIsPriority] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [categoryInput, setCategoryInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    try {
      const res = await fetch(`/api/projects/${projectId}/management`);
      if (!res.ok) return;
      const data = await res.json();
      setCategories(data.categories ?? []);
      setTags(data.tags ?? []);
      setCategoryId(data.categoryId ?? "");
      setProjectTags(data.projectTags ?? []);
      setIsPriority(Boolean(data.isPriority));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [projectId]);

  async function save(next: { categoryId?: string; isPriority?: boolean; tags?: Option[] }) {
    setSaving(true); setMessage("");
    try {
      const nextTags = next.tags ?? projectTags;
      const res = await fetch(`/api/projects/${projectId}/management`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: (next.categoryId ?? categoryId) || null,
          isPriority: next.isPriority ?? isPriority,
          tags: nextTags.map((tag) => tag.name),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "保存失败");
      if (next.categoryId !== undefined) setCategoryId(next.categoryId);
      if (next.isPriority !== undefined) setIsPriority(next.isPriority);
      if (next.tags) setProjectTags(next.tags);
      setMessage("已保存");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); }
    finally { setSaving(false); }
  }

  async function createCategory() {
    if (!categoryInput.trim()) return;
    const res = await fetch(`/api/project-categories?projectId=${projectId}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: categoryInput }),
    });
    const data = await res.json();
    if (!res.ok) { setMessage(data.error || "分类创建失败"); return; }
    setCategories((prev) => [...prev, data.category].sort((a, b) => a.name.localeCompare(b.name)));
    setCategoryInput("");
    await save({ categoryId: data.category.id });
  }

  function addTags() {
    const values = tagInput.split(/[，,]/).map((v) => v.trim()).filter(Boolean);
    const next = [...projectTags];
    for (const value of values) {
      const existing = tags.find((tag) => tag.name.trim().normalize("NFKC").toLocaleLowerCase("zh-CN") === value.normalize("NFKC").toLocaleLowerCase("zh-CN"));
      const item = existing ?? { id: `new-${value}`, name: value };
      if (!next.some((tag) => tag.name.trim().normalize("NFKC").toLocaleLowerCase("zh-CN") === item.name.trim().normalize("NFKC").toLocaleLowerCase("zh-CN"))) next.push(item);
    }
    setTagInput("");
    void save({ tags: next });
  }

  async function editCategory(category: Option) {
    const name = window.prompt("修改分类名称", category.name);
    if (!name || name.trim() === category.name) return;
    const res = await fetch(`/api/project-categories/${category.id}?projectId=${projectId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    if (!res.ok) { setMessage((await res.json()).error || "修改失败"); return; }
    setCategories((prev) => prev.map((item) => item.id === category.id ? { ...item, name: name.trim() } : item));
  }

  async function deleteCategory(category: Option) {
    if (!window.confirm(`删除分类“${category.name}”？项目不会被删除。`)) return;
    const res = await fetch(`/api/project-categories/${category.id}?projectId=${projectId}`, { method: "DELETE" });
    if (!res.ok) { setMessage((await res.json()).error || "删除失败"); return; }
    setCategories((prev) => prev.filter((item) => item.id !== category.id));
    if (categoryId === category.id) { setCategoryId(""); await save({ categoryId: "" }); }
  }

  const suggestedTags = useMemo(() => tags.filter((tag) => !projectTags.some((item) => item.id === tag.id)).slice(0, 8), [tags, projectTags]);
  if (loading) return <div className="mt-4 rounded-lg border border-line bg-white p-4 text-xs text-ink-faint">正在加载项目管理信息…</div>;

  return (
    <section className={`rounded-lg border border-line bg-white ${compact ? "p-3" : "mt-4 p-4"}`} aria-label="项目管理">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-sm font-medium text-ink">项目管理</p><p className="mt-0.5 text-xs text-ink-faint">分类、标签和重点标记用于工作队列检索</p></div>
        <button type="button" onClick={() => void save({ isPriority: !isPriority })} disabled={saving} className={`rounded-md px-2.5 py-1.5 text-xs font-medium ${isPriority ? "bg-amber-50 text-amber-700" : "border border-line text-ink-soft"}`} aria-pressed={isPriority}>{isPriority ? "★ 重点项目" : "☆ 标记重点"}</button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs text-ink-soft">自定义分类</label>
          <div className="mt-1 flex gap-2"><select value={categoryId} onChange={(e) => void save({ categoryId: e.target.value })} className="min-w-0 flex-1 rounded-md border border-line px-2 py-1.5 text-sm"><option value="">未分类</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input value={categoryInput} onChange={(e) => setCategoryInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void createCategory(); } }} placeholder="新分类" className="w-24 rounded-md border border-line px-2 py-1.5 text-xs" /></div>
          <div className="mt-2 flex flex-wrap gap-2">{categories.map((item) => <span key={item.id} className="text-[11px] text-ink-faint"><button type="button" onClick={() => void editCategory(item)} className="hover:text-ink">编辑 {item.name}</button><button type="button" onClick={() => void deleteCategory(item)} className="ml-1 text-red-500 hover:text-red-700">删除</button></span>)}</div>
        </div>
        <div>
          <label className="text-xs text-ink-soft">标签</label>
          <div className="mt-1 flex gap-2"><input list={`project-tags-${projectId}`} value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTags(); } }} placeholder="输入标签，回车添加" className="min-w-0 flex-1 rounded-md border border-line px-2 py-1.5 text-sm" /><button type="button" onClick={addTags} disabled={!tagInput.trim() || saving} className="rounded-md border border-line px-2 text-xs text-ink-soft">添加</button></div>
          <datalist id={`project-tags-${projectId}`}>{tags.map((tag) => <option key={tag.id} value={tag.name} />)}</datalist>
          <div className="mt-2 flex flex-wrap gap-1.5">{projectTags.map((tag) => <button key={tag.id} type="button" onClick={() => void save({ tags: projectTags.filter((item) => item.name !== tag.name) })} className="rounded-full bg-surface px-2 py-0.5 text-xs text-ink-soft">{tag.name} ×</button>)}{suggestedTags.length > 0 && <span className="text-[11px] text-ink-faint">已有标签：{suggestedTags.slice(0, 3).map((tag) => tag.name).join("、")}</span>}</div>
        </div>
      </div>
      {message && <p className="mt-2 text-xs text-ink-soft" role="status">{message}</p>}
    </section>
  );
}
