import { describe, test, expect } from "bun:test";
import {
  ReadRequestSchema,
  CreateRequestSchema,
  EditRequestSchema,
  RemoveRequestSchema,
  MoveRequestSchema,
  CopyRequestSchema,
  SearchRequestSchema,
  SiteCopyRequestSchema,
  ListSitesRequestSchema,
  ReadAccessRightsRequestSchema,
  EditAccessRightsRequestSchema,
  ReadWorkflowSettingsRequestSchema,
  EditWorkflowSettingsRequestSchema,
  ListSubscribersRequestSchema,
  ListMessagesRequestSchema,
  MarkMessageRequestSchema,
  DeleteMessageRequestSchema,
  CheckOutRequestSchema,
  CheckInRequestSchema,
  ReadAuditsRequestSchema,
  ReadWorkflowInformationRequestSchema,
  PerformWorkflowTransitionRequestSchema,
  ReadPreferencesRequestSchema,
  PublishUnpublishRequestSchema,
  EditPreferenceRequestSchema,
  AssetListFactsRequestSchema,
  AssetSearchValuesRequestSchema,
  AssetSearchKeysRequestSchema,
  AssetGetValueRequestSchema,
  AssetListReferencesRequestSchema,
  AssetListNodeletsRequestSchema,
  AssetGetNodeletRequestSchema,
} from "../../../src/schemas/requests.js";

// Reusable fixtures
const ID_PAGE = { id: "abc123", type: "page" as const };
const VALID_ASSET = {
  page: {
    type: "page" as const,
    name: "index",
    parentFolderPath: "/",
    siteName: "my-site",
    contentTypePath: "/content-types/default",
  },
};

describe("ReadRequestSchema", () => {
  test("should accept a valid read request", () => {
    const res = ReadRequestSchema.safeParse({ identifier: ID_PAGE });
    expect(res.success).toBe(true);
  });
});

describe("CreateRequestSchema", () => {
  test("should accept a valid create request wrapping an asset", () => {
    const res = CreateRequestSchema.safeParse({ asset: VALID_ASSET });
    expect(res.success).toBe(true);
  });
});

describe("EditRequestSchema", () => {
  test("should accept a valid edit request (same shape as create)", () => {
    const res = EditRequestSchema.safeParse({
      asset: { page: { ...VALID_ASSET.page, id: "existing-id" } },
    });
    expect(res.success).toBe(true);
  });
});

describe("RemoveRequestSchema", () => {
  test("should accept a valid remove request with just identifier", () => {
    const res = RemoveRequestSchema.safeParse({ identifier: ID_PAGE });
    expect(res.success).toBe(true);
  });
});

describe("MoveRequestSchema", () => {
  test("should accept a valid move request with moveParameters", () => {
    const res = MoveRequestSchema.safeParse({
      identifier: ID_PAGE,
      moveParameters: {
        destinationContainerIdentifier: {
          id: "parent-id",
          type: "folder",
        },
        doWorkflow: false,
      },
    });
    expect(res.success).toBe(true);
  });
});

describe("CopyRequestSchema", () => {
  test("should accept a valid copy request with copyParameters", () => {
    const res = CopyRequestSchema.safeParse({
      identifier: ID_PAGE,
      copyParameters: {
        destinationContainerIdentifier: {
          id: "parent-id",
          type: "folder",
        },
        doWorkflow: false,
        newName: "copy-of-index",
      },
    });
    expect(res.success).toBe(true);
  });
});

describe("SearchRequestSchema", () => {
  test("should accept a valid search request with searchTerms only", () => {
    const res = SearchRequestSchema.safeParse({
      searchInformation: { searchTerms: "hello world" },
    });
    expect(res.success).toBe(true);
  });
});

describe("SiteCopyRequestSchema", () => {
  test("should accept a valid site copy with originalSiteName and newSiteName", () => {
    const res = SiteCopyRequestSchema.safeParse({
      originalSiteName: "existing",
      newSiteName: "brand-new",
    });
    expect(res.success).toBe(true);
  });
});

describe("ListSitesRequestSchema", () => {
  test("should accept an empty list sites request", () => {
    const res = ListSitesRequestSchema.safeParse({});
    expect(res.success).toBe(true);
  });
});

describe("ReadAccessRightsRequestSchema", () => {
  test("should accept a valid read access rights request", () => {
    const res = ReadAccessRightsRequestSchema.safeParse({
      identifier: ID_PAGE,
    });
    expect(res.success).toBe(true);
  });
});

