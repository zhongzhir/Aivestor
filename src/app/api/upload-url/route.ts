import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getSession } from "@/lib/auth";

export const maxDuration = 60;

const ALLOWED_EXTENSIONS = ["pdf", "docx", "xlsx", "xls", "pptx", "ppt"];
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
];
const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB（Vercel 限制）

function validateFile(file: File): { valid: boolean; error?: string } {
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: "文件超过 4MB 限制，请压缩后重试" };
  }
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
    return { valid: false, error: `不支持的文件格式：.${ext ?? ""}` };
  }
  // 部分浏览器对 Office 文档的 MIME 留空，留空时放行（已由扩展名兜底）。
  if (file.type && !ALLOWED_MIME_TYPES.includes(file.type)) {
    return { valid: false, error: "文件类型验证失败，请上传合法的办公文档" };
  }
  return { valid: true };
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    if (!file) {
      return NextResponse.json({ error: "未收到文件" }, { status: 400 });
    }
    const check = validateFile(file);
    if (!check.valid) {
      return NextResponse.json({ error: check.error }, { status: 400 });
    }
    const blob = await put(file.name, file, {
      access: "private",
      addRandomSuffix: true,
    });
    return NextResponse.json({ url: blob.url });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
