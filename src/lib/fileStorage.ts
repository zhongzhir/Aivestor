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

const MAX_REMOTE_FILE_BYTES = 25 * 1024 * 1024;
const REMOTE_FETCH_TIMEOUT_MS = 30_000;
const UPLOAD_WINDOW_MS = 10 * 60 * 1000;
const UPLOAD_LIMIT = 12;
const uploadAttempts = new Map<string, number[]>();

export function consumeUploadAttempt(userId: string): boolean {
  const now = Date.now();
  const recent = (uploadAttempts.get(userId) || []).filter((at) => now - at < UPLOAD_WINDOW_MS);
  if (recent.length >= UPLOAD_LIMIT) {
    uploadAttempts.set(userId, recent);
    return false;
  }
  recent.push(now);
  uploadAttempts.set(userId, recent);
  return true;
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/[\[\]]/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal") return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const matched172 = host.match(/^172\.(\d+)\./);
  if (matched172 && Number(matched172[1]) >= 16 && Number(matched172[1]) <= 31) return true;
  return host === "169.254.169.254" || host === "::1";
}

function assertAllowedRemoteUrl(fileUrl: string): URL {
  let url: URL;
  try { url = new URL(fileUrl); } catch { throw new Error("invalid file URL"); }
  const allowedHosts = (process.env.DOCUMENT_REMOTE_ALLOWED_HOSTS || "")
    .split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  const host = url.hostname.toLowerCase();
  const allowed = allowedHosts.includes(host) || host.endsWith(".public.blob.vercel-storage.com");
  if (url.protocol !== "https:" || isPrivateHost(host) || !allowed) throw new Error("remote file host is not allowed");
  return url;
}

async function readRemoteFile(url: URL): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { redirect: "error", signal: controller.signal });
    if (!response.ok || !response.body) throw new Error("remote file read failed");
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_REMOTE_FILE_BYTES) throw new Error("remote file too large");
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REMOTE_FILE_BYTES) {
        await reader.cancel();
        throw new Error("remote file too large");
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timeout);
  }
}

export function hasValidDocumentSignature(buffer: Buffer, fileType: string): boolean {
  if (fileType === "pdf") return buffer.subarray(0, 5).toString() === "%PDF-";
  if (["docx", "xlsx", "pptx"].includes(fileType)) {
    return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  }
  if (["xls", "ppt"].includes(fileType)) {
    return buffer.length >= 8 && Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).equals(buffer.subarray(0, 8));
  }
  return false;
}

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
  const remoteUrl = assertAllowedRemoteUrl(fileUrl);
  return readRemoteFile(remoteUrl);
  /* const fetchRes = await fetch(fileUrl, {
    headers: fileUrl.includes("vercel-storage")
      ? { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` }
      : {},
  });
  if (!fetchRes.ok) throw new Error("文件读取失败");
  return Buffer.from(await fetchRes.arrayBuffer()); */
}
