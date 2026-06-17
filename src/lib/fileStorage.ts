/**
 * 文件存储抽象层
 *
 * 支持两种模式：
 *  - OSS 模式：配置了 OSS_BUCKET 环境变量时使用（云端部署）
 *  - 本地模式：未配置 OSS 时，文件存储在服务器本地 /uploads 目录（本地化部署）
 *
 * URL 格式：
 *  - OSS：  oss://bucket/uploads/xxx.pdf
 *  - 本地： local://uploads/xxx.pdf
 */

import { randomUUID } from "crypto";
import path from "path";
import fs from "fs/promises";

// 本地存储根目录（Docker volume 挂载点）
const LOCAL_UPLOAD_DIR = process.env.LOCAL_UPLOAD_DIR || "/app/uploads";

export function isOSSEnabled(): boolean {
  return !!(
    process.env.OSS_BUCKET &&
    process.env.OSS_ACCESS_KEY_ID &&
    process.env.OSS_ACCESS_KEY_SECRET &&
    process.env.OSS_REGION
  );
}

function getOSSClient() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const OSS = require("ali-oss");
  return new OSS({
    region: process.env.OSS_REGION!,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
    bucket: process.env.OSS_BUCKET!,
    // 强制预签名 URL 使用 https。页面已升级 HTTPS 后必须开，
    // 否则浏览器会拦截 Mixed Content（http:// PUT 请求被阻断）。
    secure: true,
  });
}

/**
 * 生成上传凭证
 *  - OSS 模式：返回预签名 PUT URL（浏览器直传）
 *  - 本地模式：返回服务端上传端点（/api/upload-local）
 */
export async function getUploadCredential(filename: string, contentType: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "bin";
  const objectKey = `uploads/${randomUUID()}.${ext}`;

  if (isOSSEnabled()) {
    const client = getOSSClient();
    const presignedUrl = client.signatureUrl(objectKey, {
      method: "PUT",
      expires: 600,
      "Content-Type": contentType || "application/octet-stream",
    });
    return {
      mode: "oss" as const,
      presignedUrl,
      fileUrl: `oss://${process.env.OSS_BUCKET}/${objectKey}`,
    };
  } else {
    // 本地模式：前端把文件 POST 到 /api/upload-local，由服务端写盘
    return {
      mode: "local" as const,
      uploadEndpoint: "/api/upload-local",
      fileUrl: `local://${objectKey}`,
    };
  }
}

/**
 * 把文件写入本地磁盘（本地模式上传端点使用）
 */
export async function saveLocalFile(objectKey: string, buffer: Buffer): Promise<void> {
  const rel = path.posix.normalize(objectKey.replace(/^uploads\//, ""));
  if (rel.startsWith("..") || rel.includes("\0") || path.isAbsolute(rel)) {
    throw new Error("非法的文件路径");
  }
  const filePath = path.resolve(LOCAL_UPLOAD_DIR, rel);
  const root = path.resolve(LOCAL_UPLOAD_DIR);
  if (!filePath.startsWith(root + path.sep) && filePath !== root) {
    throw new Error("非法的文件路径");
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
}

/**
 * 本地模式上传：服务端自行生成 objectKey 并写盘，返回 local:// fileUrl。
 * 不接受客户端传入的 objectKey（审计 F-12 旁注：避免客户端控制写入路径）。
 */
export async function saveLocalUpload(
  ext: string,
  buffer: Buffer
): Promise<string> {
  const safeExt = ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  const objectKey = `uploads/${randomUUID()}.${safeExt}`;
  await saveLocalFile(objectKey, buffer);
  return `local://${objectKey}`;
}

/**
 * 读取文件内容（供解析 API 使用）
 * 自动识别 oss:// 或 local:// 前缀
 */
export async function readFileBuffer(fileUrl: string): Promise<Buffer> {
  if (fileUrl.startsWith("oss://")) {
    const objectKey = fileUrl.replace(/^oss:\/\/[^/]+\//, "");
    const client = getOSSClient();
    const result = await client.get(objectKey);
    return result.content as Buffer;
  }

  if (fileUrl.startsWith("local://")) {
    const objectKey = fileUrl.replace(/^local:\/\//, "");
    const rel = path.posix.normalize(objectKey.replace(/^uploads\//, ""));
    if (rel.startsWith("..") || rel.includes("\0") || path.isAbsolute(rel)) {
      throw new Error("非法的文件路径");
    }
    const filePath = path.resolve(LOCAL_UPLOAD_DIR, rel);
    const root = path.resolve(LOCAL_UPLOAD_DIR);
    if (!filePath.startsWith(root + path.sep) && filePath !== root) {
      throw new Error("非法的文件路径");
    }
    return fs.readFile(filePath);
  }

  // 兼容旧 Vercel Blob HTTPS URL
  const fetchRes = await fetch(fileUrl, {
    headers: fileUrl.includes("vercel-storage")
      ? { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` }
      : {},
  });
  if (!fetchRes.ok) throw new Error("文件读取失败");
  return Buffer.from(await fetchRes.arrayBuffer());
}
