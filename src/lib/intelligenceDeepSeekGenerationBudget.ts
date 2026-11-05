import { Buffer } from "node:buffer";

export const DEEPSEEK_GENERATION_PRICE_SNAPSHOT_ID = "deepseek-official-2026-11-04-peak-usd";
export const DEEPSEEK_GENERATION_MAX_REQUESTS = 6;
// New explicitly-authorized validation runs get exactly one generation request.
// Keep the historical provider ceiling separate so pre-existing authorizations
// without this newer field retain their original behavior.
export const DEEPSEEK_GENERATION_SINGLE_RUN_REQUEST_LIMIT = 1;
export const DEEPSEEK_GENERATION_MAX_INPUT_TOKENS = 32_768;
export const DEEPSEEK_GENERATION_MAX_OUTPUT_TOKENS = 8_192;
export const DEEPSEEK_TOTAL_RUN_BUDGET_USD_MICROS = 100_000;
export const DEEPSEEK_SEARCH_REQUEST_USD_MICROS = 750;

const PROTOCOL_TOKEN_ALLOWANCE = 2_048;

interface PriceSnapshot {
  canonicalModel: "deepseek-flash" | "deepseek-v4-pro";
  inputUsdMicrosPerMillionTokens: number;
  outputUsdMicrosPerMillionTokens: number;
}

const PRICE_SNAPSHOTS: Record<string, PriceSnapshot> = {
  "deepseek-flash": {
    canonicalModel: "deepseek-flash",
    inputUsdMicrosPerMillionTokens: 300_000,
    outputUsdMicrosPerMillionTokens: 1_200_000,
  },
  // DeepSeek 官方文档说明旧 Flash 名称仍路由到当前 Flash 并按 Flash 价格计费。
  "deepseek-v4-flash": {
    canonicalModel: "deepseek-flash",
    inputUsdMicrosPerMillionTokens: 300_000,
    outputUsdMicrosPerMillionTokens: 1_200_000,
  },
  "deepseek-v4-flash-vision-exp": {
    canonicalModel: "deepseek-flash",
    inputUsdMicrosPerMillionTokens: 300_000,
    outputUsdMicrosPerMillionTokens: 1_200_000,
  },
  "deepseek-v4-pro": {
    canonicalModel: "deepseek-v4-pro",
    inputUsdMicrosPerMillionTokens: 1_320_000,
    outputUsdMicrosPerMillionTokens: 3_960_000,
  },
};

export interface DeepSeekGenerationUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Safe, content-free failure telemetry for a single generation attempt.
 * Never add prompts, response fragments, URLs, credentials, or raw error messages here.
 */
export interface DeepSeekGenerationFailureDiagnostic {
  stage: "request" | "stream" | "response_validation" | "settlement";
  category: "timeout" | "aborted" | "http" | "connection" | "truncated" | "output_limit" | "settlement" | "unknown";
  elapsedMs: number;
  receivedOutput: boolean;
  outputChars: number;
  usageReceived: boolean;
  httpStatus?: number;
}

export interface DeepSeekGenerationReservationSpec {
  model: string;
  canonicalModel: PriceSnapshot["canonicalModel"];
  inputTokenUpperBound: number;
  maxOutputTokens: number;
  reservedUsdMicros: number;
  priceSnapshotId: typeof DEEPSEEK_GENERATION_PRICE_SNAPSHOT_ID;
  phase: string;
}

export interface DeepSeekGenerationDurableLedger {
  reserve(spec: DeepSeekGenerationReservationSpec): Promise<string>;
  complete(id: string, usage?: DeepSeekGenerationUsage): Promise<void>;
  uncertain(id: string, diagnostic?: DeepSeekGenerationFailureDiagnostic): Promise<void>;
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`DEEPSEEK_GENERATION_INVALID_${field}`);
  return value;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`DEEPSEEK_GENERATION_INVALID_${field}`);
  return value;
}

