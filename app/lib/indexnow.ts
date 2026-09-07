import { isPrivatePath } from "./privacy.ts";
import { getIndexableEntries } from "../siteUrls.ts";
import { siteUrl } from "../site.ts";

export const INDEXNOW_KEY = "4e643e3afb347cb9dbc8950df7b5a93c";
export const INDEXNOW_KEY_LOCATION = `${siteUrl}/${INDEXNOW_KEY}.txt`;

function canonicalHref(value: string): string {
  const url = new URL(value, siteUrl);
  if (url.pathname === "/") url.pathname = "";
  return url.href;
}

const publicUrls = new Set(getIndexableEntries().map((entry) => canonicalHref(entry.url)));

export function validateIndexNowUrls(urls: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const value of urls) {
    const url = new URL(value, siteUrl);
    const canonical = canonicalHref(url.href);
    if (url.origin !== siteUrl || isPrivatePath(url.pathname) || !publicUrls.has(canonical)) {
      throw new Error(`IndexNow URL is not an approved public page: ${url.href}`);
    }
    unique.add(canonical);
  }
  return [...unique];
}

export function validateIndexNowHostUrls(urls: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const value of urls) {
    const url = new URL(value, siteUrl);
    if (url.origin !== siteUrl || isPrivatePath(url.pathname)) {
      throw new Error(`IndexNow URL is not on the public host: ${url.href}`);
    }
    unique.add(canonicalHref(url.href));
  }
  return [...unique];
}

export async function submitIndexNow(
  urls: readonly string[],
  options: { allowPreviouslyPublic?: boolean } = {},
): Promise<number> {
  const urlList = options.allowPreviouslyPublic
    ? validateIndexNowHostUrls(urls)
    : validateIndexNowUrls(urls);
  if (urlList.length === 0) return 204;

  const response = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host: new URL(siteUrl).host,
      key: INDEXNOW_KEY,
      keyLocation: INDEXNOW_KEY_LOCATION,
      urlList,
    }),
  });
  if (![200, 202].includes(response.status)) {
    throw new Error(`IndexNow rejected the submission with status ${response.status}.`);
  }
  return response.status;
}