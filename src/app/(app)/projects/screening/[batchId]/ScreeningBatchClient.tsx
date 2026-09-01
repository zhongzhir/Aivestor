"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ResultNextActions } from "@/components/shared/ResultNextActions";

type Result={disposition:string;summary:string;strengths:string[];risks:string[];missing_information:string[];criteria_fit:string|null;evidence:{claim:string;quote:string}[];confidence:string};
type Item={id:string;name:string;filename:string;status:string;result:Result|null;error:string|null;promoted_project_id:string|null};
type Data={batch:{id:string;name:string;criteria:string|null;status:string};items:Item[]};
const label:Record<string,string>={continue:"建议继续了解",more_info:"需要补充信息",not_priority:"暂不优先"};
const tone:Record<string,string>={continue:"bg-emerald-50 text-emerald-700",more_info:"bg-amber-50 text-amber-700",not_priority:"bg-slate-100 text-slate-600"};

export default function ScreeningBatchClient({batchId}:{batchId:string}) {
  const [data,setData]=useState<Data|null>(null); const [error,setError]=useState(""); const [busy,setBusy]=useState("");
  const load=useCallback(async()=>{const r=await fetch(`/api/screening-batches/${batchId}`,{cache:"no-store"});const d=await r.json();if(r.ok)setData(d);else setError(d.error||"加载失败");},[batchId]);
  useEffect(()=>{void load();const timer=setInterval(()=>void load(),3000);return()=>clearInterval(timer);},[load]);
  async function act(item:Item,kind:"retry"|"promote") {setBusy(item.id+kind);const r=await fetch(`/api/screening-batches/${batchId}/items/${item.id}/${kind}`,{method:"POST"});const d=await r.json();if(!r.ok)setError(d.error||"操作失败");else await load();setBusy("");}
  if(!data)return <div className="p-8 text-sm text-ink-soft">{error||"正在加载…"}</div>;
  const completed=data.items.filter(i=>i.status==="completed").length;
  return <div className="mx-auto w-full max-w-7xl px-6 py-8 lg:px-8">
    <div className="rounded-lg border border-line bg-white p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><Link href="/projects/screening" className="text-xs text-accent">← 返回批量初筛</Link><h1 className="mt-2 text-2xl font-semibold text-ink">{data.batch.name}</h1><p className="mt-2 text-sm text-ink-soft">{data.batch.criteria||"未填写筛选要求，由 AI 自主初筛"}</p></div><a href={`/api/screening-batches/${batchId}/export`} className="inline-flex h-10 items-center justify-center rounded-lg border border-line px-4 text-sm text-ink">导出结果</a></div>
      <p className="mt-5 text-sm text-ink-soft">已完成 {completed}/{data.items.length}{data.batch.status==="processing"?"，系统正在继续处理":""}</p></div>
    {error&&<div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="mt-6 space-y-4">{data.items.map(item=><div key={item.id} className="rounded-lg border border-line bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-medium text-ink">{item.name}</h2><p className="mt-1 text-xs text-ink-faint">{item.filename}</p></div><div className="flex items-center gap-2">{item.result&&<span className={`rounded-full px-3 py-1 text-xs ${tone[item.result.disposition]}`}>{label[item.result.disposition]}</span>}{item.status==="processing"&&<span className="text-xs text-ink-soft">正在分析…</span>}{item.status==="pending"&&<span className="text-xs text-ink-soft">等待处理</span>}</div></div>
      {item.result&&<div className="mt-4"><p className="text-sm font-medium text-ink">{item.result.summary}</p>{item.result.criteria_fit&&<p className="mt-3 rounded bg-surface p-3 text-sm text-ink-soft">筛选要求匹配：{item.result.criteria_fit}</p>}<div className="mt-4 grid gap-4 md:grid-cols-3"><List title="值得关注" values={item.result.strengths}/><List title="主要风险" values={item.result.risks}/><List title="待补信息" values={item.result.missing_information}/></div>{item.result.evidence.length>0&&<details className="mt-4"><summary className="cursor-pointer text-sm text-accent">查看材料证据</summary><div className="mt-2 space-y-2">{item.result.evidence.map((e,i)=><blockquote key={i} className="border-l-2 border-line pl-3 text-xs leading-5 text-ink-soft"><b>{e.claim}</b>：“{e.quote}”</blockquote>)}</div></details>}</div>}
      {item.status==="failed"&&<div className="mt-4 flex items-center justify-between gap-3 rounded bg-red-50 p-3 text-sm text-red-700"><span>{item.error||"处理失败"}</span><button onClick={()=>act(item,"retry")} disabled={busy===item.id+"retry"} className="shrink-0 font-medium">重试</button></div>}
      {item.status==="completed"&&<div className="mt-4">{item.promoted_project_id?<ResultNextActions compact title="候选已进入正式项目" description="初筛结果和原材料已经进入项目，可以继续补充证据或推进正式分析。" actions={[{label:"打开项目",href:`/projects/${item.promoted_project_id}`,primary:true},{label:"生成简要分析",href:`/projects/${item.promoted_project_id}/brief-analysis`},{label:"进入 IC",href:`/projects/${item.promoted_project_id}?tab=decision&focus=ic`},{label:"维护下一步",href:`/projects/${item.promoted_project_id}?focus=next-action`}]} />:<div className="flex justify-end"><button onClick={()=>act(item,"promote")} disabled={busy===item.id+"promote"} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">转为正式项目</button></div>}</div>}
    </div>)}</div>
  </div>;
}
function List({title,values}:{title:string;values:string[]}) {return <div><h3 className="text-xs font-medium text-ink-soft">{title}</h3>{values.length?<ul className="mt-2 space-y-1 text-sm leading-6 text-ink">{values.map((v,i)=><li key={i}>• {v}</li>)}</ul>:<p className="mt-2 text-sm text-ink-faint">材料未提供</p>}</div>}
