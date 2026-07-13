import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getUploadCredential, consumeUploadAttempt } from "@/lib/fileStorage";

export const maxDuration = 60;

const ALLOWED_EXTENSIONS = ["pdf", "docx", "xlsx", "xls", "pptx", "ppt"];

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!consumeUploadAttempt(session.user.id)) {
    return NextResponse.json({ error: "上传请求过于频繁，请稍后再试" }, { status: 429 });
  }
  try {
    const body = await req.json();
    const { filename, contentType } = body as { filename: string; contentType?: string };

    if (!filename) {
      return NextResponse.json({ error: "缺少文件名" }, { status: 400 });
    }
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json({ error: `不支持的文件格式：.${ext}` }, { status: 400 });
    }

    const credential = await getUploadCredential(filename, contentType || "application/octet-stream");
    return NextResponse.json(credential);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
