import type { BrowserResponse, HeadersLike } from "./types.js";

export class BrowserSessionExpiredError extends Error {}

export function browserBaseUrlFromApiUrl(apiUrl: string): string {
  return new URL(apiUrl).origin;
}

export function normalizeBrowserRootUrl(input: string): string {
  const url = new URL(input);
  url.search = "";
  url.hash = "";
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

export async function assertBrowserResponseOk(
  res: BrowserResponse,
  operation: string,
): Promise<void> {
  if (res.ok) return;
  if (res.status === 401 || res.status === 403) {
    throw new BrowserSessionExpiredError();
  }

  const text = typeof res.text === "function" ? await safeReadText(res) : "";
  if (isLoginUrl(res.url) || isLoginPageBody(text)) {
    throw new BrowserSessionExpiredError();
  }

  const status = res.status ? `HTTP ${res.status}` : "HTTP error";
  const detail = text.trim() ? `: ${preview(text.trim())}` : "";
  throw new Error(`${operation} failed with ${status}${detail}`);
}

export function assertTrustedBrowserRootUrl(rootUrl: string, apiUrl: string): void {
  const browser = new URL(rootUrl);
  if (browser.protocol !== "https:") {
    throw new Error("Cascade browser URL must use HTTPS");
  }

  const api = new URL(apiUrl);
  const browserHost = normalizeHostname(browser.hostname);
  const apiHost = normalizeHostname(api.hostname);
  if (isRelatedHost(browserHost, apiHost)) return;

  throw new Error(
    "CASCADE_BROWSER_URL host must match CASCADE_URL host or share its parent domain",
  );
}

export function getSetCookieHeaders(headers: HeadersLike): string[] {
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  if (typeof headers.getAll === "function") {
    return headers.getAll("set-cookie");
  }
  const value = typeof headers.get === "function" ? headers.get("set-cookie") : null;
  return value ? [value] : [];
}

export async function isLoginPageResponse(res: BrowserResponse): Promise<boolean> {
  if (isLoginUrl(res.url)) return true;
  if (typeof res.text !== "function") return false;

  const body = await res.text();
  return isLoginPageBody(body);
}

export async function readJsonObjectResponse(
  res: BrowserResponse,
  invalidMessage: string,
): Promise<Record<string, unknown>> {
  if (isLoginUrl(res.url)) throw new BrowserSessionExpiredError();

  if (typeof res.text === "function") {
    const text = await res.text();
    if (isLoginPageBody(text)) throw new BrowserSessionExpiredError();
    return parseJsonObject(text, invalidMessage);
  }

  if (typeof res.json === "function") {
    const parsed = await res.json();
    if (isJsonObject(parsed)) return parsed;
  }

  throw new Error(invalidMessage);
}

export function cookieHeader(cookies: Map<string, string>): string {
  return Array.from(cookies, ([name, value]) => `${name}=${value}`).join("; ");
}

export function getTimeZoneOffset(): string {
  const offset = new Date().getTimezoneOffset();
  const sign = offset > 0 ? "-" : "+";
  const pad = (num: number) => (num < 10 ? "0" : "") + num;
  const hours = pad(Math.floor(Math.abs(offset) / 60));
  const minutes = pad(Math.abs(offset) % 60);
  return `${sign}${hours}:${minutes}`;
}

export function documentHeaders(extra: Record<string, string>): Record<string, string> {
  return {
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    ...extra,
  };
}

export function ajaxHeaders(extra: Record<string, string>): Record<string, string> {
  return {
    accept: "*/*",
    "x-requested-with": "XMLHttpRequest",
    ...extra,
  };
}

function isLoginUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).pathname.toLowerCase().endsWith("/login.act");
  } catch {
    return false;
  }
}

function isLoginPageBody(body: string): boolean {
  return (
    /<form\b[^>]*\bloginsubmit\.act\b/i.test(body) ||
    (/\bname=["']username["']/i.test(body) &&
      /\bname=["']password["']/i.test(body))
  );
}

function isRelatedHost(browserHost: string, apiHost: string): boolean {
  if (browserHost === apiHost) return true;
  if (browserHost.endsWith(`.${apiHost}`)) return true;
  if (apiHost.endsWith(`.${browserHost}`)) return true;
  return registrableDomain(browserHost) === registrableDomain(apiHost);
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

const MULTI_LABEL_PUBLIC_SUFFIXES = new Set([
  "ac.uk",
  "co.nz",
  "co.uk",
  "com.au",
  "edu.au",
  "gov.uk",
  "net.au",
  "org.uk",
]);

function registrableDomain(hostname: string): string | undefined {
  const parts = hostname.split(".").filter(Boolean);
  if (parts.length < 2) return undefined;

  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_LABEL_PUBLIC_SUFFIXES.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

async function safeReadText(res: BrowserResponse): Promise<string> {
  try {
    return await res.text!();
  } catch {
    return "";
  }
}

function preview(text: string): string {
  return text.length <= 300 ? text : `${text.slice(0, 300)}...`;
}

function parseJsonObject(
  text: string,
  invalidMessage: string,
): Record<string, unknown> {
  const parsed = text.trim() ? JSON.parse(text) : {};
  if (isJsonObject(parsed)) return parsed;
  throw new Error(invalidMessage);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