describe("EditAccessRightsRequestSchema", () => {
  test("should accept a valid edit access rights request with passthrough info", () => {
    const res = EditAccessRightsRequestSchema.safeParse({
      identifier: ID_PAGE,
      accessRightsInformation: { allLevel: "read", aclEntries: [] },
      applyToChildren: true,
    });
    expect(res.success).toBe(true);
  });
});

describe("ReadWorkflowSettingsRequestSchema", () => {
  test("should accept a valid read workflow settings request", () => {
    const res = ReadWorkflowSettingsRequestSchema.safeParse({
      identifier: ID_PAGE,
    });
    expect(res.success).toBe(true);
  });
});

describe("EditWorkflowSettingsRequestSchema", () => {
  test("should accept a valid edit workflow settings request", () => {
    const res = EditWorkflowSettingsRequestSchema.safeParse({
      identifier: ID_PAGE,
      workflowSettings: { inheritWorkflows: true },
      applyInheritWorkflowsToChildren: true,
      applyRequireWorkflowToChildren: false,
    });
    expect(res.success).toBe(true);
  });
});

describe("ListSubscribersRequestSchema", () => {
  test("should accept a valid list subscribers request", () => {
    const res = ListSubscribersRequestSchema.safeParse({
      identifier: ID_PAGE,
    });
    expect(res.success).toBe(true);
  });
});

describe("ListMessagesRequestSchema", () => {
  test("should accept an empty list messages request", () => {
    const res = ListMessagesRequestSchema.safeParse({});
    expect(res.success).toBe(true);
  });
});

describe("MarkMessageRequestSchema", () => {
  test("should accept a valid mark message request", () => {
    const res = MarkMessageRequestSchema.safeParse({
      identifier: { id: "msg-1", type: "message" },
      markType: "read",
    });
    expect(res.success).toBe(true);
  });
});

describe("DeleteMessageRequestSchema", () => {
  test("should accept a valid delete message request", () => {
    const res = DeleteMessageRequestSchema.safeParse({
      identifier: { id: "msg-1", type: "message" },
    });
    expect(res.success).toBe(true);
  });
});

describe("CheckOutRequestSchema", () => {
  test("should accept a valid check out request", () => {
    const res = CheckOutRequestSchema.safeParse({ identifier: ID_PAGE });
    expect(res.success).toBe(true);
  });
});

describe("CheckInRequestSchema", () => {
  test("should accept a valid check in request", () => {
    const res = CheckInRequestSchema.safeParse({
      identifier: ID_PAGE,
      comments: "Edited hero section",
    });
    expect(res.success).toBe(true);
  });
});

describe("ReadAuditsRequestSchema", () => {
  test("should accept a valid read audits request with passthrough auditParameters", () => {
    const res = ReadAuditsRequestSchema.safeParse({
      auditParameters: {
        username: "alice",
        auditType: "publish",
      },
    });
    expect(res.success).toBe(true);
  });
});

describe("ReadWorkflowInformationRequestSchema", () => {
  test("should accept a valid read workflow information request", () => {
    const res = ReadWorkflowInformationRequestSchema.safeParse({
      identifier: ID_PAGE,
    });
    expect(res.success).toBe(true);
  });
});

describe("PerformWorkflowTransitionRequestSchema", () => {
  test("should accept a valid perform workflow transition request", () => {
    const res = PerformWorkflowTransitionRequestSchema.safeParse({
      workflowId: "wf-1",
      actionIdentifier: "approve",
      transitionComment: "Looks good",
    });
    expect(res.success).toBe(true);
  });
});

describe("ReadPreferencesRequestSchema", () => {
  test("should accept an empty read preferences request", () => {
    const res = ReadPreferencesRequestSchema.safeParse({});
    expect(res.success).toBe(true);
  });
});

describe("PublishUnpublishRequestSchema", () => {
  test("should accept a valid publish/unpublish request", () => {
    const res = PublishUnpublishRequestSchema.safeParse({
      identifier: ID_PAGE,
      publishInformation: {
        unpublish: false,
        destinations: [{ id: "dest-1", type: "destination" }],
      },
    });
    expect(res.success).toBe(true);
  });
});

describe("EditPreferenceRequestSchema", () => {
  test("should accept a valid edit preference request", () => {
    const res = EditPreferenceRequestSchema.safeParse({
      preference: { name: "some.key", value: "some.value" },
    });
    expect(res.success).toBe(true);
  });
});

// Edge cases (10)

