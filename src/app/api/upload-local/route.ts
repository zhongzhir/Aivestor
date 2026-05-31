/**
 * 本地模式文件上传端点
 * 仅在未配置 OSS 时使用，接收文件并写入本地磁盘
 */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { saveLocalFile, isOSSEnabled } from "@/lib/fileStorage";

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

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const objectKey = formData.get("objectKey") as string;

    if (!file || !objectKey) {
      return NextResponse.json({ error: "缺少文件或路径" }, { status: 400 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json({ error: `不支持的文件格式：.${ext}` }, { status: 400 });
    }
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "文件超过 25MB 限制" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    await saveLocalFile(objectKey, buffer);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
