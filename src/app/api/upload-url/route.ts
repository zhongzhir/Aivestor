import { NextResponse } from "next/server";
import OSS from "ali-oss";
import { getSession } from "@/lib/auth";
import { randomUUID } from "crypto";

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
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

function getOSSClient() {
  return new OSS({
    region: process.env.OSS_REGION!,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
    bucket: process.env.OSS_BUCKET!,
  });
}

function validateFile(file: File): { valid: boolean; error?: string } {
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: "文件超过 25MB 限制，请压缩后重试" };
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

    const ext = file.name.split(".").pop()?.toLowerCase();
    const objectKey = `uploads/${randomUUID()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const client = getOSSClient();
    await client.put(objectKey, buffer, {
      mime: file.type || "application/octet-stream",
    });

    // 返回内网可访问的 OSS 路径（服务端解析文件时使用）
    const url = `oss://${process.env.OSS_BUCKET}/${objectKey}`;
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
