import {
  ASSET_ENVELOPE_KEYS,
  type AssetEnvelopeKey,
} from "./schemas/assets.js";

export type CreateScaffoldRelationshipStyle = "path" | "id";
export type CreateScaffoldRoleType = "global" | "site";

export interface CreateScaffoldOptions {
  assetType: AssetEnvelopeKey;
  relationshipStyle?: CreateScaffoldRelationshipStyle;
  roleType?: CreateScaffoldRoleType;
}

export interface CreateScaffoldRelationshipGroup {
  purpose: string;
  selected: string;
  alternatives: string[];
}

export interface CreateScaffold {
  asset: Record<AssetEnvelopeKey, Record<string, unknown>>;
  required_value_pointers: string[];
  relationship_groups: CreateScaffoldRelationshipGroup[];
  notes: string[];
}

export interface CreateScaffoldFromAssetOptions {
  clearValues?: boolean;
  preserveDefinition?: boolean;
}

export interface CreateScaffoldFromAsset {
  asset: Record<AssetEnvelopeKey, Record<string, unknown>>;
  cleared_value_pointers: string[];
  replace_value_pointers: string[];
  add_value_pointers: string[];
}

type ScaffoldBody = Record<string, unknown>;
type ScaffoldBuilder = (
  options: Required<CreateScaffoldOptions>,
) => ScaffoldBody;

const REQUIRED_VALUE = null;

const folderRelationshipGroups: CreateScaffoldRelationshipGroup[] = [
  {
    purpose: "Parent folder",
    selected: "parentFolderPath",
    alternatives: ["parentFolderId", "parentFolderPath"],
  },
  {
    purpose: "Owning site",
    selected: "siteName",
    alternatives: ["siteId", "siteName"],
  },
];

const containerRelationshipGroups: CreateScaffoldRelationshipGroup[] = [
  {
    purpose: "Parent container",
    selected: "parentContainerPath",
    alternatives: ["parentContainerId", "parentContainerPath"],
  },
  {
    purpose: "Owning site",
    selected: "siteName",
    alternatives: ["siteId", "siteName"],
  },
];

