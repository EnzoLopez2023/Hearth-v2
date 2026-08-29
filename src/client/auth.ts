import {
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo
} from "@azure/msal-browser";

interface AuthConfig {
  enabled: boolean;
  authority: string | null;
  client_id: string | null;
  scope: string | null;
}

let configPromise: Promise<AuthConfig> | undefined;
let clientPromise: Promise<{ client: PublicClientApplication; account: AccountInfo | undefined; scope: string }> | undefined;

function authConfig(): Promise<AuthConfig> {
  configPromise ??= fetch("/auth-config.json", { cache: "no-store" }).then(async (response) => {
    if (!response.ok) throw new Error("Authentication configuration is unavailable");
    return response.json() as Promise<AuthConfig>;
  });
  return configPromise;
}

async function authClient() {
  if (clientPromise) return clientPromise;
  clientPromise = authConfig().then(async (config) => {
    if (!config.enabled || !config.authority || !config.client_id || !config.scope) {
      throw new Error("Authentication is not configured");
    }
    const client = new PublicClientApplication({
      auth: {
        clientId: config.client_id,
        authority: config.authority,
        redirectUri: window.location.origin
      },
      cache: { cacheLocation: "sessionStorage" }
    });
    await client.initialize();
    const redirect = await client.handleRedirectPromise();
    const account = redirect?.account ?? client.getActiveAccount() ?? client.getAllAccounts()[0];
    if (account) client.setActiveAccount(account);
    return { client, account, scope: config.scope };
  });
  return clientPromise;
}

export async function accessToken(): Promise<string | undefined> {
  const config = await authConfig();
  if (!config.enabled) return undefined;
  const { client, account, scope } = await authClient();
  if (!account) {
    await client.loginRedirect({ scopes: [scope] });
    return undefined;
  }
  try {
    return (await client.acquireTokenSilent({ account, scopes: [scope] })).accessToken;
  } catch (error) {
    if (!(error instanceof InteractionRequiredAuthError)) throw error;
    await client.acquireTokenRedirect({ account, scopes: [scope] });
    return undefined;
  }
}
