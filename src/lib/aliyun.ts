// 阿里云服务封装：邮件推送（DirectMail）与短信服务（SMS）。
// 采用阿里云 RPC 风格 API 的 HMAC-SHA1 手动签名，无需额外 SDK 依赖。

import crypto from "crypto";
import { BRAND } from "@/lib/brand";

const ACCESS_KEY_ID = process.env.ALIYUN_ACCESS_KEY_ID ?? "";
const ACCESS_KEY_SECRET = process.env.ALIYUN_ACCESS_KEY_SECRET ?? "";

// 阿里云 RPC 签名要求的百分号编码（区别于标准 encodeURIComponent）。
function percentEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/\+/g, "%20")
    .replace(/\*/g, "%2A")
    .replace(/%7E/g, "~");
}

// 通用 RPC 调用：构造公共参数、计算签名并以 GET 方式请求。
// 阿里云 RPC 风格 API 要求所有参数（含签名）放在 query string 中。
async function rpcRequest(
  endpoint: string,
  version: string,
  action: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  if (!ACCESS_KEY_ID || !ACCESS_KEY_SECRET) {
    throw new Error("未配置阿里云 AccessKey");
  }

  const allParams: Record<string, string> = {
    Format: "JSON",
    Version: version,
    AccessKeyId: ACCESS_KEY_ID,
    SignatureMethod: "HMAC-SHA1",
    SignatureVersion: "1.0",
    SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    Action: action,
    ...params,
  };

  const canonical = Object.keys(allParams)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join("&");

  const stringToSign = `GET&${percentEncode("/")}&${percentEncode(canonical)}`;
  const signature = crypto
    .createHmac("sha1", `${ACCESS_KEY_SECRET}&`)
    .update(stringToSign)
    .digest("base64");

  // 签名结果再做一次 percent encode，与其余参数一起拼入 query string
  const url = `${endpoint}/?${canonical}&Signature=${percentEncode(signature)}`;
  const res = await fetch(url, { method: "GET" });

  // 先按文本读取，确保非 JSON 响应也能落到日志里
  const rawBody = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    // 响应非 JSON，data 保持空对象，rawBody 仍会被打印
  }

  const code = typeof data.Code === "string" ? data.Code : undefined;
  if (!res.ok || (code && code !== "OK")) {
    // 打印完整响应 body，便于在 Vercel 日志中定位阿里云返回的具体错误
    console.error(
      `[aliyun] ${action} 调用失败 HTTP ${res.status}，响应 body：${rawBody}`
    );
    const msg = (data.Message as string) ?? code ?? `HTTP ${res.status}`;
    throw new Error(`阿里云 ${action} 调用失败：${msg}`);
  }
  return data;
}

// 发送邮件（阿里云邮件推送 SingleSendMail）。
export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<void> {
  const from = process.env.ALIYUN_EMAIL_FROM?.trim();
  if (!from) throw new Error("未配置 ALIYUN_EMAIL_FROM");

  await rpcRequest("https://dm.aliyuncs.com", "2015-11-23", "SingleSendMail", {
    AccountName: from,
    AddressType: "1",
    ReplyToAddress: "false",
    ToAddress: to,
    Subject: subject,
    HtmlBody: html,
    FromAlias: BRAND.productName,
  });
}

// 发送短信验证码（阿里云短信服务 SendSms）。
export async function sendSms(phone: string, code: string): Promise<void> {
  const signName = process.env.ALIYUN_SMS_SIGN;
  const templateCode = process.env.ALIYUN_SMS_TEMPLATE;
  if (!signName || !templateCode) {
    throw new Error("未配置阿里云短信参数");
  }

  await rpcRequest(
    "https://dysmsapi.aliyuncs.com",
    "2017-05-25",
    "SendSms",
    {
      RegionId: "cn-hangzhou",
      PhoneNumbers: phone,
      SignName: signName,
      TemplateCode: templateCode,
      TemplateParam: JSON.stringify({ code }),
    }
  );
}
