// ZjjrClient 接口抽象（架构文档 v1.1 第 5.3 节）。
//
// 主应用不引用本文件。客户端有两个实现：
//   - FixtureZjjrClient：读本地 fixtures/sample.json，联调前打通全管道用。
//   - HttpZjjrClient   ：真实中鉴 API 客户端，待 API 文档到位后实现（当前全 throw）。
//
// 分页方式待 API 文档确认（cursor / page+pageSize / scroll），先按 cursor 抽象。

import * as fs from "fs";
import * as path from "path";

export interface ZjjrPage<T> {
  items: T[];
  nextCursor: string | null;
  total: number | null;
}

export interface ZjjrInstitutionRaw {
  sourceId: string;
  raw: Record<string, unknown>;
  updatedAt: string;
}

export interface ZjjrInvestmentRaw {
  sourceId: string;
  institutionSourceId: string;
  raw: Record<string, unknown>;
  updatedAt: string;
}

export interface ZjjrClient {
  fetchInstitutions(params: {
    cursor?: string;
    updatedSince?: string;
  }): Promise<ZjjrPage<ZjjrInstitutionRaw>>;
  fetchInvestments(params: {
    cursor?: string;
    updatedSince?: string;
  }): Promise<ZjjrPage<ZjjrInvestmentRaw>>;
  fetchUpdates(params: { updatedSince: string }): Promise<{
    institutions: ZjjrInstitutionRaw[];
    investments: ZjjrInvestmentRaw[];
  }>;
  healthCheck(): Promise<boolean>;
}

// ------------------------------------------------------------
// FixtureZjjrClient：读本地 JSON，返回符合 interface 的 mock 数据。
// ------------------------------------------------------------
interface FixtureShape {
  institutions: ZjjrInstitutionRaw[];
  investments: ZjjrInvestmentRaw[];
}

export class FixtureZjjrClient implements ZjjrClient {
  private data: FixtureShape;

  constructor(fixturePath?: string) {
    const p =
      fixturePath ?? path.join(__dirname, "..", "fixtures", "sample.json");
    const text = fs.readFileSync(p, "utf-8");
    this.data = JSON.parse(text) as FixtureShape;
  }

  private static afterCursor<T>(items: T[], cursor?: string): T[] {
    // Fixture 数据量小，cursor 为已返回条数的字符串；首次 cursor 为空。
    const offset = cursor ? parseInt(cursor, 10) || 0 : 0;
    return items.slice(offset);
  }

  private static sinceFilter<T extends { updatedAt: string }>(
    items: T[],
    updatedSince?: string
  ): T[] {
    if (!updatedSince) return items;
    const since = new Date(updatedSince).getTime();
    return items.filter((it) => new Date(it.updatedAt).getTime() > since);
  }

  async fetchInstitutions(params: {
    cursor?: string;
    updatedSince?: string;
  }): Promise<ZjjrPage<ZjjrInstitutionRaw>> {
    const filtered = FixtureZjjrClient.sinceFilter(
      this.data.institutions,
      params.updatedSince
    );
    const items = FixtureZjjrClient.afterCursor(filtered, params.cursor);
    return { items, nextCursor: null, total: filtered.length };
  }

  async fetchInvestments(params: {
    cursor?: string;
    updatedSince?: string;
  }): Promise<ZjjrPage<ZjjrInvestmentRaw>> {
    const filtered = FixtureZjjrClient.sinceFilter(
      this.data.investments,
      params.updatedSince
    );
    const items = FixtureZjjrClient.afterCursor(filtered, params.cursor);
    return { items, nextCursor: null, total: filtered.length };
  }

  async fetchUpdates(params: { updatedSince: string }): Promise<{
    institutions: ZjjrInstitutionRaw[];
    investments: ZjjrInvestmentRaw[];
  }> {
    return {
      institutions: FixtureZjjrClient.sinceFilter(
        this.data.institutions,
        params.updatedSince
      ),
      investments: FixtureZjjrClient.sinceFilter(
        this.data.investments,
        params.updatedSince
      ),
    };
  }

  async healthCheck(): Promise<boolean> {
    return (
      Array.isArray(this.data.institutions) &&
      Array.isArray(this.data.investments)
    );
  }
}

// ------------------------------------------------------------
// HttpZjjrClient：真实 API 客户端 —— 待 API 文档到位后实现。
// 实现前必须逐项确认架构文档 5.3「待 API 文档确认清单」7 项（字段字典 / 分页 /
// 限流 / 增量查询 / 认证 / source_id 稳定性 / 数据使用协议边界）。
// ------------------------------------------------------------
const NOT_IMPL = "HttpZjjrClient: 待 API 文档到位后实现（见架构文档 5.3 待确认清单 7 项）";

export class HttpZjjrClient implements ZjjrClient {
  constructor(_opts?: { baseUrl?: string; apiKey?: string }) {
    // 配置占位：baseUrl / apiKey 由环境变量注入（ZJJR_API_BASE_URL / ZJJR_API_KEY）。
  }

  async fetchInstitutions(): Promise<ZjjrPage<ZjjrInstitutionRaw>> {
    throw new Error(NOT_IMPL);
  }

  async fetchInvestments(): Promise<ZjjrPage<ZjjrInvestmentRaw>> {
    throw new Error(NOT_IMPL);
  }

  async fetchUpdates(): Promise<{
    institutions: ZjjrInstitutionRaw[];
    investments: ZjjrInvestmentRaw[];
  }> {
    throw new Error(NOT_IMPL);
  }

  async healthCheck(): Promise<boolean> {
    throw new Error(NOT_IMPL);
  }
}

// 工厂：按 ZJJR_CLIENT 环境变量选择实现（默认 fixture）。
export function createClient(): ZjjrClient {
  const kind = (process.env.ZJJR_CLIENT || "fixture").toLowerCase();
  if (kind === "http") {
    return new HttpZjjrClient({
      baseUrl: process.env.ZJJR_API_BASE_URL,
      apiKey: process.env.ZJJR_API_KEY,
    });
  }
  return new FixtureZjjrClient();
}