describe("Edge cases", () => {
  test("ReadRequestSchema should reject when identifier is missing", () => {
    const res = ReadRequestSchema.safeParse({});
    expect(res.success).toBe(false);
  });

  test("SearchRequestSchema should reject when searchInformation.searchTerms is missing", () => {
    const res = SearchRequestSchema.safeParse({ searchInformation: {} });
    expect(res.success).toBe(false);
  });

  test("SiteCopyRequestSchema should reject when neither originalSiteId nor originalSiteName is provided", () => {
    const res = SiteCopyRequestSchema.safeParse({ newSiteName: "x" });
    expect(res.success).toBe(false);
  });

  test("MarkMessageRequestSchema should reject an invalid markType value", () => {
    const res = MarkMessageRequestSchema.safeParse({
      identifier: { id: "msg-1", type: "message" },
      markType: "delete-now",
    });
    expect(res.success).toBe(false);
  });

  test("PerformWorkflowTransitionRequestSchema should reject when workflowId is missing", () => {
    const res = PerformWorkflowTransitionRequestSchema.safeParse({
      actionIdentifier: "approve",
    });
    expect(res.success).toBe(false);
  });

  test("MoveRequestSchema should reject when moveParameters.doWorkflow is missing", () => {
    const res = MoveRequestSchema.safeParse({
      identifier: ID_PAGE,
      moveParameters: {
        destinationContainerIdentifier: { id: "parent-id", type: "folder" },
      },
    });
    expect(res.success).toBe(false);
  });

  test("CopyRequestSchema should reject when copyParameters.newName is missing", () => {
    const res = CopyRequestSchema.safeParse({
      identifier: ID_PAGE,
      copyParameters: {
        destinationContainerIdentifier: { id: "parent-id", type: "folder" },
        doWorkflow: false,
      },
    });
    expect(res.success).toBe(false);
  });

  test("SearchRequestSchema should reject empty-string searchTerms (min length 1)", () => {
    const res = SearchRequestSchema.safeParse({
      searchInformation: { searchTerms: "" },
    });
    expect(res.success).toBe(false);
  });

  test("ReadRequestSchema should reject an invalid response_format value", () => {
    const res = ReadRequestSchema.safeParse({
      identifier: ID_PAGE,
      response_format: "xml",
    });
    expect(res.success).toBe(false);
  });

  test("PublishUnpublishRequestSchema should allow passthrough arbitrary fields on publishInformation", () => {
    const res = PublishUnpublishRequestSchema.safeParse({
      identifier: ID_PAGE,
      publishInformation: {
        unpublish: false,
        somethingArbitrary: "value",
        vendorExtension: { nested: true },
      },
    });
    expect(res.success).toBe(true);
  });
});

// Pagination field tests: SearchRequestSchema, ListMessagesRequestSchema, ReadAuditsRequestSchema

describe("SearchRequestSchema pagination", () => {
  test("should apply default limit=50 and offset=0 when omitted", () => {
    const res = SearchRequestSchema.safeParse({
      searchInformation: { searchTerms: "hello" },
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.limit).toBe(50);
      expect(res.data.offset).toBe(0);
    }
  });

  test("should accept custom limit and offset within bounds", () => {
    const res = SearchRequestSchema.safeParse({
      searchInformation: { searchTerms: "hello" },
      limit: 200,
      offset: 100,
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.limit).toBe(200);
      expect(res.data.offset).toBe(100);
    }
  });

  test("should reject limit above max (500)", () => {
    const res = SearchRequestSchema.safeParse({
      searchInformation: { searchTerms: "hello" },
      limit: 600,
    });
    expect(res.success).toBe(false);
  });

  test("should reject limit below min (1)", () => {
    const res = SearchRequestSchema.safeParse({
      searchInformation: { searchTerms: "hello" },
      limit: 0,
    });
    expect(res.success).toBe(false);
  });

  test("should reject negative offset", () => {
    const res = SearchRequestSchema.safeParse({
      searchInformation: { searchTerms: "hello" },
      offset: -1,
    });
    expect(res.success).toBe(false);
  });

  test("should reject non-integer limit", () => {
    const res = SearchRequestSchema.safeParse({
      searchInformation: { searchTerms: "hello" },
      limit: 3.5,
    });
    expect(res.success).toBe(false);
  });
});

describe("ListMessagesRequestSchema pagination", () => {
  test("should apply default limit=50 and offset=0 when omitted", () => {
    const res = ListMessagesRequestSchema.safeParse({});
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.limit).toBe(50);
      expect(res.data.offset).toBe(0);
    }
  });

  test("should reject limit above max (500)", () => {
    const res = ListMessagesRequestSchema.safeParse({ limit: 501 });
    expect(res.success).toBe(false);
  });

  test("should reject negative offset", () => {
    const res = ListMessagesRequestSchema.safeParse({ offset: -5 });
    expect(res.success).toBe(false);
  });
});

