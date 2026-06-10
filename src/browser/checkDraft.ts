import {
  assertBrowserResponseOk,
  ajaxHeaders,
  readJsonObjectResponse,
} from "./http.js";
import type {
  BrowserCheckDraftResult,
  BrowserFetch,
} from "./types.js";

type CheckDraftContext = {
  browserUrl: string;
  cookieHeader: string;
  fetchImpl: BrowserFetch;
};

export async function checkDraft(
  ctx: CheckDraftContext,
  args: { assetId: string; assetType: string },
): Promise<BrowserCheckDraftResult> {
  const res = await ctx.fetchImpl(
    `${ctx.browserUrl}/ajax/getEditingUsersNotification.act?id=${encodeURIComponent(args.assetId)}`,
    {
      headers: ajaxHeaders({
        cookie: ctx.cookieHeader,
        Referer:
          `${ctx.browserUrl}/entity/open.act?id=${encodeURIComponent(args.assetId)}` +
          `&type=${encodeURIComponent(args.assetType)}&action=edit`,
      }),
      method: "GET",
    },
  );

  await assertBrowserResponseOk(res, "Check draft notification");

  const body = await readJsonObjectResponse(
    res,
    "Invalid check draft response",
  );
  const message = typeof body.message === "string" ? body.message : undefined;
  return {
    success: true,
    asset_id: args.assetId,
    asset_type: args.assetType,
    has_draft: Object.keys(body).length > 0,
    ...(message ? { message } : {}),
    status: res.status ?? 200,
  };
}