const scaffoldBuilders: Record<AssetEnvelopeKey, ScaffoldBuilder> = {
  feedBlock: (options) => ({
    ...folderContainedBase(options),
    feedURL: REQUIRED_VALUE,
  }),
  indexBlock: (options) => ({
    ...folderContainedBase(options),
    maxRenderedAssets: REQUIRED_VALUE,
    depthOfIndex: REQUIRED_VALUE,
  }),
  textBlock: (options) => ({
    ...folderContainedBase(options),
    text: REQUIRED_VALUE,
  }),
  xhtmlDataDefinitionBlock: (options) => ({
    ...folderContainedBase(options),
    xhtml: REQUIRED_VALUE,
  }),
  xmlBlock: (options) => ({
    ...folderContainedBase(options),
    xml: REQUIRED_VALUE,
  }),
  twitterFeedBlock: (options) => ({
    ...folderContainedBase(options),
    maxResults: REQUIRED_VALUE,
    useDefaultStyle: REQUIRED_VALUE,
    excludeJQuery: REQUIRED_VALUE,
    queryType: REQUIRED_VALUE,
  }),
  file: (options) => ({
    ...folderContainedBase(options),
    text: REQUIRED_VALUE,
  }),
  folder: folderContainedBase,
  page: (options) => ({
    ...folderContainedBase(options),
    ...relationship(
      options,
      "contentType",
      "contentTypeId",
      "contentTypePath",
    ),
    xhtml: REQUIRED_VALUE,
  }),
  reference: (options) => ({
    ...folderContainedBase(options),
    ...relationship(
      options,
      "referenced asset",
      "referencedAssetId",
      "referencedAssetPath",
    ),
    referencedAssetType: REQUIRED_VALUE,
  }),
  xsltFormat: (options) => ({
    ...folderContainedBase(options),
    xml: REQUIRED_VALUE,
  }),
  scriptFormat: (options) => ({
    ...folderContainedBase(options),
    script: REQUIRED_VALUE,
  }),
  symlink: folderContainedBase,
  template: (options) => ({
    ...folderContainedBase(options),
    xml: REQUIRED_VALUE,
  }),
  user: () => ({
    username: REQUIRED_VALUE,
    fullName: REQUIRED_VALUE,
    email: REQUIRED_VALUE,
    authType: REQUIRED_VALUE,
    password: REQUIRED_VALUE,
    groups: REQUIRED_VALUE,
    roles: REQUIRED_VALUE,
  }),
  group: () => ({
    groupName: REQUIRED_VALUE,
    role: REQUIRED_VALUE,
  }),
  role: (options) => ({
    name: REQUIRED_VALUE,
    roleType: options.roleType,
    ...(options.roleType === "site"
      ? { siteAbilities: {} }
      : { globalAbilities: {} }),
  }),
  assetFactory: (options) => ({
    ...containeredBase(options),
    assetType: REQUIRED_VALUE,
    workflowMode: REQUIRED_VALUE,
  }),
  assetFactoryContainer: containeredBase,
  contentType: (options) => ({
    ...containeredBase(options),
    ...relationship(
      options,
      "page configuration set",
      "pageConfigurationSetId",
      "pageConfigurationSetPath",
    ),
    ...relationship(options, "metadata set", "metadataSetId", "metadataSetPath"),
  }),
  contentTypeContainer: containeredBase,
  connectorContainer: containeredBase,
  facebookConnector: (options) => ({
    ...containeredBase(options),
    ...relationship(options, "destination", "destinationId", "destinationPath"),
  }),
  wordPressConnector: (options) => ({
    ...containeredBase(options),
    connectorContentTypeLinks: [
      relationship(options, "content type", "contentTypeId", "contentTypePath"),
    ],
  }),
  googleAnalyticsConnector: containeredBase,
  pageConfigurationSet: (options) => ({
    ...containeredBase(options),
    pageConfigurations: [
      {
        name: REQUIRED_VALUE,
        defaultConfiguration: REQUIRED_VALUE,
        ...relationship(options, "template", "templateId", "templatePath"),
      },
    ],
  }),
  pageConfigurationSetContainer: containeredBase,
  dataDefinition: (options) => ({
    ...containeredBase(options),
    xml: REQUIRED_VALUE,
  }),
  dataDefinitionContainer: containeredBase,
  sharedField: (options) => ({
    ...containeredBase(options),
    xml: REQUIRED_VALUE,
  }),
  sharedFieldContainer: containeredBase,
  metadataSet: containeredBase,
  metadataSetContainer: containeredBase,
  publishSet: containeredBase,
  publishSetContainer: containeredBase,
  siteDestinationContainer: containeredBase,
  destination: (options) => ({
    name: REQUIRED_VALUE,
    ...relationship(
      options,
      "parent container",
      "parentContainerId",
      "parentContainerPath",
    ),
    ...relationship(options, "transport", "transportId", "transportPath"),
    ...siteRelationship(options),
  }),
  fileSystemTransport: (options) => ({
    ...containeredBase(options),
    directory: REQUIRED_VALUE,
  }),
  ftpTransport: (options) => ({
    ...containeredBase(options),
    hostName: REQUIRED_VALUE,
    port: REQUIRED_VALUE,
    username: REQUIRED_VALUE,
    ftpProtocolType: REQUIRED_VALUE,
  }),
  databaseTransport: (options) => ({
    ...containeredBase(options),
    transportSiteId: REQUIRED_VALUE,
    serverName: REQUIRED_VALUE,
    serverPort: REQUIRED_VALUE,
    databaseName: REQUIRED_VALUE,
    username: REQUIRED_VALUE,
  }),
  cloudTransport: (options) => ({
    ...containeredBase(options),
    key: REQUIRED_VALUE,
    secret: REQUIRED_VALUE,
    bucketName: REQUIRED_VALUE,
  }),
  transportContainer: containeredBase,
  workflowDefinition: (options) => ({
    ...containeredBase(options),
    namingBehavior: REQUIRED_VALUE,
    xml: REQUIRED_VALUE,
  }),
  workflowDefinitionContainer: containeredBase,
  workflowEmail: (options) => ({
    ...containeredBase(options),
    subject: REQUIRED_VALUE,
    body: REQUIRED_VALUE,
  }),
  workflowEmailContainer: containeredBase,
  site: () => ({
    name: REQUIRED_VALUE,
    url: REQUIRED_VALUE,
    recycleBinExpiration: REQUIRED_VALUE,
    unpublishOnExpiration: REQUIRED_VALUE,
    linkCheckerEnabled: REQUIRED_VALUE,
    externalLinkCheckOnPublish: REQUIRED_VALUE,
    inheritDataChecksEnabled: REQUIRED_VALUE,
    spellCheckEnabled: REQUIRED_VALUE,
    linkCheckEnabled: REQUIRED_VALUE,
    accessibilityCheckEnabled: REQUIRED_VALUE,
    inheritNamingRules: REQUIRED_VALUE,
  }),
  editorConfiguration: (options) => ({
    name: REQUIRED_VALUE,
    ...siteRelationship(options),
    configuration: REQUIRED_VALUE,
  }),
};

