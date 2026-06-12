"use client";

import { useEffect, useState } from "react";
import { readError } from "@/lib/clientAI";

interface Comment {
  id: string;
  user_id: string;
  user_name: string | null;
  content: string;
  reply_to: string | null;
  created_at: string;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

// 项目评论侧栏（仅组织项目渲染）。组件自身判断：若接口返回空且非组织项目，
// 由父组件按 isOrgProject 控制是否挂载。
export function CommentPanel({
  projectId,
  currentUserId,
}: {
  projectId: string;
  currentUserId?: string;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [input, setInput] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch(`/api/projects/${projectId}/comments`);
    if (res.ok) setComments((await res.json()).comments ?? []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function submit() {
    const content = input.trim();
    if (!content) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/comments`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ content, reply_to: replyTo }),
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      setInput("");
      setReplyTo(null);
      await load();
    } finally {
      setLoading(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/projects/${projectId}/comments/${id}`, {
      method: "DELETE",
    });
    if (res.ok) await load();
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-ink border-b border-line pb-2">
        团队评论
      </h2>

      <div className="space-y-3">
        {comments.length === 0 && (
          <p className="text-xs text-ink-soft">暂无评论，开始讨论吧。</p>
        )}
        {comments.map((c) => (
          <div key={c.id} className="text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium text-ink">
                {c.user_name ?? "组织成员"}
                {c.reply_to ? " · 回复" : ""}
              </span>
              <span className="text-ink-soft">
                {new Date(c.created_at).toLocaleString("zh-CN")}
              </span>
            </div>
            <p className="mt-1 text-ink-soft whitespace-pre-wrap">{c.content}</p>
            <div className="mt-1 flex gap-3">
              <button
                onClick={() => setReplyTo(c.reply_to ?? c.id)}
                className="text-accent hover:underline"
              >
                回复
              </button>
              {c.user_id === currentUserId && (
                <button
                  onClick={() => remove(c.id)}
                  className="text-ink-soft hover:underline"
                >
                  删除
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {replyTo && (
        <p className="text-xs text-accent">
          回复中…{" "}
          <button onClick={() => setReplyTo(null)} className="underline">
            取消
          </button>
        </p>
      )}
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        rows={2}
        placeholder="写下你的评论…"
        className="w-full rounded border border-line bg-transparent p-2 text-xs text-ink"
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <button
        onClick={submit}
        disabled={loading || !input.trim()}
        className="text-xs font-medium text-accent hover:underline disabled:opacity-50"
      >
        {loading ? "发送中…" : "发表评论"}
      </button>
    </section>
  );
}
