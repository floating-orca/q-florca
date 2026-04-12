import * as env from "./env.ts";

export function getAuthorizationHeader(): string {
  const username = env.getBasicAuthUsername();
  const password = env.getBasicAuthPassword();
  return `Basic ${btoa(`${username}:${password}`)}`;
}