export function buildCreateAssetScaffold(
  input: CreateScaffoldOptions,
): CreateScaffold {
  assertAssetType(input.assetType);
  const options: Required<CreateScaffoldOptions> = {
    assetType: input.assetType,
    relationshipStyle: input.relationshipStyle ?? "path",
    roleType: input.roleType ?? "global",
  };
  const body = scaffoldBuilders[options.assetType](options);
  const asset = {
    [options.assetType]: body,
  } as Record<AssetEnvelopeKey, Record<string, unknown>>;

  return {
    asset,
    required_value_pointers: collectRequiredValuePointers({ asset }),
    relationship_groups: relationshipGroupsFor(options.assetType, body),
    notes: notesFor(options.assetType),
  };
}

export function buildCreateAssetScaffoldFromAsset(
  source: Record<string, unknown>,
  options: CreateScaffoldFromAssetOptions = {},
): CreateScaffoldFromAsset {
  const assetType = ASSET_ENVELOPE_KEYS.find(
    (key) => isRecord(source[key]),
  );
  if (!assetType) {
    throw new Error("Source asset must contain one Cascade asset envelope key.");
  }

  const asset = cloneJson(source) as Record<
    AssetEnvelopeKey,
    Record<string, unknown>
  >;
  const body = asset[assetType];
  stripReadOnlyAssetFields(body);

  const clearedValuePointers: string[] = [];
  const replaceValuePointers: string[] = [];
  const addValuePointers: string[] = [];
  clearCredentialFields(
    assetType,
    body,
    `/asset/${escapePointerSegment(assetType)}`,
    clearedValuePointers,
    replaceValuePointers,
    addValuePointers,
  );
  const structuredData = body.structuredData;
  if (isRecord(structuredData)) {
    if (options.preserveDefinition === false) {
      delete structuredData.definitionId;
      delete structuredData.definitionPath;
    }
    if (options.clearValues !== false) {
      clearStructuredDataValues(
        structuredData.structuredDataNodes,
        `/asset/${escapePointerSegment(assetType)}/structuredData/structuredDataNodes`,
        clearedValuePointers,
        replaceValuePointers,
        addValuePointers,
      );
    }
  }

  return {
    asset,
    cleared_value_pointers: clearedValuePointers,
    replace_value_pointers: replaceValuePointers,
    add_value_pointers: addValuePointers,
  };
}

function isAssetEnvelopeKey(value: string): value is AssetEnvelopeKey {
  return (ASSET_ENVELOPE_KEYS as readonly string[]).includes(value);
}

function assertAssetType(value: string): asserts value is AssetEnvelopeKey {
  if (!isAssetEnvelopeKey(value)) {
    throw new Error(`Unsupported asset_type ${value}.`);
  }
}

function folderContainedBase(
  options: Required<CreateScaffoldOptions>,
): ScaffoldBody {
  return {
    name: REQUIRED_VALUE,
    ...relationship(
      options,
      "parent folder",
      "parentFolderId",
      "parentFolderPath",
    ),
    ...siteRelationship(options),
  };
}

function containeredBase(options: Required<CreateScaffoldOptions>): ScaffoldBody {
  return {
    name: REQUIRED_VALUE,
    ...relationship(
      options,
      "parent container",
      "parentContainerId",
      "parentContainerPath",
    ),
    ...siteRelationship(options),
  };
}

function siteRelationship(options: Required<CreateScaffoldOptions>): ScaffoldBody {
  return relationship(options, "owning site", "siteId", "siteName");
}

function relationship(
  options: Required<CreateScaffoldOptions>,
  _purpose: string,
  idField: string,
  pathField: string,
): ScaffoldBody {
  return {
    [options.relationshipStyle === "id" ? idField : pathField]: REQUIRED_VALUE,
  };
}