describe("ReadAuditsRequestSchema pagination", () => {
  test("should apply default limit=50 and offset=0 when omitted", () => {
    const res = ReadAuditsRequestSchema.safeParse({
      auditParameters: { username: "alice" },
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.limit).toBe(50);
      expect(res.data.offset).toBe(0);
    }
  });

  test("should reject limit below min (1)", () => {
    const res = ReadAuditsRequestSchema.safeParse({
      auditParameters: { username: "alice" },
      limit: 0,
    });
    expect(res.success).toBe(false);
  });

  test("should accept boundary values limit=500 and offset=0", () => {
    const res = ReadAuditsRequestSchema.safeParse({
      auditParameters: { username: "alice" },
      limit: 500,
      offset: 0,
    });
    expect(res.success).toBe(true);
  });
});

describe("ReadRequestSchema read_mode field", () => {
  test("should default read_mode to 'preview' when omitted", () => {
    const res = ReadRequestSchema.safeParse({ identifier: ID_PAGE });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.read_mode).toBe("preview");
    }
  });

  test("should accept read_mode: 'raw'", () => {
    const res = ReadRequestSchema.safeParse({
      identifier: ID_PAGE,
      read_mode: "raw",
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.read_mode).toBe("raw");
    }
  });

  test("should reject unknown read_mode value", () => {
    const res = ReadRequestSchema.safeParse({
      identifier: ID_PAGE,
      read_mode: "full",
    });
    expect(res.success).toBe(false);
  });

  test("should reject removed response_detail field", () => {
    const res = ReadRequestSchema.safeParse({
      identifier: ID_PAGE,
      response_detail: "summary",
    });
    expect(res.success).toBe(false);
  });

  test("EditRequestSchema should NOT accept response_detail (strict rejects unknown key)", () => {
    const res = EditRequestSchema.safeParse({
      asset: { page: { ...VALID_ASSET.page, id: "existing-id" } },
      response_detail: "summary",
    });
    expect(res.success).toBe(false);
  });
});

describe("asset follow-up request schemas", () => {
  const HANDLE = "a_00000000-0000-0000-0000-000000000000";

  test("list facts accepts audit filters and requires asset_handle", () => {
    expect(
      AssetListFactsRequestSchema.safeParse({
        asset_handle: HANDLE,
        pointer_prefix: "/asset/page",
        fact_kind: "scalar",
        key_contains: "title",
        scalar_type: "string",
        non_empty: true,
        limit: 25,
      }).success,
    ).toBe(true);
    expect(AssetListFactsRequestSchema.safeParse({ fact_kind: "scalar" }).success).toBe(false);
  });

  test("search values and keys accept exact raw search inputs", () => {
    expect(
      AssetSearchValuesRequestSchema.safeParse({
        asset_handle: HANDLE,
        value_contains: "https://example.com",
      }).success,
    ).toBe(true);
    expect(
      AssetSearchKeysRequestSchema.safeParse({
        asset_handle: HANDLE,
        key: "pageRegions",
      }).success,
    ).toBe(true);
  });

  test("get value accepts pointer and optional string slice bounds", () => {
    const res = AssetGetValueRequestSchema.safeParse({
      asset_handle: HANDLE,
      pointer: "/asset/page/xhtml",
      offset: 100,
      length: 50,
    });
    expect(res.success).toBe(true);
  });

  test("list references accepts reference filters and cursor", () => {
    const res = AssetListReferencesRequestSchema.safeParse({
      asset_handle: HANDLE,
      reference_kind: "block",
      cursor: "af_eyJ2IjoxLCJvIjoyLCJoIjoiYWJjIn0",
    });
    expect(res.success).toBe(true);
  });

  test("audit cursors reject oversized or malformed values", () => {
    expect(
      AssetListReferencesRequestSchema.safeParse({
        asset_handle: HANDLE,
        cursor: "x_" + "a".repeat(16),
      }).success,
    ).toBe(false);
    expect(
      AssetListReferencesRequestSchema.safeParse({
        asset_handle: HANDLE,
        cursor: "af_" + "a".repeat(600),
      }).success,
    ).toBe(false);
  });

  test("list nodelets accepts pointer and optional cursor", () => {
    const res = AssetListNodeletsRequestSchema.safeParse({
      asset_handle: HANDLE,
      pointer: "",
      cursor: "c_25",
    });
    expect(res.success).toBe(true);
  });

  test("get nodelet accepts bounded depth and include_text", () => {
    const res = AssetGetNodeletRequestSchema.safeParse({
      asset_handle: HANDLE,
      pointer: "/asset/page/structuredData/structuredDataNodes/0",
      depth: 2,
      include_text: false,
    });
    expect(res.success).toBe(true);
  });
});
