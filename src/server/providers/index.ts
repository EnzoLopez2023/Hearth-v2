import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DefaultAzureCredential } from "@azure/identity";
import { BlobServiceClient } from "@azure/storage-blob";
import type { AppConfig } from "../config.js";

export type ProviderResult<T> =
  | { status: "ok"; value: T }
  | { status: "not_configured"; provider: string; message: string }
  | { status: "error"; provider: string; message: string };

export interface AiProvider {
  readonly name: "azure-openai" | "anthropic" | "unconfigured";
  complete(prompt: string): Promise<ProviderResult<string>>;
}
export interface WeatherProvider {
  daily(latitude: number, longitude: number): Promise<ProviderResult<unknown>>;
  geocode(query: string): Promise<ProviderResult<unknown>>;
}
export interface BlobProvider {
  readonly name: string;
  put(key: string, bytes: Uint8Array): Promise<ProviderResult<{ key: string; byteSize: number; sha256: string }>>;
  create(key: string, bytes: Uint8Array): Promise<ProviderResult<{
    key: string;
    byteSize: number;
    sha256: string;
    created: boolean;
  }>>;
  get(key: string): Promise<ProviderResult<Uint8Array>>;
  delete(key: string): Promise<ProviderResult<void>>;
}

const notConfigured = (provider: string, message = `${provider} is not configured`) =>
  ({ status: "not_configured", provider, message } as const);

export class UnconfiguredAiProvider implements AiProvider {
  readonly name = "unconfigured" as const;
  async complete(_prompt: string) { return notConfigured("ai"); }
}

export class AzureOpenAiProvider implements AiProvider {
  readonly name = "azure-openai" as const;
  constructor(private endpoint: string, private deployment: string, private apiKey: string) {}
  async complete(prompt: string): Promise<ProviderResult<string>> {
    try {
      const url = `${this.endpoint.replace(/\/$/, "")}/openai/deployments/${encodeURIComponent(this.deployment)}/chat/completions?api-version=2024-10-21`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "api-key": this.apiKey },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          max_completion_tokens: 4096
        }),
        signal: AbortSignal.timeout(60_000)
      });
      if (!response.ok) return { status: "error", provider: this.name, message: `Provider returned ${response.status}` };
      const body = await response.json() as { choices?: { message?: { content?: string } }[] };
      const content = body.choices?.[0]?.message?.content;
      return content ? { status: "ok", value: content } : { status: "error", provider: this.name, message: "Provider returned no content" };
    } catch { return { status: "error", provider: this.name, message: "Provider request failed" }; }
  }
}

export class AnthropicAiProvider implements AiProvider {
  readonly name = "anthropic" as const;
  constructor(private apiKey: string) {}
  async complete(prompt: string): Promise<ProviderResult<string>> {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 4096, messages: [{ role: "user", content: prompt }] }),
        signal: AbortSignal.timeout(60_000)
      });
      if (!response.ok) return { status: "error", provider: this.name, message: `Provider returned ${response.status}` };
      const body = await response.json() as { content?: { type: string; text?: string }[] };
      const content = body.content?.find((item) => item.type === "text")?.text;
      return content ? { status: "ok", value: content } : { status: "error", provider: this.name, message: "Provider returned no content" };
    } catch { return { status: "error", provider: this.name, message: "Provider request failed" }; }
  }
}

export class UnconfiguredWeatherProvider implements WeatherProvider {
  async daily(_latitude: number, _longitude: number) { return notConfigured("weather"); }
  async geocode(_query: string) { return notConfigured("geocoding"); }
}

