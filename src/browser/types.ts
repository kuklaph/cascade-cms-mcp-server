export type HeadersLike = Headers & {
  getSetCookie?: () => string[];
  getAll?: (name: "set-cookie" | "Set-Cookie") => string[];
};

export type BrowserResponse = {
  ok: boolean;
  headers: HeadersLike;
  status?: number;
  url?: string;
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
};

export type BrowserFetch = (
  input: string,
  init?: RequestInit,
) => Promise<BrowserResponse>;

export type TimeoutSignalFactory = (timeoutMs: number) => AbortSignal;

export type BrowserLoginResult = {
  success: true;
  authenticated: true;
  browser_url: string;
  site_id: string;
  cookie_names: string[];
  logged_in_at: string;
};

export type BrowserCheckDraftResult = {
  success: true;
  asset_id: string;
  asset_type: string;
  has_draft: boolean;
  status: number;
  message?: string;
};

export type BrowserSnippet = Record<string, unknown>;

export type BrowserListSnippetsResult = {
  success: true;
  snippets: BrowserSnippet[];
  total: number;
  count: number;
  offset: number;
  has_more: boolean;
  next_offset?: number;
  status: number;
};

export type BrowserSnippetMutationResult = {
  success: boolean;
  status: number;
  message?: string;
} & Record<string, unknown>;

export type BrowserDeleteSnippetsResult = BrowserSnippetMutationResult & {
  results?: unknown[];
};

export interface BrowserSession {
  login(args: { siteId?: string }): Promise<BrowserLoginResult>;
  checkDraft(args: {
    assetId: string;
    assetType: string;
  }): Promise<BrowserCheckDraftResult>;
  listSnippets(args: {
    limit: number;
    offset: number;
  }): Promise<BrowserListSnippetsResult>;
  createSnippet(args: {
    title: string;
    name: string;
    value: string;
  }): Promise<BrowserSnippetMutationResult>;
  updateSnippet(args: {
    id: string;
    title: string;
    value: string;
  }): Promise<BrowserSnippetMutationResult>;
  deleteSnippets(args: { ids: string[] }): Promise<BrowserDeleteSnippetsResult>;
  hasSession(): boolean;
  cookieHeader(): string;
}
