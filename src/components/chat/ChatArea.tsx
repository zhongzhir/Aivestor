"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DigestCard } from "@/components/report/DigestCard";
import type { ConversationSource } from "@/lib/conversationResearch";
import { remarkResearchCitations, researchCitationIndices } from "@/lib/researchCitations";

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  ts: string;
  sources?: ConversationSource[];
}

export interface ChatConversation {
  id: string;
  title: string | null;
  project_id: string | null;
  project_name: string | null;
  messages: ChatMsg[];
}

interface Props {
  conversation: ChatConversation;
  onTitleUpdate: (id: string, title: string) => void;
  onMessagesChange: (id: string, messages: ChatMsg[]) => void;
  onStreamingChange?: (streaming: boolean) => void;
  disabled?: boolean;
}

const QUICK_STARTS = [
  "帮我复盘最近看的几个项目，找出判断规律",
  "我对某赛道还不够了解，帮我建立认知框架",
  "我在纠结一个项目，想从不同角度讨论一下",
  "帮我总结一下我的投资风格和偏好",
];

const MAX_LEN = 2000;

export function ChatArea({
  conversation,
  onTitleUpdate,
  onMessagesChange,
  onStreamingChange,
  disabled = false,
}: Props) {
  const [messages, setMessages] = useState<ChatMsg[]>(
    conversation.messages ?? []
  );
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [streamingSources, setStreamingSources] = useState<ChatMsg["sources"]>(
    []
  );
  const [error, setError] = useState("");
  // 偏好捕获条：(messageIndex, pref)，messageIndex 指向 messages 数组中的 AI 消息
  const [pendingPref, setPendingPref] = useState<{
    pref: string;
    messageIndex: number;
  } | null>(null);
  const [prefSaved, setPrefSaved] = useState(false);
  const [prefError, setPrefError] = useState("");
  const [prefSaving, setPrefSaving] = useState(false);
  // 后台静默沉淀完成后的极简提示（2 秒消失），以及手动沉淀浮层开关
  const [digestToast, setDigestToast] = useState(false);
  const [showDigestPanel, setShowDigestPanel] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const digestToastTimer = useRef<number | null>(null);
  useEffect(() => { onStreamingChange?.(streaming); }, [streaming, onStreamingChange]);

  // 卸载时清理 toast 定时器
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (digestToastTimer.current) window.clearTimeout(digestToastTimer.current);
    };
  }, []);

  function flashDigestToast() {
    if (digestToastTimer.current) window.clearTimeout(digestToastTimer.current);
    setDigestToast(true);
    digestToastTimer.current = window.setTimeout(
      () => setDigestToast(false),
      2000
    );
  }

  // 切换对话时同步外部 messages
  useEffect(() => {
    setMessages(conversation.messages ?? []);
    setStreamingText("");
    setStreamingSources([]);
    setError("");
    setStreaming(false);
  }, [conversation.id, conversation.messages]);

  // 自动滚动到底部
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !followLatest.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streamingText]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || message.length > MAX_LEN || streaming || disabled) return;
    followLatest.current = true;
    setError("");
    setInput("");

    const now = new Date().toISOString();
    const userMsg: ChatMsg = { role: "user", content: message, ts: now };
    const optimisticMessages = [...messages, userMsg];
    setMessages(optimisticMessages);
    setStreaming(true);
    setStreamingText("");
    setStreamingSources([]);

    const controller = new AbortController();
    abortRef.current = controller;

    let fullReply = "";
    let sources: ChatMsg["sources"] = [];
    let savePref: string | null = null;
    let completed = false;
    try {
      const res = await fetch(
        `/api/conversations/${conversation.id}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
          signal: controller.signal,
        }
      );
      if (!res.ok || !res.body) {
        const errJson = await res
          .json()
          .catch(() => ({ error: "发送失败" }));
        throw new Error(errJson.error || "发送失败");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6);
          if (raw === "[DONE]") { completed = true; continue; }
          try {
            const msg = JSON.parse(raw);
            if (msg.type === "sources") {
              sources = msg.sources ?? [];
              setStreamingSources(sources);
            } else if (msg.type === "text") {
              fullReply += msg.text;
              setStreamingText(fullReply);
            } else if (msg.type === "title") {
              onTitleUpdate(conversation.id, msg.title);
            } else if (msg.type === "save_pref") {
              savePref = typeof msg.pref === "string" ? msg.pref : null;
            } else if (msg.type === "saved") {
              completed = true;
            } else if (msg.type === "auto_digest") {
              // 后台已静默沉淀入库，仅给一个 2 秒消失的极简提示
              flashDigestToast();
            } else if (msg.type === "error") {
              throw new Error(msg.error);
            }
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message) {
              throw parseErr;
            }
          }
        }
      }
      if (!completed) throw new Error("连接中断，问题已保留，请重试");
    } catch (e) {
      if (!completed) {
      if (e instanceof Error && e.name === "AbortError") {
        // 用户主动停止
      } else {
        setError(e instanceof Error ? e.message : "发送失败");
      }
      setInput(message);
      setMessages(messages);
      setStreaming(false);
      setStreamingText("");
      setStreamingSources([]);
      return;
      }
    } finally {
      abortRef.current = null;
    }

    // 兜底：即使后端没发 save_pref SSE 事件，也能从 fullReply 里抠出来
    if (!savePref) {
      const m = fullReply.match(/\[SAVE_PREF:\s*(.+?)\]/);
      if (m) savePref = m[1].trim();
    }
    const cleanedReply = fullReply
      .replace(/\n?\[SAVE_PREF:\s*.+?\]\s*$/, "")
      .trim();

    const assistantMsg: ChatMsg = {
      role: "assistant",
      content: cleanedReply,
      ts: new Date().toISOString(),
      sources,
    };
    const finalMessages = [...optimisticMessages, assistantMsg];
    setMessages(finalMessages);
    setStreaming(false);
    setStreamingText("");
    setStreamingSources([]);
    if (savePref) {
      setPendingPref({ pref: savePref, messageIndex: finalMessages.length - 1 });
      setPrefSaved(false);
    }
    onMessagesChange(conversation.id, finalMessages);
  }

  async function confirmPref() {
    if (!pendingPref || prefSaving) return;
    setPrefError("");
    setPrefSaving(true);
    try {
      const res = await fetch("/api/user/profile/append-pref", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pref: pendingPref.pref }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        setPrefSaved(true);
        window.setTimeout(() => setPendingPref(null), 2000);
      } else {
        const detail =
          data?.error ||
          `保存失败（HTTP ${res.status}）。请稍后重试。`;
        console.error("[append-pref] 失败", res.status, data);
        setPrefError(detail);
      }
    } catch (e) {
      console.error("[append-pref] 网络异常", e);
      setPrefError(
        e instanceof Error ? e.message : "网络异常，请稍后重试"
      );
    } finally {
      setPrefSaving(false);
    }
  }

  function dismissPref() {
    setPendingPref(null);
    setPrefSaved(false);
    setPrefError("");
  }

  function stop() {
    abortRef.current?.abort();
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  }

  const overLimit = input.length > MAX_LEN;
  const turnCount = messages.length;

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col bg-white">
      {/* 消息区 */}
      <div
        ref={scrollerRef}
        data-research-scroll
        onScroll={(event) => {
          const el = event.currentTarget;
          followLatest.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-6"
      >
        {messages.length === 0 && !streaming ? (
          <div className="mx-auto max-w-2xl py-6 sm:py-10">
            <p className="text-base font-medium text-slate-800">
              想从哪里开始？
            </p>
            <div className="mt-4 grid gap-2">
              {(conversation.project_id ? ["这个项目最值得核验的假设是什么？", "结合项目材料，分析主要风险及其依据"] : QUICK_STARTS).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => send(q)}
                  disabled={disabled}
                  className="min-h-11 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-left text-sm text-slate-600 transition-colors hover:border-accent hover:bg-accent-soft disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-7">
            {messages.map((m, i) => (
              <div key={i}>
                <MessageBubble message={m} />
                {pendingPref &&
                  pendingPref.messageIndex === i &&
                  m.role === "assistant" && (
                    <PrefConfirmBar
                      pref={pendingPref.pref}
                      saved={prefSaved}
                      saving={prefSaving}
                      error={prefError}
                      onConfirm={confirmPref}
                      onDismiss={dismissPref}
                    />
                  )}
              </div>
            ))}
            {streaming && (
              <MessageBubble
                message={{
                  role: "assistant",
                  content: streamingText,
                  ts: new Date().toISOString(),
                  sources: streamingSources,
                }}
                streaming
              />
            )}
          </div>
        )}
      </div>

      {/* 后台静默沉淀完成提示：浮层、不占位、2 秒消失 */}
      {digestToast && (
        <div className="pointer-events-none absolute bottom-32 left-1/2 z-20 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full border border-green-200 bg-white/95 px-3.5 py-1.5 text-xs text-slate-600 shadow-sm backdrop-blur">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            已更新知识库
          </div>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="px-6">
          <div className="mx-auto max-w-3xl">
            <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          </div>
        </div>
      )}

      {/* 输入区 */}
      <div className="shrink-0 bg-white px-4 pb-4 pt-2 sm:px-6">
        <div className="relative mx-auto max-w-3xl rounded-2xl border border-slate-300 bg-white p-3 shadow-[0_2px_8px_rgba(15,23,42,0.04)] focus-within:border-accent focus-within:ring-2 focus-within:ring-accent-soft">
          {/* 手动沉淀浮层：主动查看/编辑本次对话将沉淀的内容 */}
          {showDigestPanel && (
            <div className="absolute bottom-full right-0 z-30 mb-2 w-[min(92vw,28rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-lg">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-ink">
                  研究沉淀
                </p>
                <button
                  type="button"
                  onClick={() => setShowDigestPanel(false)}
                  className="text-sm text-slate-400 hover:text-slate-600"
                  aria-label="关闭"
                >
                  ✕
                </button>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                生成纪要后可编辑保存，对话也会自动沉淀。
              </p>
              <div className="mt-1 max-h-[60vh] overflow-y-auto">
                <DigestCard
                  compact
                  conversationId={conversation.id}
                  projectId={conversation.project_id}
                  projectName={
                    conversation.project_name ??
                    conversation.title ??
                    "独立对话"
                  }
                  conversationLength={turnCount}
                  onDigested={flashDigestToast}
                />
              </div>
            </div>
          )}
          <textarea
            aria-label="研究问题"
            aria-invalid={overLimit || undefined}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            disabled={streaming || disabled}
            rows={2}
            placeholder={conversation.project_id ? "围绕项目提问，或继续追问…" : "输入你的问题…"}
            className="block w-full resize-none border-0 bg-transparent px-1 py-1 text-[15px] text-slate-800 placeholder:text-slate-500 focus:outline-none disabled:text-slate-500"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span
              className={`text-xs ${
                overLimit ? "text-red-600" : "text-slate-500"
              }`}
            >
              {input.length > 1600 ? `${input.length} / ${MAX_LEN}` : <span className="hidden sm:inline">Enter 发送 · Shift+Enter 换行</span>}
            </span>
            <div className="flex items-center gap-2">
              {/* 静默沉淀入口：主动查看本次对话将沉淀的内容（≥3 条消息才可提炼） */}
              {turnCount >= 3 && (
                <button
                  type="button"
                  onClick={() => setShowDigestPanel((v) => !v)}
                  aria-label="查看将沉淀到知识库的内容"
                  title="沉淀到知识库"
                  aria-expanded={showDigestPanel}
                  className={`min-h-10 rounded-lg px-3 text-xs transition-colors duration-150 ${
                    showDigestPanel
                      ? "bg-accent-soft text-accent"
                      : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                  }`}
                >
                  沉淀
                </button>
              )}
              {streaming ? (
                <button
                  type="button"
                  onClick={stop}
                  className="min-h-10 rounded-lg border border-red-300 px-4 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
                >
                  停止
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => send(input)}
                  disabled={!input.trim() || overLimit || disabled}
                  className="min-h-10 rounded-lg bg-accent px-5 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  发送
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  streaming,
}: {
  message: ChatMsg;
  streaming?: boolean;
}) {
  const [showSources, setShowSources] = useState(false);
  const sourcePrefix = useId();
  const isUser = message.role === "user";
  const citedIndices = researchCitationIndices(message.content, message.sources?.length ?? 0);
  const visibleSources = (message.sources ?? []).map((source, index) => ({ source, index }))
    .filter(({ index }) => citedIndices.length === 0 || citedIndices.includes(index));
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={isUser ? "max-w-[90%] sm:max-w-[85%]" : "w-full min-w-0"}>
        <div
          title={new Date(message.ts).toLocaleString("zh-CN")}
          className={
            isUser
              ? "inline-block rounded-2xl rounded-tr-md bg-slate-100 px-4 py-3 text-[15px] text-slate-800"
              : "research-markdown py-1"
          }
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <>
              {message.content ? (
                <ReactMarkdown remarkPlugins={[remarkGfm, [remarkResearchCitations, { sourceCount: message.sources?.length ?? 0 }]]} components={{
                  a: ({ href, children }) => {
                    const reference = href?.match(/^#source-(\d+)$/);
                    if (reference) {
                      const index = Number(reference[1]) - 1;
                      if (!message.sources?.[index]) return <span>{children}</span>;
                      return <button type="button" className="research-citation" aria-label={`查看资料 ${index + 1}`}
                        onClick={() => {
                          setShowSources(true);
                          window.requestAnimationFrame(() => {
                            const source = document.getElementById(`${sourcePrefix}-${index}`);
                            const scroller = source?.closest<HTMLElement>("[data-research-scroll]");
                            if (!source || !scroller) return;
                            const delta = source.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
                            scroller.scrollTo({ top: scroller.scrollTop + delta - 16, behavior: "smooth" });
                          });
                        }}>{children}</button>;
                    }
                    return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
                  },
                }}>{message.content}</ReactMarkdown>
              ) : (
                <span className="text-slate-400">…</span>
              )}
              {streaming && <span className="type-cursor" />}
            </>
          )}
        </div>
        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="mt-2 text-xs text-slate-500">
            <button
              type="button"
              onClick={() => setShowSources((v) => !v)}
              aria-expanded={showSources}
              aria-controls={`${sourcePrefix}-sources`}
              className="min-h-9 rounded-lg px-2 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
            >
              {showSources ? "收起来源" : citedIndices.length ? "查看来源" : "参考资料"} · {visibleSources.length}
            </button>
            {showSources && (
              <ul id={`${sourcePrefix}-sources`} className="mt-2 space-y-2">
                {visibleSources.map(({ source: s, index: i }) => (
                  <li
                    key={i}
                    id={`${sourcePrefix}-${i}`}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-slate-600"
                  >
                    <p className="font-medium text-ink-soft">[{i + 1}] {s.title || s.source_type || "知识条目"}{s.locator ? ` · ${s.locator}` : ""}</p>
                    {s.data_as_of && <p className="mt-1">数据截止：{s.data_as_of}</p>}
                    <p className="mt-1 whitespace-pre-wrap leading-5">{s.content}</p>
                    {s.href?.startsWith("/reports/") && <a className="mt-1 inline-block text-accent underline" href={s.href}>查看原报告</a>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PrefConfirmBar({
  pref,
  saved,
  saving,
  error,
  onConfirm,
  onDismiss,
}: {
  pref: string;
  saved: boolean;
  saving: boolean;
  error: string;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  if (saved) {
    return (
      <div className="mt-2 rounded-lg border-l-2 border-blue-500 bg-[#1B6FE808] px-3 py-2 text-xs text-blue-700 transition-opacity duration-500">
        ✅ 已加入你的投资人画像
      </div>
    );
  }
  return (
    <div className="mt-2 rounded-lg border-l-2 border-blue-500 bg-[#1B6FE808] px-3 py-2 text-xs">
      <div className="flex items-center justify-between gap-3">
        <p className="flex-1 text-ink-soft">
          💡 发现新偏好：「<span className="text-ink">{pref}</span>」
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className="rounded border border-blue-500 bg-white px-2 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          >
            {saving ? "保存中…" : "加入画像"}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={saving}
            className="rounded border border-slate-200 bg-white px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-50"
          >
            忽略
          </button>
        </div>
      </div>
      {error && (
        <p className="mt-1.5 rounded bg-red-50 px-2 py-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