export class OpenWeatherProvider implements WeatherProvider {
  constructor(private apiKey: string, private baseUrl: string) {}
  private async request(route: string, query: URLSearchParams): Promise<ProviderResult<unknown>> {
    try {
      query.set("appid", this.apiKey);
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${route}?${query}`);
      if (!response.ok) return { status: "error", provider: "openweather", message: `Provider returned ${response.status}` };
      return { status: "ok", value: await response.json() };
    } catch { return { status: "error", provider: "openweather", message: "Provider request failed" }; }
  }
  daily(latitude: number, longitude: number) {
    return this.request("/data/3.0/onecall", new URLSearchParams({
      lat: String(latitude), lon: String(longitude), exclude: "current,minutely,hourly,alerts", units: "metric"
    }));
  }
  geocode(query: string) {
    return this.request("/geo/1.0/direct", new URLSearchParams({ q: query, limit: "5" }));
  }
}

export class UnconfiguredBlobProvider implements BlobProvider {
  readonly name = "unconfigured";
  async put(_key: string, _bytes: Uint8Array) { return notConfigured("blob"); }
  async create(_key: string, _bytes: Uint8Array) { return notConfigured("blob"); }
  async get(_key: string) { return notConfigured("blob"); }
  async delete(_key: string) { return notConfigured("blob"); }
}

export class LocalBlobProvider implements BlobProvider {
  readonly name = "local";
  constructor(private readonly root: string) {}
  private resolve(key: string): string {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/.test(key)) throw new Error("Invalid blob key");
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(`${path.resolve(this.root)}${path.sep}`)) throw new Error("Invalid blob key");
    return resolved;
  }
  async put(key: string, bytes: Uint8Array) {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes, { flag: "wx" });
    return { status: "ok", value: { key, byteSize: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") } } as const;
  }
  async create(key: string, bytes: Uint8Array) {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    let created = true;
    try {
      await fs.writeFile(target, bytes, { flag: "wx" });
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
      created = false;
    }
    return {
      status: "ok",
      value: {
        key,
        byteSize: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        created
      }
    } as const;
  }
  async get(key: string) {
    try { return { status: "ok", value: await fs.readFile(this.resolve(key)) } as const; }
    catch { return { status: "error", provider: this.name, message: "Blob not found" } as const; }
  }
  async delete(key: string) {
    try { await fs.unlink(this.resolve(key)); return { status: "ok", value: undefined } as const; }
    catch { return { status: "error", provider: this.name, message: "Blob not found" } as const; }
  }
}

export class AzureBlobProvider implements BlobProvider {
  readonly name = "azure";
  private readonly container;
  constructor(client: BlobServiceClient, container: string) {
    this.container = client.getContainerClient(container);
  }
  async put(key: string, bytes: Uint8Array): Promise<ProviderResult<{ key: string; byteSize: number; sha256: string }>> {
    try {
      await this.container.getBlockBlobClient(key).uploadData(bytes);
      return { status: "ok", value: {
        key, byteSize: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex")
      } };
    } catch { return { status: "error", provider: this.name, message: "Blob upload failed" }; }
  }
  async create(key: string, bytes: Uint8Array): Promise<ProviderResult<{
    key: string;
    byteSize: number;
    sha256: string;
    created: boolean;
  }>> {
    try {
      await this.container.getBlockBlobClient(key).uploadData(bytes, { conditions: { ifNoneMatch: "*" } });
      return { status: "ok", value: {
        key,
        byteSize: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        created: true
      } };
    } catch (error) {
      const statusCode = error && typeof error === "object" && "statusCode" in error ? error.statusCode : undefined;
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (statusCode === 409 || statusCode === 412 || code === "BlobAlreadyExists") {
        return { status: "ok", value: {
          key,
          byteSize: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          created: false
        } };
      }
      return { status: "error", provider: this.name, message: "Blob upload failed" };
    }
  }
  async get(key: string): Promise<ProviderResult<Uint8Array>> {
    try { return { status: "ok", value: await this.container.getBlockBlobClient(key).downloadToBuffer() }; }
    catch { return { status: "error", provider: this.name, message: "Blob download failed" }; }
  }
  async delete(key: string): Promise<ProviderResult<void>> {
    try { await this.container.getBlockBlobClient(key).deleteIfExists(); return { status: "ok", value: undefined }; }
    catch { return { status: "error", provider: this.name, message: "Blob delete failed" }; }
  }
}

export function createProviders(config: AppConfig) {
  const ai: AiProvider = config.AZURE_OPENAI_API_KEY && config.AZURE_OPENAI_ENDPOINT && config.AZURE_OPENAI_DEPLOYMENT
    ? new AzureOpenAiProvider(config.AZURE_OPENAI_ENDPOINT, config.AZURE_OPENAI_DEPLOYMENT, config.AZURE_OPENAI_API_KEY)
    : config.ANTHROPIC_API_KEY ? new AnthropicAiProvider(config.ANTHROPIC_API_KEY) : new UnconfiguredAiProvider();
  const weather: WeatherProvider = config.WEATHER_API_KEY
    ? new OpenWeatherProvider(config.WEATHER_API_KEY, config.WEATHER_BASE_URL)
    : new UnconfiguredWeatherProvider();
  let blob: BlobProvider = new UnconfiguredBlobProvider();
  let blobStatus = "not_configured";
  if (config.BLOB_PROVIDER === "azure" && (config.AZURE_STORAGE_ACCOUNT_URL || config.AZURE_STORAGE_CONNECTION_STRING)) {
    try {
      const client = config.AZURE_STORAGE_ACCOUNT_URL
        ? new BlobServiceClient(config.AZURE_STORAGE_ACCOUNT_URL, new DefaultAzureCredential())
        : BlobServiceClient.fromConnectionString(config.AZURE_STORAGE_CONNECTION_STRING!);
      blob = new AzureBlobProvider(client, config.AZURE_STORAGE_CONTAINER);
      blobStatus = blob.name;
    } catch {
      blobStatus = "configuration_error";
    }
  } else if (!config.production && config.BLOB_PROVIDER === "local") {
    blob = new LocalBlobProvider(config.localBlobPath);
    blobStatus = blob.name;
  } else if (config.production && config.BLOB_PROVIDER === "local") {
    blobStatus = "not_configured_local_forbidden";
  }
  return {
    ai,
    weather,
    blob,
    configuration: {
      ai: ai.name,
      weather: config.WEATHER_API_KEY ? "openweather" : "not_configured",
      blob: blobStatus
    }
  };
}
