import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
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
  AssetListScalarArtifactsRequestSchema,
  AssetListReferencesRequestSchema,
  AssetListNodeletsRequestSchema,
  AssetGetNodeletRequestSchema,
  AssetResolveNodesRequestSchema,
  AssetAssertValuesRequestSchema,
  DraftOpenRequestSchema,
  DraftScaffoldCreateRequestSchema,
  DraftScaffoldFromAssetRequestSchema,
  DraftGetValueRequestSchema,
  DraftListScalarArtifactsRequestSchema,
  DraftApplyPatchRequestSchema,
  DraftApplySemanticPatchRequestSchema,
  DraftAssertValuesRequestSchema,
  DraftResolveNodesRequestSchema,
  DraftSetFileDataRequestSchema,
  DraftSubmitRequestSchema,
  DraftMutationPlanExecuteRequestSchema,
} from "../../../src/schemas/requests.js";
import { ASSET_DRAFT_PATCH_MAX_OPERATIONS } from "../../../src/constants.js";

function stringUnionFromTypes(typeName: string): string[] {
  const source = readFileSync(
    "node_modules/cascade-cms-api/types/types.d.ts",
    "utf8",
  );
  const match = source.match(
    new RegExp(`export type ${typeName} =([\\s\\S]*?);`),
  );
  if (!match) throw new Error(`${typeName} union not found`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]).sort();
}

// Reusable fixtures
const ID_PAGE = { id: "abc123", type: "page" as const };
const VALID_ASSET = {
  page: {
    name: "index",
    parentFolderPath: "/",
    siteName: "my-site",
    contentTypePath: "/content-types/default",
    xhtml: "<p>Home</p>",
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

  test("editorConfiguration create requires site unless it is the system default", () => {
    expect(
      CreateRequestSchema.safeParse({
        asset: {
          editorConfiguration: {
            name: "Default",
            configuration: "{}",
          },
        },
      }).success,
    ).toBe(true);
    expect(
      CreateRequestSchema.safeParse({
        asset: {
          editorConfiguration: {
            name: "Site editor",
            configuration: "{}",
          },
        },
      }).success,
    ).toBe(false);
    expect(
      CreateRequestSchema.safeParse({
        asset: {
          editorConfiguration: {
            name: "Site editor",
            siteName: "www",
            configuration: "{}",
          },
        },
      }).success,
    ).toBe(true);
  });
});

describe("EditRequestSchema", () => {
  test("should accept a valid edit request using the asset envelope wrapper", () => {
    const res = EditRequestSchema.safeParse({
      asset: { page: { ...VALID_ASSET.page, id: "existing-id" } },
    });
    expect(res.success).toBe(true);
  });

  test("editorConfiguration edit requires site unless it is the system default", () => {
    expect(
      EditRequestSchema.safeParse({
        asset: {
          editorConfiguration: {
            id: "DEFAULT",
            name: "Default",
            configuration: "{}",
          },
        },
      }).success,
    ).toBe(true);
    expect(
      EditRequestSchema.safeParse({
        asset: {
          editorConfiguration: {
            id: "editor-1",
            name: "Site editor",
            configuration: "{}",
          },
        },
      }).success,
    ).toBe(false);
    expect(
      EditRequestSchema.safeParse({
        asset: {
          editorConfiguration: {
            id: "editor-1",
            name: "Site editor",
            siteId: "site-1",
            configuration: "{}",
          },
        },
      }).success,
    ).toBe(true);
  });
});

