export function getBasicAuthUsername(): string {
  return getRequired("BASIC_AUTH_USERNAME");
}

export function getBasicAuthPassword(): string {
  return getRequired("BASIC_AUTH_PASSWORD");
}

export function getEngineUrl(): string {
  return getRequired("ENGINE_URL");
}

export function getEngineUrlForAccessFromKn(): string {
  return getRequired("ENGINE_URL_FOR_ACCESS_FROM_KN");
}

export function getKnFuncPort(): string {
  return Deno.env.get("FUNC_PORT") ?? "80";
}

export function getKnFuncBasicAuth(): string | undefined {
  return Deno.env.get("FUNC_BASIC_AUTH");
}

function getRequired(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new Error(`No ${name} environment variable set`);
  }
  return value;
}
