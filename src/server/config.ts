import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DB_PATH: z.string().optional(),
  DEV_AUTH_ENABLED: z.enum(["true", "false"]).default("false"),
  DEV_AUTH_EMAIL: z.string().email().default("developer@hearth.local"),
  OIDC_ISSUER: z.string().url().optional(),
  OIDC_AUDIENCE: z.string().min(1).optional(),
  OIDC_JWKS_URI: z.string().url().optional(),
  BUILD_VERSION: z.string().default("dev"),
  SOURCE_SHA: z.string().default("unknown"),
  BUILD_TIME: z.string().default("unknown"),
  BLOB_PROVIDER: z.enum(["local", "azure"]).optional(),
  LOCAL_BLOB_PATH: z.string().default("storage/blobs"),
  AZURE_STORAGE_CONNECTION_STRING: z.string().optional(),
  AZURE_OPENAI_ENDPOINT: z.string().url().optional(),
  AZURE_OPENAI_DEPLOYMENT: z.string().min(1).optional(),
  AZURE_OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  WEATHER_API_KEY: z.string().optional()
  ,
  WEATHER_BASE_URL: z.string().url().default("https://api.openweathermap.org"),
  AZURE_STORAGE_CONTAINER: z.string().min(3).max(63).default("hearth")
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const env = envSchema.parse(source);
  const production = env.NODE_ENV === "production";
  const devAuthEnabled = env.DEV_AUTH_ENABLED === "true";
  if (production && devAuthEnabled) {
    throw new Error("DEV_AUTH_ENABLED is forbidden in production");
  }
  const oidcConfigured = Boolean(env.OIDC_ISSUER && env.OIDC_AUDIENCE && env.OIDC_JWKS_URI);
  return {
    ...env,
    production,
    devAuthEnabled,
    oidcConfigured,
    dbPath: env.DB_PATH ?? (production ? "/home/data/hearth-v2.db" : "hearth-v2.db"),
    localBlobPath: path.resolve(env.LOCAL_BLOB_PATH)
  } as const;
}
