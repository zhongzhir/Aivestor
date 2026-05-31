import { NextResponse } from "next/server";
import OSS from "ali-oss";
import { getSession } from "@/lib/auth";
import { randomUUID } from "crypto";

export const maxDuration = 60;

const ALLOWED_EXTENSIONS = ["pdf", "docx", "xlsx", "xls", "pptx", "ppt"];

function getOSSClient() {
  return new OSS({
    region: process.env.OSS_REGION!,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
    bucket: process.env.OSS_BUCKET!,
  });
}

// 生成预签名 URL，供浏览器直传 OSS（PUT 方式）
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
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

    const objectKey = `uploads/${randomUUID()}.${ext}`;
    const client = getOSSClient();

    // 生成 10 分钟有效的预签名 PUT URL
    const presignedUrl = client.signatureUrl(objectKey, {
      method: "PUT",
      expires: 600,
      "Content-Type": contentType || "application/octet-stream",
    });

    // ossUrl 供服务端后续读取文件用
    const ossUrl = `oss://${process.env.OSS_BUCKET}/${objectKey}`;

    return NextResponse.json({ presignedUrl, ossUrl });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
