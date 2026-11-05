import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { DeepSeekCallKind, DeepSeekDurableAttemptLedger } from "@/lib/intelligenceDeepSeekAdapter";

type AttemptStatus = "reserved" | "completed" | "failed" | "uncertain";

export interface ComparisonUsdAttempt {
  id: string;
  kind: DeepSeekCallKind;
  status: AttemptStatus;
  reservedUsdMicros: number;
  estimatedBillableUsdMicros: number;
  createdAt: string;
  updatedAt: string;
}

export interface ComparisonUsdLedgerState {
  version: 1;
  currency: "USD";
  limitUsdMicros: number;
  maxSearchRequests: number;
  maxFetchRequests: number;
  createdAt: string;
  updatedAt: string;
  attempts: ComparisonUsdAttempt[];
}

export class PersistentDeepSeekComparisonLedger implements DeepSeekDurableAttemptLedger {
  private mutex: Promise<void> = Promise.resolve();

  private constructor(private readonly path: string, private state: ComparisonUsdLedgerState) {}

  static async open(path: string, options = { limitUsdMicros: 1_500, maxSearchRequests: 2, maxFetchRequests: 0 }): Promise<PersistentDeepSeekComparisonLedger> {
    if (options.limitUsdMicros !== 1_500 || options.maxSearchRequests !== 2 || options.maxFetchRequests !== 0) {
      throw new Error("DEEPSEEK_COMPARISON_AUTHORIZATION_MISMATCH");
    }
    try {
      const state = JSON.parse(await readFile(path, "utf8")) as ComparisonUsdLedgerState;
      if (state.version !== 1 || state.currency !== "USD" || state.limitUsdMicros !== 1_500
        || state.maxSearchRequests !== 2 || state.maxFetchRequests !== 0) {
        throw new Error("DEEPSEEK_COMPARISON_LEDGER_INCOMPATIBLE");
      }
      if (state.attempts.length) {
        const now = new Date().toISOString();
        let changed = false;
        state.attempts = state.attempts.map((attempt) => {
          if (attempt.status !== "reserved") return attempt;
          changed = true;
          return { ...attempt, status: "uncertain" as const, updatedAt: now };
        });
        if (changed) {
          state.updatedAt = now;
          await PersistentDeepSeekComparisonLedger.persistState(path, state);
        }
        throw new Error("DEEPSEEK_COMPARISON_ALREADY_ATTEMPTED");
      }
      return new PersistentDeepSeekComparisonLedger(path, state);
    } catch (error) {
      if (!(error instanceof Error) || (!/ENOENT/.test(error.message) && error.message !== "ENOENT")) throw error;
    }
    const now = new Date().toISOString();
    const state: ComparisonUsdLedgerState = {
      version: 1,
      currency: "USD",
      limitUsdMicros: options.limitUsdMicros,
      maxSearchRequests: options.maxSearchRequests,
      maxFetchRequests: options.maxFetchRequests,
      createdAt: now,
      updatedAt: now,
      attempts: [],
    };
    await PersistentDeepSeekComparisonLedger.persistState(path, state);
    return new PersistentDeepSeekComparisonLedger(path, state);
  }

  snapshot(): ComparisonUsdLedgerState {
    return JSON.parse(JSON.stringify(this.state)) as ComparisonUsdLedgerState;
  }

  private static async persistState(path: string, state: ComparisonUsdLedgerState): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2), { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  }

  private async locked<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.mutex;
    let release!: () => void;
    this.mutex = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await work(); } finally { release(); }
  }

  private async settle(id: string, status: Exclude<AttemptStatus, "reserved">, estimatedBillableUsdMicros: number): Promise<void> {
    await this.locked(async () => {
      const attempt = this.state.attempts.find((item) => item.id === id);
      if (!attempt || attempt.status !== "reserved") throw new Error("DEEPSEEK_COMPARISON_ATTEMPT_NOT_RESERVED");
      attempt.status = status;
      attempt.estimatedBillableUsdMicros = Math.min(attempt.reservedUsdMicros, Math.max(0, estimatedBillableUsdMicros));
      attempt.updatedAt = new Date().toISOString();
      this.state.updatedAt = attempt.updatedAt;
      await PersistentDeepSeekComparisonLedger.persistState(this.path, this.state);
    });
  }

  async reserve(kind: DeepSeekCallKind, reservedUsdMicros: number): Promise<string> {
    return this.locked(async () => {
      if (reservedUsdMicros !== 750) throw new Error("DEEPSEEK_COMPARISON_PRICE_MISMATCH");
      const kindLimit = kind === "search" ? this.state.maxSearchRequests : this.state.maxFetchRequests;
      const kindCount = this.state.attempts.filter((attempt) => attempt.kind === kind).length;
      if (kindCount >= kindLimit) throw new Error(`DEEPSEEK_COMPARISON_${kind.toUpperCase()}_LIMIT`);
      const committed = this.state.attempts.reduce((sum, attempt) => sum + attempt.reservedUsdMicros, 0);
      if (committed + reservedUsdMicros > this.state.limitUsdMicros) throw new Error("DEEPSEEK_COMPARISON_BUDGET_EXCEEDED");
      const now = new Date().toISOString();
      const attempt: ComparisonUsdAttempt = {
        id: randomUUID(),
        kind,
        status: "reserved",
        reservedUsdMicros,
        estimatedBillableUsdMicros: 0,
        createdAt: now,
        updatedAt: now,
      };
      this.state.attempts.push(attempt);
      this.state.updatedAt = now;
      await PersistentDeepSeekComparisonLedger.persistState(this.path, this.state);
      return attempt.id;
    });
  }

  complete(id: string, billable: boolean, estimatedBillableUsdMicros: number): Promise<void> {
    return this.settle(id, "completed", billable ? estimatedBillableUsdMicros : 0);
  }

  fail(id: string): Promise<void> {
    return this.settle(id, "failed", 0);
  }

  uncertain(id: string): Promise<void> {
    return this.settle(id, "uncertain", 750);
  }
}
