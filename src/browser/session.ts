import type { Config } from "../config.js";
import { checkDraft } from "./checkDraft.js";
import {
  assertTrustedBrowserRootUrl,
  browserBaseUrlFromApiUrl,
  BrowserSessionExpiredError,
  cookieHeader,
  documentHeaders,
  getSetCookieHeaders,
  getTimeZoneOffset,
  isLoginPageResponse,
  normalizeBrowserRootUrl,
} from "./http.js";
import {
  createSnippet,
  deleteSnippets,
  listSnippets,
  updateSnippet,
} from "./snippets.js";
import {
  BrowserRequestThrottle,
  type BrowserRequestThrottleOptions,
} from "./throttle.js";
import type {
  BrowserCheckDraftResult,
  BrowserDeleteSnippetsResult,
  BrowserFetch,
  BrowserListSnippetsResult,
  BrowserLoginResult,
  BrowserSession,
  BrowserSnippetMutationResult,
  HeadersLike,
  TimeoutSignalFactory,
} from "./types.js";

export { browserBaseUrlFromApiUrl } from "./http.js";

export function createBrowserSession(
  config: Config,
  fetchImpl: BrowserFetch = fetch as BrowserFetch,
  timeoutSignal: TimeoutSignalFactory = (timeoutMs) => AbortSignal.timeout(timeoutMs),
  throttleOptions?: BrowserRequestThrottleOptions,
): BrowserSession {
  return new BrowserApiSession(config, fetchImpl, timeoutSignal, throttleOptions);
}

class BrowserApiSession implements BrowserSession {
  private readonly browserUrl: string;
  private readonly apiUrl: string;
  private readonly username?: string;
  private readonly password?: string;
  private readonly defaultSiteId?: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: BrowserFetch;
  private readonly timeoutSignal: TimeoutSignalFactory;
  private readonly throttle: BrowserRequestThrottle;
  private readonly cookies = new Map<string, string>();
  private authenticated = false;

  constructor(
    config: Config,
    fetchImpl: BrowserFetch,
    timeoutSignal: TimeoutSignalFactory,
    throttleOptions?: BrowserRequestThrottleOptions,
  ) {
    this.apiUrl = config.url;
    this.browserUrl = config.browserUrl
      ? normalizeBrowserRootUrl(config.browserUrl)
      : browserBaseUrlFromApiUrl(config.url);
    this.username = config.browserUsername;
    this.password = config.browserPassword;
    this.defaultSiteId = config.browserSiteId;
    this.timeoutMs = config.timeoutMs;
    this.fetchImpl = fetchImpl;
    this.timeoutSignal = timeoutSignal;
    this.throttle = new BrowserRequestThrottle(throttleOptions);
  }

  async login(args: { siteId?: string }): Promise<BrowserLoginResult> {
    this.assertConfigured();
    assertTrustedBrowserRootUrl(this.browserUrl, this.apiUrl);
    const siteId = this.resolveSiteId(args.siteId);
    this.cookies.clear();
    this.authenticated = false;

    const cookies = new Map<string, string>();
    await this.init(cookies);
    await this.submitLogin(cookies);
    await this.switchSite(siteId, cookies);

    for (const [name, value] of cookies) {
      this.cookies.set(name, value);
    }
    this.authenticated = true;

    return {
      success: true,
      authenticated: true,
      browser_url: this.browserUrl,
      site_id: siteId,
      cookie_names: Array.from(this.cookies.keys()),
      logged_in_at: new Date().toISOString(),
    };
  }

  async checkDraft(args: {
    assetId: string;
    assetType: string;
  }): Promise<BrowserCheckDraftResult> {
    return this.runWithSession(
      () => checkDraft(this.context(), args),
      "Browser session expired. Run browser_login, then retry browser_check_draft.",
    );
  }

  async listSnippets(args: {
    limit: number;
    offset: number;
  }): Promise<BrowserListSnippetsResult> {
    return this.runWithSession(() => listSnippets(this.context(), args));
  }

  async createSnippet(args: {
    title: string;
    name: string;
    value: string;
  }): Promise<BrowserSnippetMutationResult> {
    return this.runWithSession(() => createSnippet(this.context(), args));
  }

  async updateSnippet(args: {
    id: string;
    title: string;
    value: string;
  }): Promise<BrowserSnippetMutationResult> {
    return this.runWithSession(() => updateSnippet(this.context(), args));
  }

  async deleteSnippets(args: { ids: string[] }): Promise<BrowserDeleteSnippetsResult> {
    return this.runWithSession(() => deleteSnippets(this.context(), args));
  }

  hasSession(): boolean {
    return this.authenticated && this.hasSessionCookie(this.cookies);
  }

  cookieHeader(): string {
    return this.hasSession() ? cookieHeader(this.cookies) : "";
  }