describe("RemoveRequestSchema", () => {
  test("should accept a valid remove request with just identifier", () => {
    const res = RemoveRequestSchema.safeParse({ identifier: ID_PAGE });
    expect(res.success).toBe(true);
  });

  test("should reject site removal requests", () => {
    const res = RemoveRequestSchema.safeParse({
      identifier: { id: "site-1", type: "site" },
    });
    expect(res.success).toBe(false);
  });

  test("should reject root folder path removal requests", () => {
    const res = RemoveRequestSchema.safeParse({
      identifier: {
        type: "folder",
        path: { path: "/", siteName: "my-site" },
      },
    });
    expect(res.success).toBe(false);
  });

  test("should reject root folder path removal requests with siteId", () => {
    const res = RemoveRequestSchema.safeParse({
      identifier: {
        type: "folder",
        path: { path: "/", siteId: "site-1" },
      },
    });
    expect(res.success).toBe(false);
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

  test("searchFields should match generated SearchFieldString values", () => {
    for (const field of stringUnionFromTypes("SearchFieldString")) {
      const res = SearchRequestSchema.safeParse({
        searchInformation: {
          searchTerms: "hello world",
          searchFields: [field],
        },
      });
      expect(res.success).toBe(true);
    }

    const invalid = SearchRequestSchema.safeParse({
      searchInformation: {
        searchTerms: "hello world",
        searchFields: ["content"],
      },
    });
    expect(invalid.success).toBe(false);
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
  test("should accept a valid edit access rights request", () => {
    const res = EditAccessRightsRequestSchema.safeParse({
      identifier: ID_PAGE,
      accessRightsInformation: { allLevel: "read", aclEntries: [] },
      applyToChildren: true,
    });
    expect(res.success).toBe(true);
  });

  test("ACL enum values should match generated unions", () => {
    for (const level of stringUnionFromTypes("AllLevel")) {
      expect(
        EditAccessRightsRequestSchema.safeParse({
          identifier: ID_PAGE,
          accessRightsInformation: { allLevel: level, aclEntries: [] },
        }).success,
      ).toBe(true);
    }

    for (const level of stringUnionFromTypes("AclEntryLevel")) {
      for (const type of stringUnionFromTypes("AclEntryType")) {
        expect(
          EditAccessRightsRequestSchema.safeParse({
            identifier: ID_PAGE,
            accessRightsInformation: {
              allLevel: "read",
              aclEntries: [{ level, type, id: "acl-1" }],
            },
          }).success,
        ).toBe(true);
      }
    }
  });

  test("should accept v2 ACL entries identified by id instead of name", () => {
    const res = EditAccessRightsRequestSchema.safeParse({
      identifier: ID_PAGE,
      accessRightsInformation: {
        allLevel: "read",
        aclEntries: [{ level: "write", type: "group", id: "group-1" }],
      },
    });
    expect(res.success).toBe(true);
  });

  test("should accept v2 ACL entries identified by name instead of id", () => {
    const res = EditAccessRightsRequestSchema.safeParse({
      identifier: ID_PAGE,
      accessRightsInformation: {
        allLevel: "read",
        aclEntries: [{ level: "read", type: "user", name: "alice" }],
      },
    });
    expect(res.success).toBe(true);
  });

  test("should reject access rights with unsupported allLevel", () => {
    const res = EditAccessRightsRequestSchema.safeParse({
      identifier: ID_PAGE,
      accessRightsInformation: { allLevel: "all", aclEntries: [] },
    });
    expect(res.success).toBe(false);
  });

  test("should reject access rights with malformed ACL entries", () => {
    const res = EditAccessRightsRequestSchema.safeParse({
      identifier: ID_PAGE,
      accessRightsInformation: {
        allLevel: "none",
        aclEntries: [{ level: "all", type: "role", name: "editors" }],
      },
    });
    expect(res.success).toBe(false);
  });

  test("should reject ACL entries without name or id", () => {
    const res = EditAccessRightsRequestSchema.safeParse({
      identifier: ID_PAGE,
      accessRightsInformation: {
        allLevel: "read",
        aclEntries: [{ level: "read", type: "user" }],
      },
    });
    expect(res.success).toBe(false);
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

  test("should reject archive/unarchive because generated markType is read or unread only", () => {
    expect(
      MarkMessageRequestSchema.safeParse({
        identifier: { id: "msg-1", type: "message" },
        markType: "archive",
      }).success,
    ).toBe(false);
    expect(
      MarkMessageRequestSchema.safeParse({
        identifier: { id: "msg-1", type: "message" },
        markType: "unarchive",
      }).success,
    ).toBe(false);
  });

  test("accepts cascade-cms-api MessageMarkType literals", () => {
    for (const markType of stringUnionFromTypes("MessageMarkType")) {
      expect(
        MarkMessageRequestSchema.safeParse({
          identifier: { id: "msg-1", type: "message" },
          markType,
        }).success,
      ).toBe(true);
    }
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
  test("should accept a valid read audits request with strict auditParameters", () => {
    const res = ReadAuditsRequestSchema.safeParse({
      auditParameters: {
        username: "alice",
        auditType: "publish",
      },
    });
    expect(res.success).toBe(true);
  });

  test("should reject unknown auditParameters fields", () => {
    const res = ReadAuditsRequestSchema.safeParse({
      auditParameters: {
        username: "alice",
        action: "login",
      },
    });
    expect(res.success).toBe(false);
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
  test("should accept a valid wrapped perform workflow transition request", () => {
    const res = PerformWorkflowTransitionRequestSchema.safeParse({
      workflowTransitionInformation: {
        workflowId: "wf-1",
        actionIdentifier: "approve",
        transitionComment: "Looks good",
      },
    });
    expect(res.success).toBe(true);
  });

  test("should accept v2 nullable workflow transition comment", () => {
    const res = PerformWorkflowTransitionRequestSchema.safeParse({
      workflowTransitionInformation: {
        workflowId: "wf-1",
        actionIdentifier: "approve",
        transitionComment: null,
      },
    });
    expect(res.success).toBe(true);
  });

  test("should reject the legacy flat workflow transition shape", () => {
    const res = PerformWorkflowTransitionRequestSchema.safeParse({
      workflowId: "wf-1",
      actionIdentifier: "approve",
      transitionComment: "Looks good",
    });
    expect(res.success).toBe(false);
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

  test("should accept an empty publish destinations array", () => {
    const res = PublishUnpublishRequestSchema.safeParse({
      identifier: ID_PAGE,
      publishInformation: {
        destinations: [],
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

  test("should accept only v2 nullable publish information fields", () => {
    const res = PublishUnpublishRequestSchema.safeParse({
      identifier: ID_PAGE,
      publishInformation: {
        unpublish: null,
        publishRelatedAssets: null,
        publishRelatedPublishSet: null,
        scheduledDate: null,
      },
    });
    expect(res.success).toBe(true);
    expect(
      PublishUnpublishRequestSchema.safeParse({
        identifier: ID_PAGE,
        publishInformation: {
          destinations: null,
        },
      }).success,
    ).toBe(false);
  });

  test("should reject preferences without generated required name and value strings", () => {
    expect(
      EditPreferenceRequestSchema.safeParse({
        preference: { name: "some.key" },
      }).success,
    ).toBe(false);
    expect(
      EditPreferenceRequestSchema.safeParse({
        preference: { name: "some.key", value: true },
      }).success,
    ).toBe(false);
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
      workflowTransitionInformation: {
        actionIdentifier: "approve",
      },
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

  test("ReadRequestSchema should reject removed response_format field", () => {
    const res = ReadRequestSchema.safeParse({
      identifier: ID_PAGE,
      response_format: "json",
    });
    expect(res.success).toBe(false);
  });

  test("PublishUnpublishRequestSchema should reject arbitrary fields on publishInformation", () => {
    const res = PublishUnpublishRequestSchema.safeParse({
      identifier: ID_PAGE,
      publishInformation: {
        unpublish: false,
        somethingArbitrary: "value",
        vendorExtension: { nested: true },
      },
    });
    expect(res.success).toBe(false);
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

describe("Generated request body schemas", () => {
  test("RemoveRequestSchema should validate deleteParameters fields", () => {
    expect(
      RemoveRequestSchema.safeParse({
        identifier: ID_PAGE,
        deleteParameters: {
          doWorkflow: false,
          unpublish: true,
          destinations: [{ id: "dest-1", type: "destination" }],
        },
      }).success,
    ).toBe(true);
    expect(
      RemoveRequestSchema.safeParse({
        identifier: ID_PAGE,
        deleteParameters: {
          doWorkflow: "false",
          destinations: "dest-1",
        },
      }).success,
    ).toBe(false);
  });

  test("RemoveRequestSchema should accept v2 nullable unpublish parameters", () => {
    expect(
      RemoveRequestSchema.safeParse({
        identifier: ID_PAGE,
        deleteParameters: {
          doWorkflow: false,
          unpublish: null,
          destinations: null,
        },
      }).success,
    ).toBe(true);
  });

  test("MoveRequestSchema should accept generated unpublish fields on moveParameters", () => {
    const res = MoveRequestSchema.safeParse({
      identifier: ID_PAGE,
      moveParameters: {
        destinationContainerIdentifier: { id: "parent-id", type: "folder" },
        doWorkflow: false,
        newName: "renamed",
        unpublish: true,
        destinations: [{ id: "dest-1", type: "destination" }],
      },
    });
    expect(res.success).toBe(true);
  });

  test("MoveRequestSchema should accept v2 nullable unpublish fields", () => {
    const res = MoveRequestSchema.safeParse({
      identifier: ID_PAGE,
      moveParameters: {
        destinationContainerIdentifier: { id: "parent-id", type: "folder" },
        doWorkflow: false,
        unpublish: null,
        destinations: null,
      },
    });
    expect(res.success).toBe(true);
  });

  test("EditWorkflowSettingsRequestSchema should validate workflow settings fields", () => {
    expect(
      EditWorkflowSettingsRequestSchema.safeParse({
        identifier: ID_PAGE,
        workflowSettings: {
          workflowDefinitions: [{ id: "wf-def-1", type: "workflowdefinition" }],
          inheritWorkflows: true,
          requireWorkflow: false,
          inheritedWorkflowDefinitions: [],
        },
      }).success,
    ).toBe(true);
    expect(
      EditWorkflowSettingsRequestSchema.safeParse({
        identifier: ID_PAGE,
        workflowSettings: {
          workflowDefinitions: "wf-def-1",
          inheritWorkflows: "true",
        },
      }).success,
    ).toBe(false);
  });

  test("ReadAuditsRequestSchema should validate auditParameters fields", () => {
    expect(
      ReadAuditsRequestSchema.safeParse({
        auditParameters: {
          identifier: ID_PAGE,
          username: "alice",
          auditType: "publish",
        },
      }).success,
    ).toBe(true);
    expect(
      ReadAuditsRequestSchema.safeParse({
        auditParameters: {
          auditType: "not-real",
          startDate: 123,
        },
      }).success,
    ).toBe(false);
  });

  test("ReadAuditsRequestSchema accepts cascade-cms-api AuditTypes literals", () => {
    for (const auditType of stringUnionFromTypes("AuditTypes")) {
      expect(
        ReadAuditsRequestSchema.safeParse({
          auditParameters: { auditType },
        }).success,
      ).toBe(true);
    }

    expect(
      ReadAuditsRequestSchema.safeParse({
        auditParameters: { auditType: "archive" },
      }).success,
    ).toBe(false);
  });

  test("workflowConfiguration should validate generated required fields when supplied", () => {
    const validWorkflowConfiguration = {
      workflowName: "Review",
      workflowDefinitionId: "workflow-definition-1",
      workflowComments: "Route for approval",
      workflowStepConfigurations: [
        {
          stepIdentifier: "review",
          stepAssignment: "editors",
        },
      ],
    };
    expect(
      RemoveRequestSchema.safeParse({
        identifier: ID_PAGE,
        workflowConfiguration: validWorkflowConfiguration,
      }).success,
    ).toBe(true);
    expect(
      RemoveRequestSchema.safeParse({
        identifier: ID_PAGE,
        workflowConfiguration: {
          workflowName: "Review",
          workflowDefinitionPath: "/workflows/review",
          workflowComments: "Route for approval",
        },
      }).success,
    ).toBe(true);
    expect(
      RemoveRequestSchema.safeParse({
        identifier: ID_PAGE,
        workflowConfiguration: {
          workflowName: "Review",
          workflowComments: "Definition id/path omitted",
        },
      }).success,
    ).toBe(false);
    expect(
      RemoveRequestSchema.safeParse({
        identifier: ID_PAGE,
        workflowConfiguration: {
          workflowName: "Review",
          workflowDefinitionId: "workflow-definition-1",
          workflowDefinitionPath: "/workflows/review",
          workflowComments: "Route for approval",
        },
      }).success,
    ).toBe(true);
    expect(
      RemoveRequestSchema.safeParse({
        identifier: ID_PAGE,
        workflowConfiguration: {
          workflowDefinitionId: "workflow-definition-1",
          workflowComments: "Missing workflow name",
        },
      }).success,
    ).toBe(false);
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

  test("list scalar artifacts accepts artifact filters and requires asset_handle", () => {
    const res = AssetListScalarArtifactsRequestSchema.safeParse({
      asset_handle: HANDLE,
      artifact_kind: "href",
      pointer_prefix: "/asset/page",
      key: "xhtml",
      key_contains: "html",
      value_contains: "example.edu",
      cursor: "af_eyJ2IjoxLCJvIjoyLCJoIjoiYWJjIn0",
      limit: 25,
    });
    expect(res.success).toBe(true);
    expect(
      AssetListScalarArtifactsRequestSchema.safeParse({
        artifact_kind: "href",
      }).success,
    ).toBe(false);
    expect(
      AssetListScalarArtifactsRequestSchema.safeParse({
        asset_handle: HANDLE,
        artifact_kind: "onclick",
      }).success,
    ).toBe(false);
  });

  test("scalar artifact schemas describe href versus site_link selection", () => {
    expect((AssetListScalarArtifactsRequestSchema.shape as any).artifact_kind.description).toContain(
      "Use href for any value found in an HTML/XHTML href attribute",
    );
    expect((AssetListScalarArtifactsRequestSchema.shape as any).artifact_kind.description).toContain(
      "Use site_link for non-root, non-URL Cascade *Path fields",
    );
    expect((DraftListScalarArtifactsRequestSchema.shape as any).artifact_kind.description).toContain(
      "Use href for any value found in an HTML/XHTML href attribute",
    );
    expect((DraftListScalarArtifactsRequestSchema.shape as any).artifact_kind.description).toContain(
      "Use site_link for non-root, non-URL Cascade *Path fields",
    );
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

  test("semantic asset schemas accept selectors and assertions", () => {
    expect(
      AssetResolveNodesRequestSchema.safeParse({
        asset_handle: HANDLE,
        selector: {
          node_type: "group",
          identifier: "card",
          where_child: {
            node_type: "text",
            identifier: "title",
            text_equals: "Beta",
          },
        },
      }).success,
    ).toBe(true);

    expect(
      AssetAssertValuesRequestSchema.safeParse({
        asset_handle: HANDLE,
        assertions: [
          {
            match: { node_type: "asset", identifier: "profile", field_equals: { pagePath: "people/jane" } },
            target: { field: "pagePath" },
            comparison: "equals",
            expected: "people/jane",
          },
        ],
      }).success,
    ).toBe(true);
  });

  test("should reject malformed publish information fields", () => {
    const res = PublishUnpublishRequestSchema.safeParse({
      identifier: ID_PAGE,
      publishInformation: {
        unpublish: "true",
        destinations: "dest-1",
        unexpected: true,
      },
    });
    expect(res.success).toBe(false);
  });
});

describe("draft workflow request schemas", () => {
  const ASSET_HANDLE = "a_00000000-0000-0000-0000-000000000000";
  const DRAFT_HANDLE = "d_00000000-0000-0000-0000-000000000000";
  const RAW_HASH = "0".repeat(64);

  test("open accepts edit from asset_handle with raw hash", () => {
    const res = DraftOpenRequestSchema.safeParse({
      operation: "edit",
      asset_handle: ASSET_HANDLE,
      expected_raw_hash: RAW_HASH,
    });

    expect(res.success).toBe(true);
  });

  test("open accepts create from an asset envelope", () => {
    const res = DraftOpenRequestSchema.safeParse({
      operation: "create",
      asset: VALID_ASSET,
    });

    expect(res.success).toBe(true);
  });

  test("open accepts create without an initial asset envelope", () => {
    const res = DraftOpenRequestSchema.safeParse({
      operation: "create",
    });

    expect(res.success).toBe(true);
  });

  test("open rejects edit without expected_raw_hash", () => {
    const res = DraftOpenRequestSchema.safeParse({
      operation: "edit",
      asset_handle: ASSET_HANDLE,
    });

    expect(res.success).toBe(false);
  });

  test("open rejects edit when create asset is also provided", () => {
    const res = DraftOpenRequestSchema.safeParse({
      operation: "edit",
      asset_handle: ASSET_HANDLE,
      expected_raw_hash: RAW_HASH,
      asset: VALID_ASSET,
    });

    expect(res.success).toBe(false);
  });

  test("open rejects create with edit-only fields", () => {
    const res = DraftOpenRequestSchema.safeParse({
      operation: "create",
      asset_handle: ASSET_HANDLE,
      expected_raw_hash: RAW_HASH,
    });

    expect(res.success).toBe(false);
  });

  test("scaffold create accepts asset type options", () => {
    const res = DraftScaffoldCreateRequestSchema.safeParse({
      asset_type: "page",
      relationship_style: "id",
      role_type: "site",
    });

    expect(res.success).toBe(true);
  });

  test("scaffold from asset requires a source handle and raw hash", () => {
    expect(
      DraftScaffoldFromAssetRequestSchema.safeParse({
        asset_handle: ASSET_HANDLE,
        expected_raw_hash: RAW_HASH,
        clear_values: true,
        preserve_definition: true,
      }).success,
    ).toBe(true);
    expect(
      DraftScaffoldFromAssetRequestSchema.safeParse({
        asset_handle: ASSET_HANDLE,
      }).success,
    ).toBe(false);
  });

  test("set file data requires exactly one byte source", () => {
    expect(
      DraftSetFileDataRequestSchema.safeParse({
        draft_handle: DRAFT_HANDLE,
        expected_revision: 1,
        input_path: "C:\\tmp\\hero.jpg",
      }).success,
    ).toBe(true);
    expect(
      DraftSetFileDataRequestSchema.safeParse({
        draft_handle: DRAFT_HANDLE,
        expected_revision: 1,
        base64_data: "/9j/4Q==",
        expected_sha256: "0".repeat(64),
      }).success,
    ).toBe(true);
    expect(
      DraftSetFileDataRequestSchema.safeParse({
        draft_handle: DRAFT_HANDLE,
        expected_revision: 1,
      }).success,
    ).toBe(false);
    expect(
      DraftSetFileDataRequestSchema.safeParse({
        draft_handle: DRAFT_HANDLE,
        expected_revision: 1,
        input_path: "C:\\tmp\\hero.jpg",
        base64_data: "/9j/4Q==",
      }).success,
    ).toBe(false);
  });

  test("draft value and submit schemas use draft_handle and snake_case revision fields", () => {
    expect(
      DraftGetValueRequestSchema.safeParse({
        draft_handle: DRAFT_HANDLE,
        pointer: "/asset/page/name",
        offset: 0,
        length: 10,
      }).success,
    ).toBe(true);
    expect(
      DraftSubmitRequestSchema.safeParse({
        draft_handle: DRAFT_HANDLE,
        expected_revision: 2,
        discard_on_success: true,
      }).success,
    ).toBe(true);
    expect(
      DraftSubmitRequestSchema.safeParse({
        draft_handle: DRAFT_HANDLE,
      }).success,
    ).toBe(false);
  });

  test("apply patch accepts JSON Pointer add, replace, and remove operations", () => {
    const res = DraftApplyPatchRequestSchema.safeParse({
      draft_handle: DRAFT_HANDLE,
      expected_revision: 1,
      operations: [
        { op: "add", path: "/asset/page/metadata", value: {} },
        { op: "replace", path: "/asset/page/name", value: "next" },
        { op: "remove", path: "/asset/page/metadata/title" },
      ],
    });

    expect(res.success).toBe(true);
  });

  test("apply patch rejects root JSON Pointer operations", () => {
    const res = DraftApplyPatchRequestSchema.safeParse({
      draft_handle: DRAFT_HANDLE,
      expected_revision: 1,
      operations: [{ op: "replace", path: "", value: { asset: {} } }],
    });

    expect(res.success).toBe(false);
  });

  test("apply patch rejects missing values, unsafe JSON Pointer segments, and excessive operations", () => {
    expect(
      DraftApplyPatchRequestSchema.safeParse({
        draft_handle: DRAFT_HANDLE,
        expected_revision: 1,
        operations: [
          { op: "add", path: "/asset/page/title" },
        ],
      }).success,
    ).toBe(false);
    expect(
      DraftApplyPatchRequestSchema.safeParse({
        draft_handle: DRAFT_HANDLE,
        expected_revision: 1,
        operations: [
          { op: "replace", path: "/asset/page/title", value: null },
        ],
      }).success,
    ).toBe(true);
    expect(
      DraftApplyPatchRequestSchema.safeParse({
        draft_handle: DRAFT_HANDLE,
        expected_revision: 1,
        operations: [
          { op: "add", path: "/asset/page/__proto__/polluted", value: true },
        ],
      }).success,
    ).toBe(false);
    expect(
      DraftApplyPatchRequestSchema.safeParse({
        draft_handle: DRAFT_HANDLE,
        expected_revision: 1,
        operations: Array.from({ length: ASSET_DRAFT_PATCH_MAX_OPERATIONS + 1 }, () => ({
          op: "replace",
          path: "/asset/page/name",
          value: "next",
        })),
      }).success,
    ).toBe(false);
  });

  test("semantic draft schemas accept resolve, replace, insert, remove, move, and assertions", () => {
    const match = {
      node_type: "group",
      identifier: "card",
      where_child: { node_type: "text", identifier: "title", text_equals: "Beta" },
    };

    expect(
      DraftResolveNodesRequestSchema.safeParse({
        draft_handle: DRAFT_HANDLE,
        selector: match,
      }).success,
    ).toBe(true);

    expect(
      DraftApplySemanticPatchRequestSchema.safeParse({
        draft_handle: DRAFT_HANDLE,
        expected_revision: 1,
        match,
        target: { child: { node_type: "text", identifier: "description" }, field: "text" },
        op: "replace",
        value: "Updated",
      }).success,
    ).toBe(true);

    expect(
      DraftApplySemanticPatchRequestSchema.safeParse({
        draft_handle: DRAFT_HANDLE,
        expected_revision: 1,
        match,
        op: "insert_node",
        position: "after",
        node: { type: "text", identifier: "caption", text: "Inserted" },
      }).success,
    ).toBe(true);

    expect(
      DraftApplySemanticPatchRequestSchema.safeParse({
        draft_handle: DRAFT_HANDLE,
        expected_revision: 1,
        match,
        op: "remove_node",
      }).success,
    ).toBe(true);

    expect(
      DraftApplySemanticPatchRequestSchema.safeParse({
        draft_handle: DRAFT_HANDLE,
        expected_revision: 1,
        match,
        op: "move_node",
        destination: {
          match: { node_type: "group", identifier: "card", where_child: { node_type: "text", identifier: "title", text_equals: "Alpha" } },
          position: "before",
        },
      }).success,
    ).toBe(true);

    expect(
      DraftAssertValuesRequestSchema.safeParse({
        draft_handle: DRAFT_HANDLE,
        assertions: [{ match, target: { child: { node_type: "text", identifier: "description" }, field: "text" }, comparison: "contains", expected: "Updated" }],
      }).success,
    ).toBe(true);
  });

  test("semantic schemas reject unsafe pointers and incomplete operation-specific inputs", () => {
    expect(
      DraftResolveNodesRequestSchema.safeParse({
        draft_handle: DRAFT_HANDLE,
        selector: { scope_pointer: "/asset/__proto__", node_type: "group" },
      }).success,
    ).toBe(false);
    expect(
      DraftResolveNodesRequestSchema.safeParse({
        draft_handle: DRAFT_HANDLE,
        selector: { node_type: "group", field_equals: { constructor: "x" } },
      }).success,
    ).toBe(false);
    expect(
      DraftResolveNodesRequestSchema.safeParse({
        draft_handle: DRAFT_HANDLE,
        selector: {
          node_type: "group",
          field_contains: JSON.parse('{ "__proto__": "x" }'),
        },
      }).success,
    ).toBe(false);
    expect(
      DraftApplySemanticPatchRequestSchema.safeParse({
        draft_handle: DRAFT_HANDLE,
        expected_revision: 1,
        match: { node_type: "group", identifier: "card" },
        op: "replace",
        value: "missing target",
      }).success,
    ).toBe(false);
    expect(
      DraftApplySemanticPatchRequestSchema.safeParse({
        draft_handle: DRAFT_HANDLE,
        expected_revision: 1,
        match: { node_type: "group", identifier: "card" },
        op: "insert_node",
        position: "after",
      }).success,
    ).toBe(false);
    expect(
      DraftApplySemanticPatchRequestSchema.safeParse({
        draft_handle: DRAFT_HANDLE,
        expected_revision: 1,
        match: { node_type: "group", identifier: "card" },
        op: "remove_node",
        target: { field: "text" },
      }).success,
    ).toBe(false);
    expect(
      DraftApplySemanticPatchRequestSchema.safeParse({
        draft_handle: DRAFT_HANDLE,
        expected_revision: 1,
        match: { node_type: "group", identifier: "card" },
        target: { field: "text" },
        op: "remove",
        value: "ignored",
      }).success,
    ).toBe(false);
  });

  test("mutation plan schema accepts whitelisted sequential steps", () => {
    expect(
      DraftMutationPlanExecuteRequestSchema.safeParse({
        steps: [
          {
            name: "open",
            tool: "cascade_draft_open",
            input: {
              operation: "edit",
              asset_handle: ASSET_HANDLE,
              expected_raw_hash: RAW_HASH,
            },
            save_as: "draft",
          },
          {
            name: "validate",
            tool: "cascade_draft_validate",
            input: { draft_ref: "draft" },
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      DraftMutationPlanExecuteRequestSchema.safeParse({
        steps: [{ tool: "cascade_remove", input: {} }],
      }).success,
    ).toBe(false);
  });
});
