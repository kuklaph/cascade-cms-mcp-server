import { describe, expect, mock, test } from "bun:test";
import {
  browserBaseUrlFromApiUrl,
  createBrowserSession,
} from "../../src/browserApi.js";

type MockHeaders = {
  getSetCookie?: () => string[];
  getAll?: (name: string) => string[];
  get?: (name: string) => string | null;
};

type MockResponse = {
  ok?: boolean;
  headers?: ReturnType<typeof headersFrom>;
  url?: string;
  status?: number;
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
};

const headersFrom = ({ getSetCookie, getAll, get }: MockHeaders = {}) => ({
  getSetCookie,
  getAll,
  get,
});

const response = ({
  ok = true,
  headers = headersFrom(),
  url = "https://example.cascadecms.com/home.act",
  status = 200,
  text,
  json,
}: MockResponse = {}) => ({
  ok,
  headers,
  url,
  status,
  text,
  json,
});

const fetchQueue = (responses: Array<ReturnType<typeof response>>) => {
  const calls: Array<{ url: string; options: RequestInit }> = [];
  const fetchImpl = mock(async (url: string | URL | Request, options?: RequestInit) => {
    calls.push({ url: String(url), options: options ?? {} });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected fetch: ${String(url)}`);
    return next;
  });
  return { calls, fetchImpl };
};

const loginResponses = ({
  initHeaders = headersFrom({ get: () => "JSESSIONID=init; Path=/; HttpOnly" }),
  loginHeaders = headersFrom({ get: () => "" }),
  switchHeaders = headersFrom({ get: () => "" }),
} = {}) => [
  response({ headers: initHeaders }),
  response({ headers: loginHeaders }),
  response({ headers: switchHeaders }),
];

const configured = {
  apiKey: "api-key",
  url: "https://example.cascadecms.com/api/v1/",
  timeoutMs: 30000,
  browserUsername: "user+name@example.com & admin",
  browserPassword: "p@ss word&=+",
};

const configuredWithSiteId = {
  ...configured,
  browserSiteId: "default-site",
};

const loggedInSession = async (
  responses: Array<ReturnType<typeof response>>,
) => {
  const { calls, fetchImpl } = fetchQueue([...loginResponses(), ...responses]);
  const session = createBrowserSession(configured, fetchImpl as any);
  await session.login({ siteId: "site" });
  return { calls, session };
};

const expectMinimalAjaxHeaders = (
  headers: RequestInit["headers"],
  expected: Record<string, string>,
) => {
  expect(headers).toMatchObject(expected);
  expect(headers).not.toHaveProperty("accept-language");
  expect(headers).not.toHaveProperty("sec-ch-ua");
  expect(headers).not.toHaveProperty("sec-ch-ua-mobile");
  expect(headers).not.toHaveProperty("sec-ch-ua-platform");
  expect(headers).not.toHaveProperty("sec-fetch-dest");
  expect(headers).not.toHaveProperty("sec-fetch-mode");
  expect(headers).not.toHaveProperty("sec-fetch-site");
  expect(headers).not.toHaveProperty("Referrer-Policy");
};

describe("browserBaseUrlFromApiUrl", () => {
  test("derives the browser root from the Cascade API URL", () => {
    expect(browserBaseUrlFromApiUrl("https://example.cascadecms.com/api/v1/")).toBe(
      "https://example.cascadecms.com",
    );
  });
});

describe("createBrowserSession", () => {
  test("preserves pathful browser URL overrides", async () => {
    const { calls, fetchImpl } = fetchQueue(loginResponses());
    const session = createBrowserSession(
      {
        ...configured,
        browserUrl: "https://example.cascadecms.com/cascade/",
      },
      fetchImpl as any,
    );

    const result = await session.login({ siteId: "abc123" });

    expect(calls.map((call) => call.url)).toEqual([
      "https://example.cascadecms.com/cascade",
      "https://example.cascadecms.com/cascade/loginsubmit.act",
      "https://example.cascadecms.com/cascade/switchSite.act?siteId=abc123",
    ]);
    expect(result.browser_url).toBe("https://example.cascadecms.com/cascade");
  });

  test("uses explicit browser URL host overrides", async () => {
    const { calls, fetchImpl } = fetchQueue(loginResponses());
    const session = createBrowserSession(
      {
        ...configured,
        url: "https://cms.example.edu/api/v1/",
        browserUrl: "https://auth.example.edu",
      },
      fetchImpl as any,
    );

    await session.login({ siteId: "abc123" });

    expect(calls.map((call) => call.url)).toEqual([
      "https://auth.example.edu",
      "https://auth.example.edu/loginsubmit.act",
      "https://auth.example.edu/switchSite.act?siteId=abc123",
    ]);
  });

  test("rejects unrelated browser URL host overrides before fetch", async () => {
    const { calls, fetchImpl } = fetchQueue([]);
    const session = createBrowserSession(
      { ...configured, browserUrl: "https://not-cascade.example.net" },
      fetchImpl as any,
    );

    await expect(session.login({ siteId: "site" })).rejects.toThrow(
      "CASCADE_BROWSER_URL host must match CASCADE_URL host",
    );
    expect(calls).toHaveLength(0);
  });

  test("logs in, switches site, and returns no cookie values", async () => {
    const { calls, fetchImpl } = fetchQueue(loginResponses());
    const session = createBrowserSession(configured, fetchImpl as any);

    const result = await session.login({ siteId: "abc123" });

    expect(calls.map((call) => call.url)).toEqual([
      "https://example.cascadecms.com",
      "https://example.cascadecms.com/loginsubmit.act",
      "https://example.cascadecms.com/switchSite.act?siteId=abc123",
    ]);
    expect(new URLSearchParams(String(calls[1].options.body)).get("username")).toBe(
      configured.browserUsername,
    );
    expect(new URLSearchParams(String(calls[1].options.body)).get("password")).toBe(
      configured.browserPassword,
    );
    expect(calls[1].options.headers).toMatchObject({ cookie: "JSESSIONID=init" });
    expect(result).toMatchObject({
      success: true,
      authenticated: true,
      browser_url: "https://example.cascadecms.com",
      site_id: "abc123",
      cookie_names: ["JSESSIONID"],
    });
    expect(JSON.stringify(result)).not.toContain("init");
    expect(JSON.stringify(result)).not.toContain(configured.browserPassword);
    expect(session.hasSession()).toBe(true);
    expect(session.cookieHeader()).toBe("JSESSIONID=init");
  });

  test("uses configured browser site ID when login input omits siteId", async () => {
    const { calls, fetchImpl } = fetchQueue(loginResponses());
    const session = createBrowserSession(configuredWithSiteId, fetchImpl as any);

    const result = await session.login({});

    expect(calls[2].url).toBe(
      "https://example.cascadecms.com/switchSite.act?siteId=default-site",
    );
    expect(result.site_id).toBe("default-site");
    expect(session.hasSession()).toBe(true);
  });

  test("requires site ID from login input or CASCADE_BROWSER_SITE_ID", async () => {
    const { calls, fetchImpl } = fetchQueue([]);
    const session = createBrowserSession(configured, fetchImpl as any);

    await expect(session.login({})).rejects.toThrow("CASCADE_BROWSER_SITE_ID");
    expect(calls).toHaveLength(0);
  });

  test("uses rotated login cookies for switch-site", async () => {
    const { calls, fetchImpl } = fetchQueue(
      loginResponses({
        loginHeaders: headersFrom({
          get: () => "JSESSIONID=rotated; Path=/; HttpOnly",
        }),
      }),
    );
    const session = createBrowserSession(configured, fetchImpl as any);

    await session.login({ siteId: "site" });

    expect(calls[2].options.headers).toMatchObject({ cookie: "JSESSIONID=rotated" });
  });

  test("supports Node getSetCookie and Bun getAll header APIs", async () => {
    const node = fetchQueue(
      loginResponses({
        initHeaders: headersFrom({
          getSetCookie: () => ["JSESSIONID=node; Path=/; HttpOnly"],
        }),
      }),
    );
    await createBrowserSession(configured, node.fetchImpl as any).login({ siteId: "site" });
    expect(node.calls[1].options.headers).toMatchObject({ cookie: "JSESSIONID=node" });

    const bun = fetchQueue(
      loginResponses({
        initHeaders: headersFrom({
          getAll: (name: string) =>
            name === "set-cookie" ? ["JSESSIONID=bun; Path=/; HttpOnly"] : [],
        }),
      }),
    );
    await createBrowserSession(configured, bun.fetchImpl as any).login({ siteId: "site" });
    expect(bun.calls[1].options.headers).toMatchObject({ cookie: "JSESSIONID=bun" });
  });

  test("rejects non-HTTPS browser URLs before fetch", async () => {
    const { calls, fetchImpl } = fetchQueue([]);
    const session = createBrowserSession(
      { ...configured, browserUrl: "http://example.cascadecms.com" },
      fetchImpl as any,
    );

    await expect(session.login({ siteId: "site" })).rejects.toThrow(
      "Cascade browser URL must use HTTPS",
    );
    expect(calls).toHaveLength(0);
  });

  test("requires browser username and password before fetch", async () => {
    const { calls, fetchImpl } = fetchQueue([]);
    const session = createBrowserSession(
      {
        apiKey: "api-key",
        url: "https://example.cascadecms.com/api/v1/",
        timeoutMs: 30000,
      },
      fetchImpl as any,
    );

    await expect(session.login({ siteId: "site" })).rejects.toThrow(
      "CASCADE_BROWSER_USERNAME and CASCADE_BROWSER_PASSWORD",
    );
    await expect(session.login({ siteId: "site" })).rejects.toThrow(
      "CASCADE_BROWSER_URL",
    );
    expect(calls).toHaveLength(0);
  });

  test("throws when init does not return a session cookie", async () => {
    const { fetchImpl } = fetchQueue([
      response({ headers: headersFrom({ get: () => "OTHER=value; Path=/" }) }),
    ]);

    await expect(
      createBrowserSession(configured, fetchImpl as any).login({ siteId: "site" }),
    ).rejects.toThrow("Could not get browser session");
  });

  test("throws and does not switch site when login fails", async () => {
    const { calls, fetchImpl } = fetchQueue([
      response({ headers: headersFrom({ get: () => "JSESSIONID=init; Path=/" }) }),
      response({ ok: false }),
    ]);
    const session = createBrowserSession(configured, fetchImpl as any);

    await expect(session.login({ siteId: "site" })).rejects.toThrow("Failed to login");
    expect(calls).toHaveLength(2);
    expect(session.hasSession()).toBe(false);
    expect(session.cookieHeader()).toBe("");
  });

  test("throws when switch-site fails", async () => {
    const { fetchImpl } = fetchQueue([
      response({ headers: headersFrom({ get: () => "JSESSIONID=init; Path=/" }) }),
      response(),
      response({ ok: false }),
    ]);
    const session = createBrowserSession(configured, fetchImpl as any);

    await expect(session.login({ siteId: "site" })).rejects.toThrow(
      "Failed to login/switch site",
    );
    expect(session.hasSession()).toBe(false);
    expect(session.cookieHeader()).toBe("");
  });

  test("rejects ok login-page responses", async () => {
    const { fetchImpl } = fetchQueue([
      response({ headers: headersFrom({ get: () => "JSESSIONID=init; Path=/" }) }),
      response({
        url: "https://example.cascadecms.com/login.act",
        text: async () =>
          '<form action="/loginsubmit.act"><input name="username"><input name="password"></form>',
      }),
    ]);
    const session = createBrowserSession(configured, fetchImpl as any);

    await expect(session.login({ siteId: "site" })).rejects.toThrow("Failed to login");
    expect(session.hasSession()).toBe(false);
    expect(session.cookieHeader()).toBe("");
  });

  test("uses the configured timeout for browser requests", async () => {
    const { calls, fetchImpl } = fetchQueue(loginResponses());
    const signals = [
      new AbortController().signal,
      new AbortController().signal,
      new AbortController().signal,
    ];
    const timeoutMs: number[] = [];
    const session = createBrowserSession(
      { ...configured, timeoutMs: 1234 },
      fetchImpl as any,
      (ms) => {
        timeoutMs.push(ms);
        return signals[timeoutMs.length - 1];
      },
    );

    await session.login({ siteId: "site" });

    expect(timeoutMs).toEqual([1234, 1234, 1234]);
    expect(calls.map((call) => call.options.signal)).toEqual(signals);
  });

  test("checks draft notification with the authenticated browser session", async () => {
    const { calls, session } = await loggedInSession([
      response({ text: async () => JSON.stringify({ message: "Draft is active" }) }),
    ]);

    const result = await session.checkDraft({
      assetId: "asset id&1",
      assetType: "page",
    });

    expect(calls[3].url).toBe(
      "https://example.cascadecms.com/ajax/getEditingUsersNotification.act?id=asset%20id%261",
    );
    expect(calls[3].options.headers).toMatchObject({
      cookie: "JSESSIONID=init",
      Referer:
        "https://example.cascadecms.com/entity/open.act?id=asset%20id%261&type=page&action=edit",
      "x-requested-with": "XMLHttpRequest",
    });
    expect(result).toEqual({
      success: true,
      asset_id: "asset id&1",
      asset_type: "page",
      has_draft: true,
      message: "Draft is active",
      status: 200,
    });
  });

  test("reports no draft for an empty notification response", async () => {
    const { session } = await loggedInSession([
      response({ text: async () => "{}" }),
    ]);

    await expect(
      session.checkDraft({ assetId: "asset-123", assetType: "page" }),
    ).resolves.toEqual({
      success: true,
      asset_id: "asset-123",
      asset_type: "page",
      has_draft: false,
      status: 200,
    });
  });

  test("requires browser login before checking drafts", async () => {
    const { calls, fetchImpl } = fetchQueue([]);
    const session = createBrowserSession(configured, fetchImpl as any);

    await expect(
      session.checkDraft({ assetId: "asset-123", assetType: "page" }),
    ).rejects.toThrow("CASCADE_BROWSER_SITE_ID");
    expect(calls).toHaveLength(0);
  });

  test("clears the session when check draft gets a login page", async () => {
    const { session } = await loggedInSession([
      response({
        url: "https://example.cascadecms.com/login.act",
        text: async () =>
          '<form action="/loginsubmit.act"><input name="username"><input name="password"></form>',
      }),
    ]);

    await expect(
      session.checkDraft({ assetId: "asset-123", assetType: "page" }),
    ).rejects.toThrow("Browser session expired");
    expect(session.hasSession()).toBe(false);
    expect(session.cookieHeader()).toBe("");
  });

  test("clears the session when check draft gets an auth failure status", async () => {
    const { session } = await loggedInSession([
      response({ ok: false, status: 401, text: async () => "Unauthorized" }),
    ]);

    await expect(
      session.checkDraft({ assetId: "asset-123", assetType: "page" }),
    ).rejects.toThrow("Browser session expired");
    expect(session.hasSession()).toBe(false);
  });

  test("surfaces non-auth check draft HTTP failures without clearing session", async () => {
    const { session } = await loggedInSession([
      response({ ok: false, status: 500, text: async () => "Server error" }),
    ]);

    await expect(
      session.checkDraft({ assetId: "asset-123", assetType: "page" }),
    ).rejects.toThrow("Check draft notification failed with HTTP 500: Server error");
    expect(session.hasSession()).toBe(true);
  });

  test("lists snippets with the authenticated browser session and minimal headers", async () => {
    const snippets = [
      {
        id: "id-1",
        type: "snippet",
        name: "alpha",
        title: "Alpha",
        value: "1",
        snippetToken: "{snip:alpha}",
      },
      {
        id: "id-2",
        type: "snippet",
        name: "beta",
        title: "Beta",
        value: "2",
        snippetToken: "{snip:beta}",
      },
      {
        id: "id-3",
        type: "snippet",
        name: "gamma",
        title: "Gamma",
        value: "3",
        snippetToken: "{snip:gamma}",
      },
    ];
    const { calls, session } = await loggedInSession([
      response({ json: async () => ({ snippets }) }),
    ]);

    const result = await session.listSnippets({ limit: 1, offset: 1 });

    expect(calls[3].url).toBe("https://example.cascadecms.com/ajax/snippets.act");
    expectMinimalAjaxHeaders(calls[3].options.headers, {
      accept: "application/json, text/javascript, */*; q=0.01",
      cookie: "JSESSIONID=init",
      Referer: "https://example.cascadecms.com/administration/snippets.act",
      "x-requested-with": "XMLHttpRequest",
    });
    expect(result).toEqual({
      success: true,
      snippets: [snippets[1]],
      total: 3,
      count: 1,
      offset: 1,
      has_more: true,
      next_offset: 2,
      status: 200,
    });
  });

  test("automatically logs in before listing snippets when default site ID is configured", async () => {
    const snippets = [{ id: "id-1", name: "alpha" }];
    const { calls, fetchImpl } = fetchQueue([
      ...loginResponses(),
      response({ json: async () => ({ snippets }) }),
    ]);
    const session = createBrowserSession(configuredWithSiteId, fetchImpl as any);

    const result = await session.listSnippets({ limit: 50, offset: 0 });

    expect(calls.map((call) => call.url)).toEqual([
      "https://example.cascadecms.com",
      "https://example.cascadecms.com/loginsubmit.act",
      "https://example.cascadecms.com/switchSite.act?siteId=default-site",
      "https://example.cascadecms.com/ajax/snippets.act",
    ]);
    expect(result).toMatchObject({
      success: true,
      snippets,
      total: 1,
      count: 1,
    });
  });

  test("creates snippets with form-encoded fields and minimal headers", async () => {
    const { calls, session } = await loggedInSession([
      response({ json: async () => ({ success: "Snippet created successfully." }) }),
    ]);

    const result = await session.createSnippet({
      title: "Test Create",
      name: "test-create",
      value: "test value",
    });

    expect(calls[3].url).toBe(
      "https://example.cascadecms.com/ajax/snippets/submit.act",
    );
    expectMinimalAjaxHeaders(calls[3].options.headers, {
      accept: "*/*",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      cookie: "JSESSIONID=init",
      Referer: "https://example.cascadecms.com/administration/snippets.act",
      "x-requested-with": "XMLHttpRequest",
    });
    const body = new URLSearchParams(String(calls[3].options.body));
    expect(body.get("title")).toBe("Test Create");
    expect(body.get("name")).toBe("test-create");
    expect(body.get("value")).toBe("test value");
    expect(body.get("formsubmit")).toBe("true");
    expect(result).toEqual({
      success: true,
      message: "Snippet created successfully.",
      status: 200,
    });
  });

  test("preserves failed snippet mutation responses", async () => {
    const { session } = await loggedInSession([
      response({
        json: async () => ({
          success: false,
          message: "Snippet name already exists.",
        }),
      }),
    ]);

    await expect(
      session.createSnippet({
        title: "Duplicate",
        name: "duplicate",
        value: "test value",
      }),
    ).resolves.toEqual({
      success: false,
      message: "Snippet name already exists.",
      status: 200,
    });
  });

  test("updates snippets with id, title, and value", async () => {
    const { calls, session } = await loggedInSession([
      response({ json: async () => ({ success: "Snippet updated successfully." }) }),
    ]);

    const result = await session.updateSnippet({
      id: "snippet-id",
      title: "Testing1",
      value: "811",
    });

    expect(calls[3].url).toBe(
      "https://example.cascadecms.com/ajax/snippets/submit.act",
    );
    const body = new URLSearchParams(String(calls[3].options.body));
    expect(Object.fromEntries(body)).toEqual({
      id: "snippet-id",
      title: "Testing1",
      value: "811",
    });
    expect(result).toEqual({
      success: true,
      message: "Snippet updated successfully.",
      status: 200,
    });
  });

  test("deletes one or more snippets with repeated selected id fields", async () => {
    const { calls, session } = await loggedInSession([
      response({
        json: async () => ({
          success: "Snippets deleted successfully!",
          results: [
            { success: true, id: "id-1" },
            { success: true, id: "id-2" },
          ],
        }),
      }),
    ]);

    const result = await session.deleteSnippets({ ids: ["id-1", "id-2"] });

    expect(calls[3].url).toBe(
      "https://example.cascadecms.com/ajax/snippets/delete.act",
    );
    const body = new URLSearchParams(String(calls[3].options.body));
    expect(body.getAll("selectedIds[]")).toEqual(["id-1", "id-2"]);
    expect(body.get("formsubmit")).toBe("true");
    expect(result).toEqual({
      success: true,
      message: "Snippets deleted successfully!",
      results: [
        { success: true, id: "id-1" },
        { success: true, id: "id-2" },
      ],
      status: 200,
    });
  });

  test("requires browser login before snippet operations", async () => {
    const { calls, fetchImpl } = fetchQueue([]);
    const session = createBrowserSession(configured, fetchImpl as any);

    await expect(session.listSnippets({ limit: 50, offset: 0 })).rejects.toThrow(
      "CASCADE_BROWSER_SITE_ID",
    );
    expect(calls).toHaveLength(0);
  });

  test("clears the session when snippet operations get an auth failure status", async () => {
    const { session } = await loggedInSession([
      response({ ok: false, status: 401, text: async () => "Unauthorized" }),
    ]);

    await expect(session.listSnippets({ limit: 50, offset: 0 })).rejects.toThrow(
      "Browser session expired",
    );
    expect(session.hasSession()).toBe(false);
  });

  test("surfaces non-auth snippet HTTP failures without clearing session", async () => {
    const { session } = await loggedInSession([
      response({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ success: false, message: "Bad snippet" }),
      }),
    ]);

    await expect(session.listSnippets({ limit: 50, offset: 0 })).rejects.toThrow(
      'List snippets failed with HTTP 400: {"success":false,"message":"Bad snippet"}',
    );
    expect(session.hasSession()).toBe(true);
  });
});