  private async init(cookies: Map<string, string>): Promise<void> {
    const res = await this.fetchBrowser(this.browserUrl, {
      headers: documentHeaders({
        Referer: this.browserUrl,
      }),
      method: "GET",
    });
    this.rememberCookies(res.headers, cookies);
    if (!this.hasSessionCookie(cookies)) {
      throw new Error("Could not get browser session");
    }
  }

  private async submitLogin(cookies: Map<string, string>): Promise<void> {
    const body = new URLSearchParams({
      username: this.username ?? "",
      password: this.password ?? "",
      timeZone: getTimeZoneOffset(),
    }).toString();
    const res = await this.fetchBrowser(`${this.browserUrl}/loginsubmit.act`, {
      headers: documentHeaders({
        "content-type": "application/x-www-form-urlencoded",
        cookie: cookieHeader(cookies),
        Referer: `${this.browserUrl}/login.act`,
      }),
      body,
      method: "POST",
    });
    if (!res.ok || await isLoginPageResponse(res)) {
      throw new Error("Failed to login");
    }
    this.rememberCookies(res.headers, cookies);
  }

  private async switchSite(
    siteId: string,
    cookies: Map<string, string>,
  ): Promise<void> {
    const res = await this.fetchBrowser(
      `${this.browserUrl}/switchSite.act?siteId=${encodeURIComponent(siteId)}`,
      {
        headers: documentHeaders({
          cookie: cookieHeader(cookies),
          Referer: `${this.browserUrl}/home.act`,
        }),
        method: "GET",
      },
    );
    if (!res.ok || await isLoginPageResponse(res)) {
      throw new Error("Failed to login/switch site");
    }
    this.rememberCookies(res.headers, cookies);
  }

  private assertConfigured(): void {
    if (this.username && this.password) return;
    throw new Error(
      "Browser API login is not configured. Set CASCADE_BROWSER_USERNAME and CASCADE_BROWSER_PASSWORD to enable browser login. Set CASCADE_BROWSER_SITE_ID for startup/automatic browser login, or pass site_id to browser_login. Set CASCADE_BROWSER_URL only when the browser UI root differs from the origin derived from CASCADE_URL.",
    );
  }

  private resolveSiteId(siteId?: string): string {
    const resolved = siteId ?? this.defaultSiteId;
    if (resolved) return resolved;
    throw new Error(
      "Browser API site ID is not configured. Set CASCADE_BROWSER_SITE_ID to the production site ID for normal browser API use. To find it, select the production site in Cascade, open Manage Site, and copy the site ID from the browser URL. As a temporary recovery path, pass site_id to browser_login.",
    );
  }

  private async runWithSession<T>(
    operation: () => Promise<T>,
    expiredMessage =
      "Browser session expired. Run browser_login, then retry the browser-backed tool.",
  ): Promise<T> {
    if (!this.hasSession()) {
      this.assertConfigured();
      if (!this.defaultSiteId) {
        throw new Error(
          "Browser session is not authenticated and CASCADE_BROWSER_SITE_ID is not configured. Set CASCADE_BROWSER_SITE_ID to the production site ID, then restart the MCP server. To find it, select the production site in Cascade, open Manage Site, and copy the site ID from the browser URL. As a temporary recovery path, run browser_login with site_id first.",
        );
      }
      await this.login({});
    }

    try {
      return await operation();
    } catch (err) {
      if (err instanceof BrowserSessionExpiredError) {
        this.invalidateSession();
        if (this.defaultSiteId) {
          await this.login({});
          return await operation();
        }
        throw new Error(expiredMessage);
      }
      throw err;
    }
  }

  private context() {
    return {
      browserUrl: this.browserUrl,
      cookieHeader: this.cookieHeader(),
      fetchImpl: (input: string, init?: RequestInit) => this.fetchBrowser(input, init),
    };
  }

  private async fetchBrowser(
    input: string,
    init: RequestInit = {},
  ): Promise<Awaited<ReturnType<BrowserFetch>>> {
    return this.throttle.run(() =>
      this.fetchImpl(input, {
        ...init,
        signal: init.signal ?? this.timeoutSignal(this.timeoutMs),
      }),
    );
  }

  private invalidateSession(): void {
    this.cookies.clear();
    this.authenticated = false;
  }

  private rememberCookies(
    headers: HeadersLike,
    cookies: Map<string, string>,
  ): void {
    for (const setCookie of getSetCookieHeaders(headers)) {
      const cookiePair = setCookie.split(";")[0]?.trim();
      const separator = cookiePair?.indexOf("=") ?? -1;
      if (!cookiePair || separator < 1) continue;
      cookies.set(cookiePair.slice(0, separator), cookiePair.slice(separator + 1));
    }
  }

  private hasSessionCookie(cookies: Map<string, string>): boolean {
    return Array.from(cookies.keys()).some((name) =>
      name.toUpperCase().startsWith("JSESSION"),
    );
  }
}