export function conservativeDeepSeekInputTokenUpperBound(input: unknown): number {
  let serialized: string;
  try {
    serialized = JSON.stringify(input);
  } catch {
    throw new Error("DEEPSEEK_GENERATION_INPUT_UNSERIALIZABLE");
  }
  if (!serialized) throw new Error("DEEPSEEK_GENERATION_INPUT_UNSERIALIZABLE");
  // 每个 UTF-8 byte 至多按一个 token 预留，并加协议开销；该上界有意高于常见 BPE 实际值。
  return positiveInteger(Buffer.byteLength(serialized, "utf8") + PROTOCOL_TOKEN_ALLOWANCE, "INPUT_BOUND");
}

function priceFor(model: string): PriceSnapshot {
  const price = PRICE_SNAPSHOTS[model.trim().toLowerCase()];
  if (!price) throw new Error(`DEEPSEEK_GENERATION_UNKNOWN_PRICE:${model.slice(0, 80)}`);
  return price;
}

export function canonicalDeepSeekGenerationModel(model: string): PriceSnapshot["canonicalModel"] {
  return priceFor(model).canonicalModel;
}

function tokenCost(tokens: number, usdMicrosPerMillionTokens: number): number {
  return Math.ceil((tokens * usdMicrosPerMillionTokens) / 1_000_000);
}

export function quoteDeepSeekGenerationUsdMicros(model: string, inputTokens: number, outputTokens: number): number {
  const checkedInput = positiveInteger(inputTokens, "INPUT_TOKENS");
  const checkedOutput = positiveInteger(outputTokens, "OUTPUT_TOKENS");
  const price = priceFor(model);
  return tokenCost(checkedInput, price.inputUsdMicrosPerMillionTokens)
    + tokenCost(checkedOutput, price.outputUsdMicrosPerMillionTokens);
}

function safePhase(value: string): string {
  const phase = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]{0,79}$/.test(phase)) throw new Error("DEEPSEEK_GENERATION_INVALID_PHASE");
  return phase;
}

export function quoteDeepSeekGenerationReservation(
  input: unknown,
  model: string,
  phase = "generation",
  maxOutputTokens = DEEPSEEK_GENERATION_MAX_OUTPUT_TOKENS,
): DeepSeekGenerationReservationSpec {
  const inputTokenUpperBound = conservativeDeepSeekInputTokenUpperBound(input);
  if (inputTokenUpperBound > DEEPSEEK_GENERATION_MAX_INPUT_TOKENS) throw new Error("DEEPSEEK_GENERATION_INPUT_LIMIT_EXCEEDED");
  const checkedMaxOutputTokens = positiveInteger(maxOutputTokens, "MAX_OUTPUT_TOKENS");
  if (checkedMaxOutputTokens > DEEPSEEK_GENERATION_MAX_OUTPUT_TOKENS) throw new Error("DEEPSEEK_GENERATION_OUTPUT_LIMIT_EXCEEDED");
  const price = priceFor(model);
  const reservedUsdMicros = quoteDeepSeekGenerationUsdMicros(model, inputTokenUpperBound, checkedMaxOutputTokens);
  return {
    model: model.trim(),
    canonicalModel: price.canonicalModel,
    inputTokenUpperBound,
    maxOutputTokens: checkedMaxOutputTokens,
    reservedUsdMicros,
    priceSnapshotId: DEEPSEEK_GENERATION_PRICE_SNAPSHOT_ID,
    phase: safePhase(phase),
  };
}

export function estimateDeepSeekGenerationUsdMicros(
  spec: DeepSeekGenerationReservationSpec,
  usage?: DeepSeekGenerationUsage,
): number {
  if (!usage) return spec.reservedUsdMicros;
  const inputTokens = nonNegativeInteger(usage.inputTokens, "ACTUAL_INPUT_TOKENS");
  const outputTokens = nonNegativeInteger(usage.outputTokens, "ACTUAL_OUTPUT_TOKENS");
  if (inputTokens > spec.inputTokenUpperBound || outputTokens > spec.maxOutputTokens) return spec.reservedUsdMicros;
  const price = priceFor(spec.model);
  return tokenCost(inputTokens, price.inputUsdMicrosPerMillionTokens)
    + tokenCost(outputTokens, price.outputUsdMicrosPerMillionTokens);
}
