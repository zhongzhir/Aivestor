/**
 * 本地模式文件上传端点
 * 仅在未配置 OSS 时使用，接收文件并写入本地磁盘
 */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { saveLocalUpload, isOSSEnabled, hasValidDocumentSignature, consumeUploadAttempt } from "@/lib/fileStorage";

export const maxDuration = 120;

const ALLOWED_EXTENSIONS = ["pdf", "docx", "xlsx", "xls", "pptx", "ppt"];
const MAX_FILE_SIZE = 25 * 1024 * 1024;

export async function POST(req: Request) {
  // OSS 已启用时此端点不应被调用
  if (isOSSEnabled()) {
    return NextResponse.json({ error: "OSS 已启用，请使用预签名URL直传" }, { status: 400 });
  }

  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!consumeUploadAttempt(session.user.id)) {
    return NextResponse.json({ error: "上传请求过于频繁，请稍后再试" }, { status: 429 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    // objectKey 不再接受客户端传入：服务端按扩展名自行生成路径，杜绝客户端
    // 控制写入位置（审计 F-12 旁注）。客户端改用响应返回的 fileUrl。
    if (!file) {
      return NextResponse.json({ error: "缺少文件" }, { status: 400 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json({ error: `不支持的文件格式：.${ext}` }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "文件超过 25MB 限制" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!hasValidDocumentSignature(buffer, ext)) {
      return NextResponse.json({ error: "文件内容与扩展名不匹配" }, { status: 400 });
    }
    const fileUrl = await saveLocalUpload(ext, buffer);

    return NextResponse.json({ ok: true, fileUrl });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
