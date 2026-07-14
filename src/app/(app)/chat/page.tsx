"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ConversationList,
  type ConversationListItem,
} from "@/components/chat/ConversationList";
import {
  ChatArea,
  type ChatConversation,
  type ChatMsg,
} from "@/components/chat/ChatArea";
import { EmptyState } from "@/components/ui/EmptyState";

const JSON_HEADERS = { "Content-Type": "application/json" };

export default function ChatPage() {
  const [items, setItems] = useState<ConversationListItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<ChatConversation | null>(null);
  const [creating, setCreating] = useState(false);
  const [showListOnMobile, setShowListOnMobile] = useState(true);
  const [pageError, setPageError] = useState("");

  // 拉取对话列表
  const fetchList = useCallback(async () => {
    const res = await fetch("/api/conversations");
    if (!res.ok) return;
    const data = await res.json();
    setItems(data.conversations ?? []);
    return data.conversations as ConversationListItem[];
  }, []);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // 拉取单条对话详情
  const loadConversation = useCallback(async (id: string) => {
    const res = await fetch(`/api/conversations/${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setActive(data.conversation as ChatConversation);
    setActiveId(id);
    setShowListOnMobile(false);
  }, []);

  async function createNew() {
    setCreating(true);
    setPageError("");
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const detail =
          j?.error ||
          `创建失败（HTTP ${res.status}）。若后端首次部署，请先执行数据库迁移 db/migrations/013_conversations.sql。`;
        setPageError(detail);
        console.error("[chat] POST /api/conversations failed", res.status, j);
        return;
      }
      const data = await res.json();
      const id: string | undefined = data?.conversation?.id;
      if (!id) {
        setPageError("接口返回结构异常，缺少 conversation.id");
        return;
      }
      await fetchList();
      await loadConversation(id);
    } catch (e) {
      setPageError(e instanceof Error ? e.message : "网络异常");
    } finally {
      setCreating(false);
    }
  }

  async function deleteConversation(id: string) {
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    setItems((arr) => arr.filter((x) => x.id !== id));
    if (activeId === id) {
      setActive(null);
      setActiveId(null);
    }
  }

  function handleTitleUpdate(id: string, title: string) {
    setItems((arr) =>
      arr.map((x) => (x.id === id ? { ...x, title } : x))
    );
    setActive((cur) => (cur && cur.id === id ? { ...cur, title } : cur));
  }

  function handleMessagesChange(id: string, messages: ChatMsg[]) {
    const nowIso = new Date().toISOString();
    setItems((arr) => {
      const next = arr.map((x) =>
        x.id === id ? { ...x, updated_at: nowIso } : x
      );
      // 重新排序：updated 最新的对话排到最上
      next.sort(
        (a, b) =>
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      return next;
    });
    setActive((cur) =>
      cur && cur.id === id ? { ...cur, messages } : cur
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* 桌面：左列表 + 右对话；移动：单列切换 */}
      <div
        className={`${
          showListOnMobile ? "flex" : "hidden"
        } md:flex h-full`}
      >
        <ConversationList
          items={items}
          activeId={activeId}
          creating={creating}
          onNew={createNew}
          onSelect={loadConversation}
          onDelete={deleteConversation}
        />
      </div>

      <div
        className={`${
          showListOnMobile ? "hidden" : "flex"
        } md:flex h-full flex-1 min-h-0`}
      >
        {active ? (
          <ChatArea
            key={active.id}
            conversation={active}
            onTitleUpdate={handleTitleUpdate}
            onMessagesChange={handleMessagesChange}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center">
            <EmptyState
              icon="💬"
              title="选择一段对话开始"
              description="或者新建一个对话，把你正在思考的问题抛给 AI"
              action={{ label: "+ 新对话", onClick: createNew }}
            />
            {pageError && (
              <p className="mx-6 mt-4 max-w-md rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-600">
                {pageError}
              </p>
            )}
          </div>
        )}
      </div>

      {/* 移动端返回按钮 */}
      {!showListOnMobile && (
        <button
          type="button"
          onClick={() => setShowListOnMobile(true)}
          className="fixed bottom-24 left-4 z-10 rounded-full bg-[#0D1B3E] px-3 py-1.5 text-xs text-white shadow md:hidden"
        >
          ← 列表
        </button>
      )}
    </div>
  );
}