function relationshipGroupsFor(
  assetType: AssetEnvelopeKey,
  body: ScaffoldBody,
): CreateScaffoldRelationshipGroup[] {
  const groups: CreateScaffoldRelationshipGroup[] = [];
  for (const group of relationshipGroupTemplatesFor(assetType)) {
    const selected = group.alternatives.find((field) =>
      Object.hasOwn(body, field),
    );
    if (selected) groups.push({ ...group, selected });
  }
  return groups;
}

function relationshipGroupTemplatesFor(
  assetType: AssetEnvelopeKey,
): CreateScaffoldRelationshipGroup[] {
  if (folderContainedAssetTypes.has(assetType)) return folderRelationshipGroups;
  if (containeredAssetTypes.has(assetType)) return containerRelationshipGroups;
  if (assetType === "destination") {
    return [
      {
        purpose: "Parent container",
        selected: "parentContainerPath",
        alternatives: ["parentContainerId", "parentContainerPath"],
      },
      {
        purpose: "Transport",
        selected: "transportPath",
        alternatives: ["transportId", "transportPath"],
      },
      {
        purpose: "Owning site",
        selected: "siteName",
        alternatives: ["siteId", "siteName"],
      },
    ];
  }
  if (assetType === "editorConfiguration") {
    return [
      {
        purpose: "Owning site",
        selected: "siteName",
        alternatives: ["siteId", "siteName"],
      },
    ];
  }
  return [];
}

