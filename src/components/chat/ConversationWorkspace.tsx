"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChatArea, type ChatConversation, type ChatMsg } from "./ChatArea";
import { ConversationList, type ConversationListItem } from "./ConversationList";

interface Props { projectId?: string; projectName?: string }
interface ProjectOption { id: string; name: string }

async function readResponse(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "暂时无法完成，请重试");
  return data;
}

/** Both entrances use the same conversation IDs and permission checks. */
export function ConversationWorkspace({ projectId, projectName }: Props) {
  const embedded = !!projectId;
  const [items, setItems] = useState<ConversationListItem[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [selectedProject, setSelectedProject] = useState(projectId ?? "");
  const [active, setActive] = useState<ChatConversation | null>(null);
  const [busy, setBusy] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [showList, setShowList] = useState(false);
  const requestVersion = useRef(0);
  const listUrl = projectId ? `/api/conversations?project_id=${encodeURIComponent(projectId)}` : "/api/conversations";

  const fetchList = useCallback(async () => {
    const data = await readResponse(await fetch(listUrl));
    const conversations = (data.conversations ?? []) as ConversationListItem[];
    setItems(conversations);
    return conversations;
  }, [listUrl]);

  const load = useCallback(async (id: string) => {
    const data = await readResponse(await fetch(`/api/conversations/${id}`));
    const conversation = data.conversation as ChatConversation;
    if (projectId && conversation.project_id !== projectId) throw new Error("该对话不属于当前项目");
    return conversation;
  }, [projectId]);

  const initialize = useCallback(async () => {
    const version = ++requestVersion.current;
    setBusy(true); setError("");
    try {
      const conversations = await fetchList();
      let options: ProjectOption[] = [];
      if (!projectId) {
        const data = await readResponse(await fetch("/api/projects?sort=updated_desc"));
        options = data.projects ?? [];
      }
      const params = new URLSearchParams(window.location.search);
      const requested = !projectId ? params.get("conversation") : null;
      const requestedProject = !projectId ? params.get("project") : projectId;
      const target = requested || (requestedProject ? conversations.find((item) => item.project_id === requestedProject)?.id : null);
      const conversation = target ? await load(target) : null;
      if (version !== requestVersion.current) return;
      setProjects(options); setActive(conversation);
      setSelectedProject(projectId || conversation?.project_id || (options.some((p) => p.id === requestedProject) ? requestedProject! : ""));
    } catch (e) {
      if (version === requestVersion.current) setError(e instanceof Error ? e.message : "加载失败");
    } finally { if (version === requestVersion.current) setBusy(false); }
  }, [fetchList, load, projectId]);

  useEffect(() => { void initialize(); return () => { requestVersion.current++; }; }, [initialize]);

  useEffect(() => {
    if (embedded || busy || error) return;
    const url = new URL(window.location.href);
    if (active) url.searchParams.set("conversation", active.id);
    else url.searchParams.delete("conversation");
    const project = active?.project_id || selectedProject;
    if (project) url.searchParams.set("project", project);
    else url.searchParams.delete("project");
    window.history.replaceState(window.history.state, "", url);
  }, [active, selectedProject, busy, embedded, error]);

  async function run(action: () => Promise<void>) {
    if (busy || streaming) return;
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); }
    finally { setBusy(false); }
  }

  async function create(project = selectedProject) {
    const data = await readResponse(await fetch("/api/conversations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: project || undefined }),
    }));
    const conversation = await load(data.conversation.id);
    setActive(conversation); setSelectedProject(conversation.project_id ?? ""); setShowList(false);
    await fetchList();
  }

  async function chooseProject(nextProject: string) {
    await run(async () => {
      if (!active) { setSelectedProject(nextProject); return; }
      if (active.project_id && active.messages.length && active.project_id !== nextProject) {
        await create(nextProject);
        return;
      }
      await readResponse(await fetch(`/api/conversations/${active.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: nextProject || null }),
      }));
      setActive(await load(active.id)); setSelectedProject(nextProject);
      await fetchList();
    });
  }

  function selectConversation(id: string) {
    void run(async () => {
      const conversation = await load(id);
      setActive(conversation); setSelectedProject(conversation.project_id ?? ""); setShowList(false);
    });
  }

  function onTitleUpdate(id: string, title: string) {
    setItems((list) => list.map((item) => item.id === id ? { ...item, title } : item));
    setActive((current) => current?.id === id ? { ...current, title } : current);
  }

  function onMessagesChange(id: string, messages: ChatMsg[]) {
    setActive((current) => current?.id === id ? { ...current, messages } : current);
    setItems((list) => list.map((item) => item.id === id ? { ...item, updated_at: new Date().toISOString() } : item)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
  }

  return (
    <section aria-label="项目研究对话" className={embedded
      ? "research-workspace mt-4 flex h-[min(560px,72dvh)] min-h-[440px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_2px_12px_rgba(15,23,42,0.03)]"
      : "research-workspace flex h-full min-h-0 flex-col bg-white"}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-white px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <h2 className="text-[15px] font-semibold tracking-normal text-slate-800">项目研究对话</h2>
          {!embedded && (
            <label className="flex min-w-0 items-center gap-2 text-sm text-ink-soft">
              <span className="sr-only">研究项目</span>
              <select aria-label="研究项目" value={selectedProject} onChange={(e) => void chooseProject(e.target.value)} disabled={busy || streaming}
                className="min-h-10 w-full min-w-0 max-w-[240px] rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700">
                <option value="">不指定项目</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {embedded && items.length > 0 && <select aria-label="项目对话记录" value="" disabled={busy || streaming}
            onChange={(e) => selectConversation(e.target.value)} className="min-h-10 max-w-[180px] rounded-lg border border-transparent bg-white px-2 text-slate-600 hover:bg-slate-50">
            <option value="" disabled>历史记录</option>
            {items.map((item) => <option key={item.id} value={item.id}>{item.title || "新对话"}</option>)}
          </select>}
          {embedded && active && <button type="button" disabled={busy || streaming} onClick={() => void run(() => create())} className="min-h-10 rounded-lg px-3 text-slate-600 hover:bg-slate-50 disabled:opacity-50">新对话</button>}
          {embedded ? <Link href={`/chat?project=${projectId}${active ? `&conversation=${active.id}` : ""}`} aria-label="在研究对话中打开" className="inline-flex min-h-10 items-center rounded-lg px-3 text-accent hover:bg-accent-soft">展开对话</Link>
            : active?.project_id && <Link href={`/projects/${active.project_id}`} className="inline-flex min-h-10 items-center rounded-lg px-3 text-accent hover:bg-accent-soft">返回项目</Link>}
          {!embedded && <button type="button" onClick={() => setShowList(!showList)} disabled={busy || streaming} className="min-h-10 rounded-lg px-3 text-slate-600 hover:bg-slate-50 md:hidden">{showList ? "返回对话" : "历史记录"}</button>}
        </div>
      </div>
      {error && <div role="alert" className="flex items-center justify-between gap-3 bg-red-50 px-4 py-2 text-sm text-red-700">
        <span>{error}</span><button type="button" disabled={busy || streaming} onClick={() => void initialize()} className="shrink-0 underline">重新加载</button>
      </div>}
      <div className="flex min-h-0 flex-1">
        {!embedded && <div className={`${showList ? "flex" : "hidden"} min-h-0 w-full md:flex md:w-auto ${busy || streaming ? "pointer-events-none opacity-60" : ""}`}>
          <ConversationList items={items} activeId={active?.id ?? null} creating={busy || streaming}
            onNew={() => void run(() => create())} onSelect={selectConversation}
            onDelete={(id) => run(async () => {
              await readResponse(await fetch(`/api/conversations/${id}`, { method: "DELETE" }));
              if (active?.id === id) setActive(null);
              await fetchList();
            })} />
        </div>}
        <div className={`${!embedded && showList ? "hidden md:flex" : "flex"} min-h-0 min-w-0 flex-1`}>
          {active ? <ChatArea key={active.id} conversation={active} disabled={busy} onTitleUpdate={onTitleUpdate} onMessagesChange={onMessagesChange} onStreamingChange={setStreaming} /> : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-lg font-medium tracking-tight text-slate-800">{busy ? "正在读取对话…" : "从你的问题开始"}</p>
              <p className="max-w-md text-sm leading-6 text-slate-500">{selectedProject ? `结合${projectName || projects.find((p) => p.id === selectedProject)?.name || "当前项目"}的材料，随时提问、追问依据。` : "自由讨论，或选择一个项目参考已有材料。"}</p>
              <button type="button" disabled={busy || streaming || !!error} onClick={() => void run(() => create())}
                className="min-h-10 rounded-lg bg-accent px-5 py-2 text-sm text-white disabled:opacity-50">{selectedProject ? "开始项目研究" : "新对话"}</button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
