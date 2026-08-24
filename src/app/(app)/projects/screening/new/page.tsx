"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

function fileType(name:string) { return name.toLowerCase().endsWith(".pdf") ? "pdf" : name.toLowerCase().endsWith(".docx") ? "docx" : ""; }

export default function NewScreeningPage() {
  const router=useRouter(); const [name,setName]=useState(""); const [criteria,setCriteria]=useState("");
  const [files,setFiles]=useState<File[]>([]); const [busy,setBusy]=useState(false); const [message,setMessage]=useState("");
  const [batchId,setBatchId]=useState(""); const [uploadedNames,setUploadedNames]=useState<string[]>([]);
  async function upload(file:File) {
    const signed=await fetch("/api/upload-url",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename:file.name,contentType:file.type})});
    const cred=await signed.json(); if(!signed.ok) throw new Error(cred.error||"获取上传地址失败");
    if(cred.mode==="oss") { const put=await fetch(cred.presignedUrl,{method:"PUT",headers:{"Content-Type":file.type||"application/octet-stream"},body:file}); if(!put.ok) throw new Error("文件上传失败"); return cred.fileUrl as string; }
    const form=new FormData(); form.append("file",file); const local=await fetch("/api/upload-local",{method:"POST",body:form}); const data=await local.json(); if(!local.ok) throw new Error(data.error||"文件上传失败"); return data.fileUrl as string;
  }
  async function submit() {
    if(!name.trim()||files.length===0) { setMessage("请填写批次名称并选择项目材料"); return; }
    if(new Set(files.map(file=>file.name)).size!==files.length) { setMessage("存在同名文件，请先修改文件名后再上传"); return; }
    setBusy(true); setMessage("正在创建批次…");
    try {
      let currentBatchId=batchId;
      if(!currentBatchId) { const created=await fetch("/api/screening-batches",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,criteria})}); const batch=await created.json(); if(!created.ok) throw new Error(batch.error); currentBatchId=batch.id; setBatchId(currentBatchId); }
      const done=new Set(uploadedNames);
      for(let i=0;i<files.length;i++) { const file=files[i]; if(done.has(file.name)) continue; setMessage(`正在解析 ${i+1}/${files.length}：${file.name}`); const url=await upload(file); const res=await fetch(`/api/screening-batches/${currentBatchId}/items`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({fileUrl:url,filename:file.name,fileType:fileType(file.name),fileSize:file.size})}); const data=await res.json(); if(!res.ok) throw new Error(`${file.name}：${data.error}`); done.add(file.name); setUploadedNames(Array.from(done)); }
      const start=await fetch(`/api/screening-batches/${currentBatchId}/start`,{method:"POST"}); const data=await start.json(); if(!start.ok) throw new Error(data.error);
      router.push(`/projects/screening/${currentBatchId}`);
    } catch(e) { setMessage(e instanceof Error?e.message:"创建失败"); setBusy(false); }
  }
  return <div className="mx-auto w-full max-w-3xl px-6 py-8"><div className="rounded-lg border border-line bg-white p-6">
    <h1 className="text-2xl font-semibold text-ink">新建批量初筛</h1><p className="mt-2 text-sm text-ink-soft">每份文件作为一个独立候选项目，小版本单批最多 20 份。</p>
    <label className="mt-6 block text-sm font-medium text-ink">批次名称</label><input value={name} onChange={e=>setName(e.target.value)} disabled={busy||!!batchId} placeholder="例如：本周 FA 推荐项目" className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm disabled:bg-surface"/>
    <label className="mt-5 block text-sm font-medium text-ink">筛选要求 <span className="font-normal text-ink-faint">（选填）</span></label><textarea value={criteria} onChange={e=>setCriteria(e.target.value)} disabled={busy||!!batchId} rows={4} placeholder="可以留空，由 AI 从股权投资视角自主初筛" className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm disabled:bg-surface"/>
    <label className="mt-5 block text-sm font-medium text-ink">项目材料</label><input type="file" multiple accept=".pdf,.docx" disabled={busy||!!batchId} onChange={e=>{const picked=Array.from(e.target.files||[]); setFiles(picked.slice(0,20));}} className="mt-2 block w-full text-sm text-ink-soft"/>
    {files.length>0&&<div className="mt-3 rounded-lg bg-surface p-3 text-xs text-ink-soft">已选择 {files.length} 份：{files.map(f=>f.name).join("、")}</div>}
    {message&&<p className="mt-4 text-sm text-ink-soft">{message}</p>}
    <button onClick={submit} disabled={busy} className="mt-6 h-10 rounded-lg bg-accent px-5 text-sm font-medium text-white disabled:opacity-50">{busy?"正在处理…":batchId?"继续上传并开始":"开始批量初筛"}</button>
  </div></div>;
}