function collectRequiredValuePointers(value: unknown): string[] {
  const pointers: string[] = [];
  visit(value, "");
  return pointers;

  function visit(current: unknown, pointer: string): void {
    if (current === REQUIRED_VALUE) {
      pointers.push(pointer);
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${pointer}/${index}`));
      return;
    }
    if (isRecord(current)) {
      for (const [key, child] of Object.entries(current)) {
        visit(child, `${pointer}/${escapePointerSegment(key)}`);
      }
    }
  }
}

function notesFor(assetType: AssetEnvelopeKey): string[] {
  switch (assetType) {
    case "page":
      return [
        "Use structuredData instead of xhtml when creating a data-definition page.",
      ];
    case "file":
      return ["Use data for file bytes; keep text only when the file type needs text content."];
    case "xhtmlDataDefinitionBlock":
      return [
        "Use structuredData instead of xhtml when creating a data-definition block.",
      ];
    case "twitterFeedBlock":
      return [
        "If queryType is user-only or users-and-mentions, replace searchString with accountName.",
      ];
    case "ftpTransport":
      return [
        "For SFTP with PUBLIC_KEY auth, replace password with authMode and privateKey as needed.",
      ];
    case "editorConfiguration":
      return [
        "Remove the site placeholder only when creating the system default editor configuration.",
      ];
    case "pageConfigurationSet":
      return [
        "The pageConfigurations array is scaffolded with one required item.",
      ];
    case "wordPressConnector":
      return [
        "The connectorContentTypeLinks array is scaffolded with one required item.",
      ];
    default:
      return [];
  }
}

function stripReadOnlyAssetFields(body: Record<string, unknown>): void {
  for (const field of READ_ONLY_CREATE_FIELDS) {
    delete body[field];
  }
  stripNestedReadOnlyIds(body);
  stripReadOnlyRelationshipFlags(body);
}

const READ_ONLY_CREATE_FIELDS = [
  "id",
  "type",
  "path",
  "lastModifiedDate",
  "lastModifiedBy",
  "createdDate",
  "createdBy",
  "lastPublishedDate",
  "lastPublishedBy",
  "expirationFolderRecycled",
  "rootFolderId",
  "rootAssetFactoryContainerId",
  "rootPageConfigurationSetContainerId",
  "rootContentTypeContainerId",
  "rootConnectorContainerId",
  "rootDataDefinitionContainerId",
  "rootSharedFieldContainerId",
  "rootMetadataSetContainerId",
  "rootPublishSetContainerId",
  "rootSiteDestinationContainerId",
  "rootTransportContainerId",
  "rootWorkflowDefinitionContainerId",
  "rootWorkflowEmailContainerId",
] as const;

function stripReadOnlyRelationshipFlags(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(stripReadOnlyRelationshipFlags);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "recycled" || key.endsWith("Recycled")) {
      delete value[key];
      continue;
    }
    stripReadOnlyRelationshipFlags(child);
  }
}

function stripNestedReadOnlyIds(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(stripNestedReadOnlyIds);
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    if (key === "pageConfigurations" || key === "pageRegions") {
      stripIdFromArrayItems(child);
    }
    stripNestedReadOnlyIds(child);
  }
}

function stripIdFromArrayItems(value: unknown): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (isRecord(item)) delete item.id;
  }
}

const credentialFieldRules: Partial<
  Record<AssetEnvelopeKey, { fields: readonly string[]; required: readonly string[] }>
> = {
  user: { fields: ["password"], required: ["password"] },
  facebookConnector: { fields: ["auth1", "auth2"], required: [] },
  wordPressConnector: { fields: ["auth1", "auth2"], required: [] },
  googleAnalyticsConnector: { fields: ["auth1", "auth2"], required: [] },
  ftpTransport: { fields: ["password", "privateKey"], required: [] },
  databaseTransport: { fields: ["password"], required: [] },
  cloudTransport: { fields: ["key", "secret"], required: ["key", "secret"] },
};

function clearCredentialFields(
  assetType: AssetEnvelopeKey,
  body: Record<string, unknown>,
  pointer: string,
  clearedValuePointers: string[],
  replaceValuePointers: string[],
  addValuePointers: string[],
): void {
  const rule = credentialFieldRules[assetType];
  if (!rule) return;

  for (const field of rule.fields) {
    const fieldPointer = `${pointer}/${escapePointerSegment(field)}`;
    if (Object.hasOwn(body, field)) {
      body[field] = REQUIRED_VALUE;
      clearedValuePointers.push(fieldPointer);
      replaceValuePointers.push(fieldPointer);
    } else if (rule.required.includes(field)) {
      body[field] = REQUIRED_VALUE;
      addValuePointers.push(fieldPointer);
    }
  }
}

function clearStructuredDataValues(
  value: unknown,
  pointer: string,
  clearedValuePointers: string[],
  replaceValuePointers: string[],
  addValuePointers: string[],
): void {
  if (!Array.isArray(value)) return;

  value.forEach((item, index) => {
    if (!isRecord(item)) return;
    const nodePointer = `${pointer}/${index}`;
    if (item.type === "text" && item.text !== undefined) {
      item.text = "";
      clearedValuePointers.push(`${nodePointer}/text`);
      replaceValuePointers.push(`${nodePointer}/text`);
    }
    if (item.type === "asset") {
      clearStructuredAssetReference(
        item,
        nodePointer,
        clearedValuePointers,
        addValuePointers,
      );
    }
    clearStructuredDataValues(
      item.structuredDataNodes,
      `${nodePointer}/structuredDataNodes`,
      clearedValuePointers,
      replaceValuePointers,
      addValuePointers,
    );
  });
}

function clearStructuredAssetReference(
  node: Record<string, unknown>,
  pointer: string,
  clearedValuePointers: string[],
  addValuePointers: string[],
): void {
  for (const field of [
    "blockId",
    "blockPath",
    "fileId",
    "filePath",
    "pageId",
    "pagePath",
    "symlinkId",
    "symlinkPath",
    "recycled",
  ]) {
    if (node[field] === undefined) continue;
    delete node[field];
    clearedValuePointers.push(`${pointer}/${field}`);
    if (field !== "recycled") {
      addValuePointers.push(`${pointer}/${field}`);
    }
  }
}

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function escapePointerSegment(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const folderContainedAssetTypes = new Set<AssetEnvelopeKey>([
  "feedBlock",
  "indexBlock",
  "textBlock",
  "xhtmlDataDefinitionBlock",
  "xmlBlock",
  "twitterFeedBlock",
  "file",
  "folder",
  "page",
  "reference",
  "xsltFormat",
  "scriptFormat",
  "symlink",
  "template",
]);

const containeredAssetTypes = new Set<AssetEnvelopeKey>([
  "assetFactory",
  "assetFactoryContainer",
  "contentType",
  "contentTypeContainer",
  "connectorContainer",
  "facebookConnector",
  "wordPressConnector",
  "googleAnalyticsConnector",
  "pageConfigurationSet",
  "pageConfigurationSetContainer",
  "dataDefinition",
  "dataDefinitionContainer",
  "sharedField",
  "sharedFieldContainer",
  "metadataSet",
  "metadataSetContainer",
  "publishSet",
  "publishSetContainer",
  "siteDestinationContainer",
  "fileSystemTransport",
  "ftpTransport",
  "databaseTransport",
  "cloudTransport",
  "transportContainer",
  "workflowDefinition",
  "workflowDefinitionContainer",
  "workflowEmail",
  "workflowEmailContainer",
]);
