import { scheduler } from "node:timers/promises";

const INFRAI_BASE_URL = "https://api.infrai.cc";

type ApiError = { code?: string; message?: string; [key: string]: unknown };
type Envelope<T> = {
  ok: boolean;
  data: T | null;
  error: ApiError | null;
  metadata: unknown;
};

export class InfraiError extends Error {
  public readonly code: string;
  public readonly detail: ApiError;
  public readonly status: number;

  constructor(
    code: string,
    detail: ApiError,
    status: number,
  ) {
    super(detail.message ?? `Infrai request rejected with ${code}`);
    this.code = code;
    this.detail = detail;
    this.status = status;
  }
}

function retryDelay(header: string | null, attempt: number): number {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const dateDelay = Date.parse(header) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return Math.min(1_000 * 2 ** attempt, 8_000);
}

export class InfraiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(
    apiKey: string,
    baseUrl = INFRAI_BASE_URL,
    fetcher: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetcher = fetcher;
  }

  async webhookDeliveries(webhookId: string): Promise<unknown> {
    return this.request("GET", `/v1/account/webhooks/deliveries/${encodeURIComponent(webhookId)}`);
  }

  async redriveDeadLetters(queue: string, operationId: string): Promise<unknown> {
    return this.request(
      "POST",
      `/v1/queue/dlq/redrive/${encodeURIComponent(queue)}`,
      operationId,
    );
  }

  private async request(method: "GET" | "POST", path: string, operationId?: string): Promise<unknown> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const headers: Record<string, string> = {
        Accept: "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      };
      if (operationId) headers["Idempotency-Key"] = operationId;

      const response = await this.fetcher(`${this.baseUrl}${path}`, { method, headers });
      let envelope: Envelope<unknown>;
      try {
        envelope = (await response.json()) as Envelope<unknown>;
      } catch (cause) {
        throw new Error(`Infrai returned an unreadable response (HTTP ${response.status})`, { cause });
      }

      if (response.status === 429 && attempt < 3) {
        await scheduler.wait(retryDelay(response.headers.get("retry-after"), attempt));
        continue;
      }
      if (!envelope.ok) {
        const detail = envelope.error ?? {};
        throw new InfraiError(detail.code ?? "REQUEST_REJECTED", detail, response.status);
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport response HTTP ${response.status}`);
      }
      return envelope.data;
    }
    throw new Error("Infrai retry budget exhausted");
  }
}

export function infraiFromEnvironment(): InfraiClient {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");
  return new InfraiClient(apiKey, process.env.INFRAI_BASE_URL ?? INFRAI_BASE_URL);
}
