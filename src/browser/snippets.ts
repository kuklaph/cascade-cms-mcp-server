import {
  ajaxHeaders,
  assertBrowserResponseOk,
  readJsonObjectResponse,
} from "./http.js";
import type {
  BrowserDeleteSnippetsResult,
  BrowserFetch,
  BrowserListSnippetsResult,
  BrowserSnippet,
  BrowserSnippetMutationResult,
} from "./types.js";

type SnippetContext = {
  browserUrl: string;
  cookieHeader: string;
  fetchImpl: BrowserFetch;
};

export async function listSnippets(
  ctx: SnippetContext,
  args: { limit: number; offset: number },
): Promise<BrowserListSnippetsResult> {
  const res = await ctx.fetchImpl(`${ctx.browserUrl}/ajax/snippets.act`, {
    headers: snippetJsonHeaders(ctx),
    method: "GET",
  });

  await assertBrowserResponseOk(res, "List snippets");

  const body = await readJsonObjectResponse(res, "Invalid snippets response");
  if (!Array.isArray(body.snippets)) {
    throw new Error("Invalid snippets response");
  }

  const snippets = body.snippets as BrowserSnippet[];
  const offset = Math.max(0, Math.floor(args.offset));
  const limit = Math.max(1, Math.floor(args.limit));
  const page = snippets.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  const hasMore = nextOffset < snippets.length;

  return {
    success: true,
    snippets: page,
    total: snippets.length,
    count: page.length,
    offset,
    has_more: hasMore,
    ...(hasMore ? { next_offset: nextOffset } : {}),
    status: res.status ?? 200,
  };
}

export async function createSnippet(
  ctx: SnippetContext,
  args: { title: string; name: string; value: string },
): Promise<BrowserSnippetMutationResult> {
  const body = new URLSearchParams({
    title: args.title,
    name: args.name,
    value: args.value,
    formsubmit: "true",
    viewingId: "",
    viewingType: "",
  });
  return submitSnippetForm(ctx, body);
}

export async function updateSnippet(
  ctx: SnippetContext,
  args: { id: string; title: string; value: string },
): Promise<BrowserSnippetMutationResult> {
  const body = new URLSearchParams({
    id: args.id,
    title: args.title,
    value: args.value,
  });
  return submitSnippetForm(ctx, body);
}

export async function deleteSnippets(
  ctx: SnippetContext,
  args: { ids: string[] },
): Promise<BrowserDeleteSnippetsResult> {
  const body = new URLSearchParams();
  for (const id of args.ids) {
    body.append("selectedIds[]", id);
  }
  body.set("formsubmit", "true");
  body.set("viewingId", "");
  body.set("viewingType", "");

  const res = await ctx.fetchImpl(`${ctx.browserUrl}/ajax/snippets/delete.act`, {
    headers: snippetFormHeaders(ctx),
    body: body.toString(),
    method: "POST",
  });

  await assertBrowserResponseOk(res, "Delete snippets");

  const parsed = await readJsonObjectResponse(res, "Invalid delete snippets response");
  return mutationResult(parsed, res.status ?? 200) as BrowserDeleteSnippetsResult;
}

async function submitSnippetForm(
  ctx: SnippetContext,
  body: URLSearchParams,
): Promise<BrowserSnippetMutationResult> {
  const res = await ctx.fetchImpl(`${ctx.browserUrl}/ajax/snippets/submit.act`, {
    headers: snippetFormHeaders(ctx),
    body: body.toString(),
    method: "POST",
  });

  await assertBrowserResponseOk(res, "Submit snippet");

  const parsed = await readJsonObjectResponse(res, "Invalid snippet submit response");
  return mutationResult(parsed, res.status ?? 200);
}

function snippetJsonHeaders(ctx: SnippetContext): Record<string, string> {
  return ajaxHeaders({
    accept: "application/json, text/javascript, */*; q=0.01",
    cookie: ctx.cookieHeader,
    Referer: `${ctx.browserUrl}/administration/snippets.act`,
  });
}

function snippetFormHeaders(ctx: SnippetContext): Record<string, string> {
  return ajaxHeaders({
    accept: "*/*",
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    cookie: ctx.cookieHeader,
    Referer: `${ctx.browserUrl}/administration/snippets.act`,
  });
}

function mutationResult(
  body: Record<string, unknown>,
  status: number,
): BrowserSnippetMutationResult {
  const { success: rawSuccess, ...rest } = body;
  const success = typeof rawSuccess === "boolean" ? rawSuccess : true;
  const message =
    typeof rawSuccess === "string"
      ? rawSuccess
      : typeof body.message === "string"
        ? body.message
        : undefined;

  return {
    success,
    ...rest,
    ...(message ? { message } : {}),
    status,
  };
}
