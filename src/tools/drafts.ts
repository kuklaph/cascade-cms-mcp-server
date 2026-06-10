import type { McpServer } from "@modelcontextprotocol/server";
import type { Types } from "cascade-cms-api";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { CascadeClient } from "../client.js";
import { createResponseCache } from "../cache.js";
import {
  CHARACTER_LIMIT,
  FILE_DATA_MAX_BYTES,
} from "../constants.js";
import {
  buildAssetIndex,
  createAssetCache,
  getIndexedNode,
  listIndexedChildren,
  type IndexedAsset,
  type AssetCache,
} from "../assetIndex.js";
import {
  createDraftCache,
  draftResourceUri,
  draftSummary,
  getDraftValue,
  type DraftCache,
  type DraftCacheEntry,
  type DraftPatchOperation,
} from "../assetDrafts.js";
import {
  buildCreateAssetScaffold,
  buildCreateAssetScaffoldFromAsset,
  type CreateScaffoldFromAsset,
  type CreateScaffoldOptions,
  type CreateScaffoldRelationshipStyle,
  type CreateScaffoldRoleType,
} from "../createScaffolds.js";
import {
  listFacts,
  listReferences,
  listScalarArtifacts,
  searchKeys,
  searchValues,
  type AuditPage,
} from "../assetFacts.js";
import {
  CreateRequestSchema,
  DraftApplyPatchRequestSchema,
  DraftGetNodeletRequestSchema,
  DraftGetValueRequestSchema,
  DraftListFactsRequestSchema,
  DraftListNodeletsRequestSchema,
  DraftListReferencesRequestSchema,
  DraftListScalarArtifactsRequestSchema,
  DraftOpenRequestSchema,
  DraftApplySemanticPatchRequestSchema,
  DraftAssertValuesRequestSchema,
  DraftResolveNodesRequestSchema,
  DraftScaffoldCreateRequestSchema,
  DraftScaffoldFromAssetRequestSchema,
  DraftSearchKeysRequestSchema,
  DraftSearchValuesRequestSchema,
  DraftSetFileDataRequestSchema,
  DraftSubmitRequestSchema,
  DraftMutationPlanExecuteRequestSchema,
  DraftValidateRequestSchema,
  EditRequestSchema,
} from "../schemas/requests.js";
import {
  summarizeFileData,
  toSignedFileData,
} from "../fileData.js";
import {
  evaluateStructuredDataAssertions,
  resolveSingleMatch,
  resolveStructuredDataNodes,
  semanticFieldPatchOperations,
  semanticNodePatchOperations,
  type StructuredDataAssertion,
  type StructuredDataSelector,
  type StructuredDataTarget,
} from "../structuredDataSelectors.js";
import {
  buildCascadeToolDescription,
  registerCascadeTool,
  type CascadeDeps,
} from "./helper.js";
import type { NextAction } from "../guidance.js";
import {
  describeToolBlockRule,
  findDeniedToolCall,
} from "../toolBlocks.js";
import { redactSecrets } from "../errors.js";

type SemanticPatchArgs = {
  draft_handle: string;
  expected_revision?: number;
  match: StructuredDataSelector;
  op: "add" | "replace" | "remove" | "insert_node" | "remove_node" | "move_node";
  target?: StructuredDataTarget;
  value?: unknown;
  position?: "before" | "after";
  node?: Record<string, unknown>;
  destination?: {
    match: StructuredDataSelector;
    position: "before" | "after";
  };
};

type MutationPlanStep = {
  name?: string;
  tool:
    | "cascade_draft_open"
    | "cascade_draft_scaffold_create"
    | "cascade_draft_scaffold_from_asset"
    | "cascade_draft_resolve_nodes"
    | "cascade_draft_apply_patch"
    | "cascade_draft_apply_semantic_patch"
    | "cascade_draft_assert_values"
    | "cascade_draft_set_file_data"
    | "cascade_draft_validate"
    | "cascade_draft_submit";
  input?: Record<string, unknown>;
  save_as?: string;
};

export function registerDraftTools(
  server: McpServer,
  client: CascadeClient,
  deps?: CascadeDeps,
): void {
  const resolved: CascadeDeps = deps ?? { cache: createResponseCache() };
  const assetCache = resolved.assetCache ?? createAssetCache();
  const draftCache = resolved.draftCache ?? createDraftCache();
  const inFlightSubmits = new Set<string>();

  async function openDraft(args: {
    operation: "create" | "edit";
    asset_handle?: string;
    expected_raw_hash?: string;
    asset?: unknown;
  }): Promise<Record<string, unknown>> {
    let draft: DraftCacheEntry;
    if (args.operation === "edit") {
      const entry = getAssetEntry(
        assetCache,
        args.asset_handle ?? "",
        "cascade_draft_open",
      );
      await assertToolBlockAllowed("cascade_draft_open", entry.raw, resolved);
      draft = draftCache.createFromRead(entry, args.expected_raw_hash ?? "");
    } else {
      await assertToolBlockAllowed(
        "cascade_draft_open",
        { asset: args.asset ?? {} },
        resolved,
      );
      draft = draftCache.createFromAsset("create", args.asset ?? {});
    }
    return {
      success: true,
      ...draftSummary(draft),
      next_actions: draftNextActions(draft),
    };
  }

  async function scaffoldCreateDraft(args: {
    asset_type: CreateScaffoldOptions["assetType"];
    relationship_style?: CreateScaffoldRelationshipStyle;
    role_type?: CreateScaffoldRoleType;
  }): Promise<Record<string, unknown>> {
    const scaffold = buildCreateAssetScaffold({
      assetType: args.asset_type,
      relationshipStyle: args.relationship_style,
      roleType: args.role_type,
    });
    const draft = draftCache.createFromAsset("create", scaffold.asset);
    return {
      success: true,
      ...draftSummary(draft),
      scaffold: scaffold.asset,
      required_value_pointers: scaffold.required_value_pointers,
      relationship_groups: scaffold.relationship_groups,
      notes: scaffold.notes,
      next_actions: createScaffoldNextActions(draft, scaffold.required_value_pointers),
    };
  }

  async function scaffoldFromAssetDraft(args: {
    asset_handle: string;
    expected_raw_hash: string;
    clear_values?: boolean;
    preserve_definition?: boolean;
  }): Promise<Record<string, unknown>> {
    const entry = getAssetEntry(
      assetCache,
      args.asset_handle,
      "cascade_draft_scaffold_from_asset",
    );
    if (entry.rawHash !== args.expected_raw_hash) {
      throw new Error(
        `expected_raw_hash mismatch for asset handle ${entry.handle}. Re-run cascade_read or use the current raw_hash.`,
      );
    }

    await assertToolBlockAllowed("cascade_draft_scaffold_from_asset", entry.raw, resolved);
    const scaffold = buildCreateAssetScaffoldFromAsset(assetEnvelopeFromRaw(entry.raw), {
      clearValues: args.clear_values,
      preserveDefinition: args.preserve_definition,
    });
    await assertToolBlockAllowed(
      "cascade_draft_scaffold_from_asset",
      { asset: scaffold.asset },
      resolved,
    );
    const draft = draftCache.createFromAsset("create", scaffold.asset);

    return {
      success: true,
      ...draftSummary(draft),
      source_asset_handle: entry.handle,
      source_raw_hash: entry.rawHash,
      scaffold: scaffold.asset,
      cleared_value_pointers: scaffold.cleared_value_pointers,
      replace_value_pointers: scaffold.replace_value_pointers,
      add_value_pointers: scaffold.add_value_pointers,
      next_actions: createScaffoldFromAssetNextActions(draft, scaffold),
    };
  }

  async function applyJsonPatch(args: {
    draft_handle: string;
    expected_revision?: number;
    operations: DraftPatchOperation[];
  }): Promise<Record<string, unknown>> {
    const draft = getDraftEntry(draftCache, args.draft_handle);
    await assertToolBlockAllowed("cascade_draft_apply_patch", draft.root, resolved);
    const preview = draftCache.previewPatch(args.draft_handle, {
      expectedRevision: args.expected_revision,
      operations: args.operations,
    });
    await assertToolBlockAllowed(
      "cascade_draft_apply_patch",
      preview.nextRoot,
      resolved,
    );
    return {
      success: true,
      ...draftCache.commitPatch(preview),
    };
  }

  async function applySemanticPatch(args: SemanticPatchArgs): Promise<Record<string, unknown>> {
    const draft = getDraftEntry(draftCache, args.draft_handle);
    await assertToolBlockAllowed("cascade_draft_apply_semantic_patch", draft.root, resolved);
    const semantic = buildSemanticDraftPatch(draft.index, args);
    const preview = draftCache.previewPatch(args.draft_handle, {
      expectedRevision: args.expected_revision,
      operations: semantic.operations,
    });
    await assertToolBlockAllowed(
      "cascade_draft_apply_semantic_patch",
      preview.nextRoot,
      resolved,
    );
    return {
      success: true,
      ...draftCache.commitPatch(preview),
      matched_node_pointer: semantic.match_pointer,
      target_pointer: semantic.target_pointer,
      before: semantic.before,
      ...(semantic.after !== undefined ? { after: semantic.after } : {}),
    };
  }

  async function setFileData(args: {
    draft_handle: string;
    expected_revision: number;
    input_path?: string;
    base64_data?: string;
    expected_sha256?: string;
  }): Promise<Record<string, unknown>> {
    const draft = getDraftEntry(draftCache, args.draft_handle);
    assertExpectedDraftRevision(draft, args.expected_revision);
    await assertToolBlockAllowed(
      "cascade_draft_set_file_data",
      materializeDraftRoot(draft, "placeholder"),
      resolved,
    );
    const file = fileBodyFromDraft(draft);
    const bytes = await readFileDataInput(args);
    const summary = summarizeFileData(
      bytes,
      "/asset/file/data",
      args.input_path ? basename(args.input_path) : fileNameFromBody(file),
    );
    if (
      args.expected_sha256 &&
      args.expected_sha256.toLowerCase() !== summary.sha256.toLowerCase()
    ) {
      throw new Error(
        `cascade_draft_set_file_data: expected_sha256 mismatch. Expected ${args.expected_sha256}, actual ${summary.sha256}.`,
      );
    }

    const textRemoved = file.text === null;
    await assertToolBlockAllowed(
      "cascade_draft_set_file_data",
      draftRootWithFileDataPlaceholder(draft, textRemoved),
      resolved,
    );
    return {
      success: true,
      ...draftCache.setFileData(args.draft_handle, {
        expectedRevision: args.expected_revision,
        bytes,
        summary,
        removeNullText: textRemoved,
      }),
      ...summary,
      file_data_attached: true,
      text_removed: textRemoved,
    };
  }

  async function submitDraft(args: {
    draft_handle: string;
    expected_revision: number;
    discard_on_success?: boolean;
  }): Promise<Record<string, unknown>> {
    const draft = getDraftEntry(draftCache, args.draft_handle);
    if (args.expected_revision !== draft.revision) {
      throw new Error(
        `expected_revision ${args.expected_revision} does not match current draft revision ${draft.revision}.`,
      );
    }
    if (inFlightSubmits.has(draft.handle)) {
      throw new Error(
        `Draft ${draft.handle} is already being submitted. Wait for the in-flight submit to finish before retrying.`,
      );
    }

    inFlightSubmits.add(draft.handle);
    try {
      const validation = parseDraftRequest(draft, "placeholder");
      if (!validation.valid) {
        throw new Error(
          `cascade_draft_submit validation failed for ${draft.operation} draft: ${validation.issues?.[0]?.message ?? "invalid draft"}`,
        );
      }

      const submittedRevision = draft.revision;
      const submittedHash = draft.draftHash;
      const checkRequest = validation.request as { asset: unknown };
      const finalTool = draft.operation === "create" ? "cascade_create" : "cascade_edit";
      assertEditTargetUnchanged(draft, checkRequest);
      await assertToolBlockAllowed("cascade_draft_submit", checkRequest, resolved);
      await assertToolBlockAllowed(finalTool, checkRequest, resolved);
      await assertEditSourceCurrent(draft, client);
      assertDraftStillCurrent(draftCache, draft.handle, submittedRevision, submittedHash);
      const actualValidation = parseDraftRequest(draft, "actual");
      if (!actualValidation.valid) {
        throw new Error(
          `cascade_draft_submit validation failed for ${draft.operation} draft: ${actualValidation.issues?.[0]?.message ?? "invalid draft"}`,
        );
      }
      const request = actualValidation.request as { asset: unknown };
      const result =
        draft.operation === "create"
          ? await client.create(request as unknown as Types.CreateRequest)
          : await client.edit(request as unknown as Types.EditRequest);
      let discardSkippedReason: string | undefined;
      if (args.discard_on_success && cascadeResultSucceeded(result)) {
        if (draftIsStillCurrent(draftCache, draft.handle, submittedRevision, submittedHash)) {
          draftCache.delete(draft.handle);
        } else {
          discardSkippedReason =
            "Draft changed while submit was in flight; retained current draft revision instead of discarding.";
        }
      }
      return {
        success: cascadeResultSucceeded(result),
        submitted_as: finalTool,
        draft_handle: draft.handle,
        revision: submittedRevision,
        cascade_result: result,
        ...(discardSkippedReason ? { discard_skipped_reason: discardSkippedReason } : {}),
      };
    } finally {
      inFlightSubmits.delete(draft.handle);
    }
  }

  async function executeMutationPlan(args: {
    steps: MutationPlanStep[];
  }): Promise<Record<string, unknown>> {
    const saved = new Map<string, Record<string, unknown>>();
    const completedSteps: Array<Record<string, unknown>> = [];

    for (const [index, step] of args.steps.entries()) {
      try {
        const input = hydratePlanInput(step, saved);
        await assertMutationPlanStepAllowed(step.tool, input);
        const result = await runMutationPlanStep(step.tool, input);
        refreshSavedDrafts(saved, result);
        const failure = planFailureReason(result);
        if (failure) {
          return {
            success: false,
            completed_steps: completedSteps,
            failed_step: {
              index,
              name: step.name,
              tool: step.tool,
              reason: failure,
              result,
            },
            current_drafts: currentDraftSummaries(saved, draftCache),
          };
        }
        if (step.save_as) saved.set(step.save_as, result);
        completedSteps.push({
          index,
          name: step.name,
          tool: step.tool,
          result,
        });
      } catch (error) {
        return {
          success: false,
          completed_steps: completedSteps,
          failed_step: {
            index,
            name: step.name,
            tool: step.tool,
            error: redactSecrets(error instanceof Error ? error.message : String(error)),
          },
          current_drafts: currentDraftSummaries(saved, draftCache),
        };
      }
    }

    return {
      success: true,
      completed_steps: completedSteps,
      current_drafts: currentDraftSummaries(saved, draftCache),
    };
  }

  async function assertMutationPlanStepAllowed(
    tool: MutationPlanStep["tool"],
    input: Record<string, unknown>,
  ): Promise<void> {
    if (!resolved.toolBlockStore) return;
    for (const payload of mutationPlanToolBlockPayloads(tool, input)) {
      await assertToolBlockAllowed(
        "cascade_draft_mutation_plan_execute",
        payload,
        resolved,
      );
    }
  }

  function mutationPlanToolBlockPayloads(
    tool: MutationPlanStep["tool"],
    input: Record<string, unknown>,
  ): unknown[] {
    const parsed = validateMutationPlanStepInput(tool, input) as Record<string, any>;
    switch (tool) {
      case "cascade_draft_open":
        if (parsed.operation === "edit") {
          return [
            getAssetEntry(
              assetCache,
              parsed.asset_handle ?? "",
              "cascade_draft_mutation_plan_execute",
            ).raw,
          ];
        }
        return [{ asset: parsed.asset ?? {} }];
      case "cascade_draft_scaffold_create": {
        const scaffold = buildCreateAssetScaffold({
          assetType: parsed.asset_type,
          relationshipStyle: parsed.relationship_style,
          roleType: parsed.role_type,
        });
        return [{ asset: scaffold.asset }];
      }
      case "cascade_draft_scaffold_from_asset": {
        const entry = getAssetEntry(
          assetCache,
          parsed.asset_handle,
          "cascade_draft_mutation_plan_execute",
        );
        if (entry.rawHash !== parsed.expected_raw_hash) {
          throw new Error(
            `expected_raw_hash mismatch for asset handle ${entry.handle}. Re-run cascade_read or use the current raw_hash.`,
          );
        }
        const scaffold = buildCreateAssetScaffoldFromAsset(assetEnvelopeFromRaw(entry.raw), {
          clearValues: parsed.clear_values,
          preserveDefinition: parsed.preserve_definition,
        });
        return [entry.raw, { asset: scaffold.asset }];
      }
      case "cascade_draft_apply_patch": {
        const draft = getDraftEntry(draftCache, parsed.draft_handle);
        const preview = draftCache.previewPatch(parsed.draft_handle, {
          expectedRevision: parsed.expected_revision,
          operations: parsed.operations,
        });
        return [draft.root, preview.nextRoot];
      }
      case "cascade_draft_apply_semantic_patch": {
        const draft = getDraftEntry(draftCache, parsed.draft_handle);
        const semantic = buildSemanticDraftPatch(draft.index, parsed as SemanticPatchArgs);
        const preview = draftCache.previewPatch(parsed.draft_handle, {
          expectedRevision: parsed.expected_revision,
          operations: semantic.operations,
        });
        return [draft.root, preview.nextRoot];
      }
      case "cascade_draft_set_file_data": {
        const draft = getDraftEntry(draftCache, parsed.draft_handle);
        assertExpectedDraftRevision(draft, parsed.expected_revision);
        const file = fileBodyFromDraft(draft);
        return [
          materializeDraftRoot(draft, "placeholder"),
          draftRootWithFileDataPlaceholder(draft, file.text === null),
        ];
      }
      case "cascade_draft_resolve_nodes":
      case "cascade_draft_assert_values":
      case "cascade_draft_validate":
        return [
          materializeDraftRoot(
            getDraftEntry(draftCache, parsed.draft_handle),
            "placeholder",
          ),
        ];
      case "cascade_draft_submit": {
        const draft = getDraftEntry(draftCache, parsed.draft_handle);
        const validation = parseDraftRequest(draft, "placeholder");
        return validation.valid
          ? [validation.request]
          : [materializeDraftRoot(draft, "placeholder")];
      }
    }
  }

  async function runMutationPlanStep(
    tool: MutationPlanStep["tool"],
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const parsed = validateMutationPlanStepInput(tool, input);
    switch (tool) {
      case "cascade_draft_open":
        return openDraft(parsed as any);
      case "cascade_draft_scaffold_create":
        return scaffoldCreateDraft(parsed as any);
      case "cascade_draft_scaffold_from_asset":
        return scaffoldFromAssetDraft(parsed as any);
      case "cascade_draft_resolve_nodes": {
        const draft = getDraftEntry(draftCache, parsed.draft_handle as string);
        await assertToolBlockAllowed("cascade_draft_resolve_nodes", draft.root, resolved);
        return {
          success: true,
          draft_handle: draft.handle,
          revision: draft.revision,
          ...resolveStructuredDataNodes(
            draft.index,
            parsed.selector as StructuredDataSelector,
          ),
        };
      }
      case "cascade_draft_apply_patch":
        return applyJsonPatch(parsed as any);
      case "cascade_draft_apply_semantic_patch":
        return applySemanticPatch(parsed as any);
      case "cascade_draft_set_file_data":
        return setFileData(parsed as any);
      case "cascade_draft_assert_values": {
        const draft = getDraftEntry(draftCache, parsed.draft_handle as string);
        await assertToolBlockAllowed("cascade_draft_assert_values", draft.root, resolved);
        return {
          success: true,
          draft_handle: draft.handle,
          revision: draft.revision,
          ...evaluateStructuredDataAssertions(
            draft.index,
            parsed.assertions as StructuredDataAssertion[],
          ),
        };
      }
      case "cascade_draft_validate": {
        const draft = getDraftEntry(draftCache, parsed.draft_handle as string);
        await assertToolBlockAllowed(
          "cascade_draft_validate",
          materializeDraftRoot(draft, "placeholder"),
          resolved,
        );
        return validateDraft(draft);
      }
      case "cascade_draft_submit":
        return submitDraft(parsed as any);
    }
  }

  registerCascadeTool(server, {
    name: "cascade_draft_open",
    title: "Open asset draft",
    description: buildCascadeToolDescription(
      `Open a mutable local draft for a create or edit workflow. Edit drafts clone the immutable asset_handle returned by cascade_read preview and require expected_raw_hash. Create drafts start from an optional asset envelope. This tool never calls Cascade.`,
    ),
    inputSchema: DraftOpenRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      return openDraft(input as any);
    },
  }, resolved);

  registerCascadeTool(server, {
    name: "cascade_draft_scaffold_create",
    title: "Scaffold create draft",
    description: buildCascadeToolDescription(
      `Open a mutable local create draft containing the bare required asset envelope for one Cascade asset type. Required caller-supplied values are null placeholders and must be patched before validation or submit. This tool never calls Cascade.`,
    ),
    inputSchema: DraftScaffoldCreateRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      return scaffoldCreateDraft(input as any);
    },
  }, resolved);

  registerCascadeTool(server, {
    name: "cascade_draft_scaffold_from_asset",
    title: "Scaffold create draft from asset",
    description: buildCascadeToolDescription(
      `Open a mutable local create draft by creating a create-safe scaffold from any existing cached asset envelope, stripping read-only fields/recycled flags, clearing credential fields present in the source to null, adding required hidden credential placeholders when absent, optionally clearing structuredData text and asset-reference values, and returning cleared/replace/add pointer lists. This mutates only the local draft addressed by the new draft_handle, never the original asset_handle, and never calls Cascade.`,
    ),
    inputSchema: DraftScaffoldFromAssetRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => scaffoldFromAssetDraft(input as any),
  }, resolved);

  registerDraftReadTool(server, resolved, draftCache, {
    name: "cascade_draft_list_facts",
    title: "List draft raw facts",
    description: "Browse object, array, key, and scalar facts indexed from the current draft payload. Use this for audit/debug enumeration; when the task is to find text or content by snippet, prefer cascade_draft_search_values because list_facts can return both key facts and scalar facts for the same value.",
    inputSchema: DraftListFactsRequestSchema,
    handler: (entry, args) => draftPage(entry, listFacts(entry.index, args as any)),
  });

  registerDraftReadTool(server, resolved, draftCache, {
    name: "cascade_draft_search_values",
    title: "Search draft scalar values",
    description: "Search scalar string/number/boolean/null values inside the current draft payload. Best first choice for finding text/content by known snippet.",
    inputSchema: DraftSearchValuesRequestSchema,
    handler: (entry, args) => draftPage(entry, searchValues(entry.index, args as any)),
  });

  registerDraftReadTool(server, resolved, draftCache, {
    name: "cascade_draft_search_keys",
    title: "Search draft object keys",
    description: "Search object keys inside the current draft payload.",
    inputSchema: DraftSearchKeysRequestSchema,
    handler: (entry, args) => draftPage(entry, searchKeys(entry.index, args as any)),
  });

  registerDraftReadTool(server, resolved, draftCache, {
    name: "cascade_draft_list_scalar_artifacts",
    title: "List draft scalar artifacts",
    description: "List derived link/path-like scalar artifacts in the current draft. Use href for any value found in an HTML/XHTML href attribute, whether absolute, root-relative, relative, or site://; use site_link for non-root, non-URL Cascade *Path fields such as pagePath, filePath, blockPath, and parentFolderPath. Other artifact kinds include http_url, src, anchor, mailto, tel, and root_path.",
    inputSchema: DraftListScalarArtifactsRequestSchema,
    handler: (entry, args) =>
      draftPage(entry, listScalarArtifacts(entry.index, args as any)),
  });

  registerDraftReadTool(server, resolved, draftCache, {
    name: "cascade_draft_list_references",
    title: "List draft references",
    description: "List Cascade-native references discovered in the current draft.",
    inputSchema: DraftListReferencesRequestSchema,
    handler: (entry, args) => draftPage(entry, listReferences(entry.index, args as any)),
  });

  registerDraftReadTool(server, resolved, draftCache, {
    name: "cascade_draft_get_value",
    title: "Get draft JSON value",
    description: "Fetch any JSON value from the current draft by JSON Pointer. Long strings can be sliced with offset and length.",
    inputSchema: DraftGetValueRequestSchema,
    handler: (entry, args) =>
      draftValue(entry, args.pointer as string, {
        offset: args.offset as number | undefined,
        length: args.length as number | undefined,
      }),
  });

  registerDraftReadTool(server, resolved, draftCache, {
    name: "cascade_draft_list_nodelets",
    title: "List draft nodelets",
    description: "List structuredData nodelets from the current draft.",
    inputSchema: DraftListNodeletsRequestSchema,
    handler: (entry, args) => {
      const listed = listIndexedChildren(entry.index, args.pointer as string, args as any);
      return {
        success: true,
        draft_handle: entry.handle,
        draft_resource_uri: draftResourceUri(entry.handle),
        draft_hash: entry.draftHash,
        revision: entry.revision,
        pointer: args.pointer,
        nodelets: listed.children,
        ...(listed.next_cursor ? { next_cursor: listed.next_cursor } : {}),
        next_actions: [
          ...(listed.next_cursor
            ? [
                {
                  tool: "cascade_draft_list_nodelets",
                  reason: "Continue listing draft nodelets from the next cursor.",
                  input: {
                    draft_handle: entry.handle,
                    pointer: args.pointer,
                    cursor: listed.next_cursor,
                    ...(args.limit ? { limit: args.limit } : {}),
                  },
                },
              ]
            : []),
          ...listed.children.map((nodelet) => ({
            tool: "cascade_draft_get_nodelet",
            reason: "Fetch this draft nodelet or a bounded subtree.",
            input: {
              draft_handle: entry.handle,
              pointer: nodelet.pointer,
            },
          })),
        ],
      };
    },
  });

  registerDraftReadTool(server, resolved, draftCache, {
    name: "cascade_draft_get_nodelet",
    title: "Get draft nodelet",
    description: "Fetch a structuredData nodelet or bounded subtree from the current draft.",
    inputSchema: DraftGetNodeletRequestSchema,
    handler: (entry, args) => ({
      draft_handle: entry.handle,
      revision: entry.revision,
      ...getIndexedNode(entry.index, args.pointer as string, args as any),
    }),
  });

  registerDraftReadTool(server, resolved, draftCache, {
    name: "cascade_draft_resolve_nodes",
    title: "Resolve draft structured data nodes",
    description: "Resolve structuredData nodes from the current draft by node type, identifier, text, direct child criteria, or field values.",
    inputSchema: DraftResolveNodesRequestSchema,
    handler: (entry, args) => ({
      draft_handle: entry.handle,
      revision: entry.revision,
      ...resolveStructuredDataNodes(
        entry.index,
        args.selector as StructuredDataSelector,
      ),
    }),
  });

  registerDraftReadTool(server, resolved, draftCache, {
    name: "cascade_draft_assert_values",
    title: "Assert draft structured data values",
    description: "Assert structuredData values from the current draft by semantic node selector and target field.",
    inputSchema: DraftAssertValuesRequestSchema,
    handler: (entry, args) => ({
      draft_handle: entry.handle,
      revision: entry.revision,
      ...evaluateStructuredDataAssertions(
        entry.index,
        args.assertions as StructuredDataAssertion[],
      ),
    }),
  });

  registerCascadeTool(server, {
    name: "cascade_draft_apply_patch",
    title: "Apply draft patch",
    description: buildCascadeToolDescription(
      `Atomically apply JSON Pointer add, replace, and remove operations to a mutable local draft. This mutates only the local draft addressed by draft_handle, never the original asset_handle read cache, and never calls Cascade.`,
    ),
    inputSchema: DraftApplyPatchRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => {
      return applyJsonPatch(input as any);
    },
  }, resolved);

  registerCascadeTool(server, {
    name: "cascade_draft_apply_semantic_patch",
    title: "Apply draft semantic patch",
    description: buildCascadeToolDescription(
      `Resolve one structuredData node by semantic selector, compile the change to JSON Pointer patch operations, then atomically apply it to the mutable local draft. This mutates only the local draft addressed by draft_handle, never the original asset_handle read cache, and never calls Cascade.`,
    ),
    inputSchema: DraftApplySemanticPatchRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    handler: async (input) => applySemanticPatch(input as any),
  }, resolved);

  registerCascadeTool(server, {
    name: "cascade_draft_set_file_data",
    title: "Set draft file data",
    description: buildCascadeToolDescription(
      `Read local file bytes from exactly one of input_path or base64_data, normalize them to Cascade signed Java bytes, and set asset.file.data on a mutable file draft. This mutates only the local draft, never Cascade. Existing string text is preserved because Cascade files may validly carry text, data, or both; a null text scaffold placeholder is removed so the draft can validate.`,
    ),
    inputSchema: DraftSetFileDataRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async (input) => setFileData(input as any),
  }, resolved);

  registerCascadeTool(server, {
    name: "cascade_draft_validate",
    title: "Validate asset draft",
    description: buildCascadeToolDescription(
      `Validate the current draft payload with the normal cascade_create or cascade_edit Zod schema without calling Cascade.`,
    ),
    inputSchema: DraftValidateRequestSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const draft = getDraftEntry(draftCache, (input as any).draft_handle);
      await assertToolBlockAllowed(
        "cascade_draft_validate",
        materializeDraftRoot(draft, "placeholder"),
        resolved,
      );
      return validateDraft(draft);
    },
  }, resolved);

  registerCascadeTool(server, {
    name: "cascade_draft_mutation_plan_execute",
    title: "Execute draft mutation plan",
    description: buildCascadeToolDescription(
      `Execute a small sequence of draft workflow steps locally, passing saved draft handles between steps with draft_ref. Steps run sequentially and stop on the first tool error, failed assertion, failed validation, or a step/Cascade result with success: false. Tool-block rules targeting cascade_draft_mutation_plan_execute are checked against hydrated/resolved step payloads before each step runs. This is local orchestration, not a Cascade batch request.`,
    ),
    inputSchema: DraftMutationPlanExecuteRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async (input) => executeMutationPlan(input as any),
  }, resolved);

  registerCascadeTool(server, {
    name: "cascade_draft_submit",
    title: "Submit asset draft",
    description: buildCascadeToolDescription(
      `Validate the current draft with the normal create/edit schema, check tool-block rules against the complete payload as cascade_draft_submit and the resolved cascade_create or cascade_edit operation, then call Cascade with the full { asset } request.`,
    ),
    inputSchema: DraftSubmitRequestSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    handler: async (input) => {
      return submitDraft(input as any);
    },
  }, resolved);
}

function buildSemanticDraftPatch(
  index: IndexedAsset,
  args: SemanticPatchArgs,
): {
  operations: DraftPatchOperation[];
  match_pointer: string;
  target_pointer: string;
  before: unknown;
  after?: unknown;
} {
  if (args.op === "add" || args.op === "replace" || args.op === "remove") {
    const semantic = semanticFieldPatchOperations(index, {
      op: args.op,
      match: args.match,
      target: args.target!,
      ...(args.op === "remove" ? {} : { value: args.value }),
    } as any);
    return {
      operations: semantic.operations,
      match_pointer: semantic.match.pointer,
      target_pointer: semantic.target_pointer,
      before: semantic.before,
      ...(semantic.after !== undefined ? { after: semantic.after } : {}),
    };
  }

  const match = resolveSingleMatch(index, args.match);
  if (args.op === "insert_node") {
    const operations = semanticNodePatchOperations(index, {
      op: "insert_node",
      match,
      position: args.position!,
      node: args.node!,
    });
    return {
      operations,
      match_pointer: match.pointer,
      target_pointer: operations[0]!.path,
      before: undefined,
      after: args.node,
    };
  }
  if (args.op === "remove_node") {
    const operations = semanticNodePatchOperations(index, {
      op: "remove_node",
      match,
    });
    return {
      operations,
      match_pointer: match.pointer,
      target_pointer: match.pointer,
      before: match.node,
    };
  }

  const destinationMatch = resolveSingleMatch(index, args.destination!.match);
  const operations = semanticNodePatchOperations(index, {
    op: "move_node",
    match,
    destination: {
      match: destinationMatch,
      position: args.destination!.position,
    },
  });
  return {
    operations,
    match_pointer: match.pointer,
    target_pointer: operations[1]!.path,
    before: match.node,
    after: match.node,
  };
}

function assetEnvelopeFromRaw(raw: unknown): Record<string, unknown> {
  if (!isRecord(raw) || !isRecord(raw.asset)) {
    throw new Error("Cached asset response does not contain an asset envelope.");
  }
  return raw.asset;
}

function fileBodyFromDraft(draft: DraftCacheEntry): Record<string, unknown> {
  const asset = isRecord(draft.root.asset) ? draft.root.asset : undefined;
  const file = asset && isRecord(asset.file) ? asset.file : undefined;
  if (!file || draft.index.assetType !== "file") {
    throw new Error("cascade_draft_set_file_data: draft must contain a file asset.");
  }
  return file;
}

type DraftFileDataMaterialization = "actual" | "placeholder";

function materializeDraftRoot(
  entry: DraftCacheEntry,
  fileDataMode: DraftFileDataMaterialization,
): Record<string, unknown> {
  if (!entry.fileData) return entry.root;

  const root = structuredClone(entry.root) as Record<string, unknown>;
  const file = fileBodyFromRoot(root);
  file.data =
    fileDataMode === "actual"
      ? toSignedFileData(entry.fileData.bytes)
      : [0];
  return root;
}

function draftRootWithFileDataPlaceholder(
  draft: DraftCacheEntry,
  removeNullText: boolean,
): Record<string, unknown> {
  const root = structuredClone(draft.root) as Record<string, unknown>;
  const file = fileBodyFromRoot(root);
  file.data = [0];
  if (removeNullText && file.text === null) delete file.text;
  return root;
}

function fileBodyFromRoot(root: Record<string, unknown>): Record<string, unknown> {
  const asset = isRecord(root.asset) ? root.asset : undefined;
  const file = asset && isRecord(asset.file) ? asset.file : undefined;
  if (!file) {
    throw new Error("cascade_draft_set_file_data: draft must contain a file asset.");
  }
  return file;
}

async function readFileDataInput(args: {
  input_path?: string;
  base64_data?: string;
}): Promise<Uint8Array> {
  if (args.input_path !== undefined) {
    const info = await stat(args.input_path);
    if (!info.isFile()) {
      throw new Error("cascade_draft_set_file_data: input_path must be a file.");
    }
    assertFileDataInputSize(info.size, "input_path");
    const bytes = new Uint8Array(await readFile(args.input_path));
    assertFileDataInputSize(bytes.length, "input_path");
    return bytes;
  }
  return decodeBase64Data(args.base64_data ?? "");
}

function decodeBase64Data(value: string): Uint8Array {
  const normalized = value.replace(/\s+/g, "");
  const unpadded = normalized.replace(/=+$/, "");
  if (
    normalized.length === 0 ||
    normalized.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    throw new Error("cascade_draft_set_file_data: base64_data is not valid base64.");
  }
  assertFileDataInputSize(decodedBase64ByteLength(normalized), "base64_data");
  const buffer = Buffer.from(normalized, "base64");
  if (buffer.toString("base64").replace(/=+$/, "") !== unpadded) {
    throw new Error("cascade_draft_set_file_data: base64_data is not valid base64.");
  }
  assertFileDataInputSize(buffer.length, "base64_data");
  return new Uint8Array(buffer);
}

function decodedBase64ByteLength(normalized: string): number {
  const padding = normalized.endsWith("==")
    ? 2
    : normalized.endsWith("=")
      ? 1
      : 0;
  return Math.floor((normalized.length * 3) / 4) - padding;
}

function assertFileDataInputSize(bytes: number, source: string): void {
  if (bytes <= FILE_DATA_MAX_BYTES) return;
  throw new Error(
    `cascade_draft_set_file_data: ${source} is too large (${bytes} bytes, max ${FILE_DATA_MAX_BYTES}).`,
  );
}

function fileNameFromBody(file: Record<string, unknown>): string | undefined {
  return typeof file.name === "string" ? file.name : undefined;
}

function hydratePlanInput(
  step: MutationPlanStep,
  saved: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
  const input = { ...(step.input ?? {}) };
  const draftRef = input.draft_ref;
  if (typeof draftRef !== "string") return input;

  const savedDraft = saved.get(draftRef);
  if (!savedDraft) {
    throw new Error(`draft_ref ${draftRef} has not been saved by an earlier step.`);
  }
  const draftHandle = savedDraft.draft_handle;
  if (typeof draftHandle !== "string") {
    throw new Error(`draft_ref ${draftRef} does not contain a draft_handle.`);
  }

  delete input.draft_ref;
  input.draft_handle = draftHandle;
  if (
    input.expected_revision === undefined &&
    typeof savedDraft.revision === "number" &&
    planToolUsesExpectedRevision(step.tool)
  ) {
    input.expected_revision = savedDraft.revision;
  }
  return input;
}

function validateMutationPlanStepInput(
  tool: MutationPlanStep["tool"],
  input: Record<string, unknown>,
): Record<string, unknown> {
  const schema = schemaForMutationPlanStep(tool);
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    throw new Error(
      `${tool} input validation failed: ${path}${issue?.message ?? "invalid input"}`,
    );
  }
  return parsed.data as Record<string, unknown>;
}

function schemaForMutationPlanStep(tool: MutationPlanStep["tool"]) {
  switch (tool) {
    case "cascade_draft_open":
      return DraftOpenRequestSchema;
    case "cascade_draft_scaffold_create":
      return DraftScaffoldCreateRequestSchema;
    case "cascade_draft_scaffold_from_asset":
      return DraftScaffoldFromAssetRequestSchema;
    case "cascade_draft_resolve_nodes":
      return DraftResolveNodesRequestSchema;
    case "cascade_draft_apply_patch":
      return DraftApplyPatchRequestSchema;
    case "cascade_draft_apply_semantic_patch":
      return DraftApplySemanticPatchRequestSchema;
    case "cascade_draft_assert_values":
      return DraftAssertValuesRequestSchema;
    case "cascade_draft_set_file_data":
      return DraftSetFileDataRequestSchema;
    case "cascade_draft_validate":
      return DraftValidateRequestSchema;
    case "cascade_draft_submit":
      return DraftSubmitRequestSchema;
  }
}

function refreshSavedDrafts(
  saved: Map<string, Record<string, unknown>>,
  result: Record<string, unknown>,
): void {
  if (typeof result.draft_handle !== "string") return;
  for (const [key, value] of saved) {
    if (value.draft_handle === result.draft_handle) {
      saved.set(key, { ...value, ...result });
    }
  }
}

function currentDraftSummaries(
  saved: Map<string, Record<string, unknown>>,
  draftCache: DraftCache,
): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  const summaries: Array<Record<string, unknown>> = [];
  for (const [ref, value] of saved) {
    const handle = value.draft_handle;
    if (typeof handle !== "string" || seen.has(handle)) continue;
    seen.add(handle);
    const current = draftCache.get(handle);
    if (!current) continue;
    summaries.push({
      ref,
      draft_handle: handle,
      revision: current.revision,
      draft_hash: current.draftHash,
      draft_resource_uri: draftResourceUri(handle),
      operation: current.operation,
    });
  }
  return summaries;
}

function planFailureReason(result: Record<string, unknown>): string | undefined {
  if (result.passed === false) return "assertions failed";
  if (result.valid === false) return "validation failed";
  const cascadeResult = result.cascade_result;
  if (isRecord(cascadeResult) && cascadeResult.success === false) {
    return "cascade_result success false";
  }
  if (result.success === false) return "step returned success false";
  return undefined;
}

function planToolUsesExpectedRevision(tool: MutationPlanStep["tool"]): boolean {
  return (
    tool === "cascade_draft_apply_patch" ||
    tool === "cascade_draft_apply_semantic_patch" ||
    tool === "cascade_draft_set_file_data" ||
    tool === "cascade_draft_submit"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function registerDraftReadTool(
  server: McpServer,
  deps: CascadeDeps,
  draftCache: DraftCache,
  config: {
    name: string;
    title: string;
    description: string;
    inputSchema: any;
    handler: (entry: DraftCacheEntry, args: Record<string, unknown>) => unknown;
  },
): void {
  registerCascadeTool(server, {
    name: config.name,
    title: config.title,
    description: buildCascadeToolDescription(config.description),
    inputSchema: config.inputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    handler: async (input) => {
      const args = input as Record<string, unknown> & { draft_handle: string };
      const entry = getDraftEntry(draftCache, args.draft_handle);
      await assertToolBlockAllowed(config.name, entry.root, deps);
      return config.handler(entry, args);
    },
  }, deps);
}

function getAssetEntry(
  assetCache: AssetCache,
  handle: string,
  toolName: string,
) {
  const entry = assetCache.get(handle);
  if (!entry) {
    throw new Error(
      `${toolName}: asset handle ${handle} not found. Re-run cascade_read to create a fresh asset_handle.`,
    );
  }
  return entry;
}

function getDraftEntry(draftCache: DraftCache, handle: string): DraftCacheEntry {
  const entry = draftCache.get(handle);
  if (!entry) {
    throw new Error(
      `Draft handle ${handle} not found. Re-open the draft before continuing.`,
    );
  }
  return entry;
}

function assertExpectedDraftRevision(
  draft: DraftCacheEntry,
  expectedRevision: number,
): void {
  if (expectedRevision === draft.revision) return;
  throw new Error(
    `expected_revision ${expectedRevision} does not match current draft revision ${draft.revision}.`,
  );
}

function draftPage<T>(entry: DraftCacheEntry, page: AuditPage<T>): Record<string, unknown> {
  const {
    asset_handle: _assetHandle,
    raw_resource_uri: _rawUri,
    raw_hash: _rawHash,
    next_actions: nextActions,
    ...rest
  } = page;
  return {
    ...rest,
    draft_handle: entry.handle,
    draft_resource_uri: draftResourceUri(entry.handle),
    draft_hash: entry.draftHash,
    revision: entry.revision,
    next_actions: rewriteDraftNextActions(entry, nextActions),
  };
}

function rewriteDraftNextActions(
  entry: DraftCacheEntry,
  actions: NextAction[],
): NextAction[] {
  return actions.map((action) => {
    const input: Record<string, unknown> | undefined = action.input
      ? { ...action.input, draft_handle: entry.handle }
      : undefined;
    if (input) delete input.asset_handle;
    return {
      ...action,
      tool: draftToolName(action.tool),
      reason: action.reason.replace("cached asset handle", "draft handle"),
      ...(input ? { input } : {}),
    };
  });
}

function draftToolName(tool: string): string {
  return tool.startsWith("cascade_asset_")
    ? tool.replace("cascade_asset_", "cascade_draft_")
    : tool;
}

function draftValue(
  entry: DraftCacheEntry,
  pointer: string,
  options?: { offset?: number; length?: number },
): Record<string, unknown> {
  if (pointer === "/asset/file/data" && entry.fileData) {
    return {
      draft_handle: entry.handle,
      draft_resource_uri: draftResourceUri(entry.handle),
      draft_hash: entry.draftHash,
      revision: entry.revision,
      file_data_attached: true,
      ...entry.fileData.summary,
    };
  }

  const value = getDraftValue(entry, pointer);
  if (value === undefined) {
    throw new Error(`Pointer ${pointer || "<root>"} not found in draft handle ${entry.handle}.`);
  }
  if (typeof value !== "string") {
    return {
      draft_handle: entry.handle,
      draft_resource_uri: draftResourceUri(entry.handle),
      draft_hash: entry.draftHash,
      revision: entry.revision,
      pointer,
      value,
    };
  }

  const offset = Math.max(0, Math.min(value.length, options?.offset ?? 0));
  const requestedLength =
    options?.length === undefined
      ? CHARACTER_LIMIT
      : Math.min(CHARACTER_LIMIT, Math.max(1, Math.floor(options.length)));
  const end = Math.min(value.length, offset + requestedLength);
  return {
    draft_handle: entry.handle,
    draft_resource_uri: draftResourceUri(entry.handle),
    draft_hash: entry.draftHash,
    revision: entry.revision,
    pointer,
    scalar_type: "string",
    offset,
    length: end - offset,
    value_length: value.length,
    has_more: end < value.length,
    ...(end < value.length ? { next_offset: end } : {}),
    value: value.slice(offset, end),
  };
}

type DraftValidationIssue = { path: string; message: string; code: string };

function parseDraftRequest(
  entry: DraftCacheEntry,
  fileDataMode: DraftFileDataMaterialization = "actual",
): {
  valid: boolean;
  request?: unknown;
  issues?: DraftValidationIssue[];
} {
  const schema = entry.operation === "create" ? CreateRequestSchema : EditRequestSchema;
  const parsed = schema.safeParse(materializeDraftRoot(entry, fileDataMode));
  if (parsed.success) {
    return { valid: true, request: parsed.data };
  }
  return {
    valid: false,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      code: issue.code,
      message: issue.message,
    })),
  };
}

function validateDraft(entry: DraftCacheEntry): Record<string, unknown> & {
  valid: boolean;
  issues?: DraftValidationIssue[];
} {
  const parsed = parseDraftRequest(entry, "placeholder");
  if (parsed.valid) {
    return {
      success: true,
      valid: true,
      draft_handle: entry.handle,
      operation: entry.operation,
      revision: entry.revision,
      ...(entry.fileData
        ? {
            file_data_attached: true,
            file_data_bytes_total: entry.fileData.summary.bytes_total,
          }
        : {}),
    };
  }
  return {
    success: false,
    valid: false,
    draft_handle: entry.handle,
    operation: entry.operation,
    revision: entry.revision,
    issues: parsed.issues,
  };
}

async function assertToolBlockAllowed(
  toolName: string,
  request: unknown,
  deps: CascadeDeps,
): Promise<void> {
  if (!deps.toolBlockStore) return;
  const denied = findDeniedToolCall(
    toolName,
    request,
    await deps.toolBlockStore.read(),
  );
  if (!denied) return;

  const reason = denied.reason ? ` ${denied.reason}` : "";
  throw new Error(
    `Tool call denied by tool block repository for ${toolName} ${describeToolBlockRule(denied)}.${reason}`,
  );
}

async function assertEditSourceCurrent(
  draft: DraftCacheEntry,
  client: CascadeClient,
): Promise<void> {
  if (draft.operation !== "edit") return;
  if (!draft.sourceIdentifier || !draft.sourceRawHash) {
    throw new Error(
      "Edit draft is missing its source identifier. Re-open the draft from a fresh cascade_read result.",
    );
  }

  const current = await client.read({
    identifier: draft.sourceIdentifier,
  } as unknown as Types.ReadRequest);
  const currentHash = buildAssetIndex(current, "current").rawHash;
  if (currentHash === draft.sourceRawHash) return;

  throw new Error(
    "Source asset changed after this edit draft was opened. Re-run cascade_read and open a fresh draft before submitting.",
  );
}

function assertEditTargetUnchanged(
  draft: DraftCacheEntry,
  request: { asset: unknown },
): void {
  if (draft.operation !== "edit") return;
  const source = draft.sourceIdentifier;
  if (!source) {
    throw new Error(
      "Edit draft is missing its source identifier. Re-open the draft from a fresh cascade_read result.",
    );
  }

  const body = assetBodyFromRequest(request);
  if (!body) {
    throw new Error("Edit draft submit payload must contain one asset body.");
  }

  if (source.id) {
    if (body.id === source.id) return;
    throw new Error(
      "Edit draft target changed after the draft was opened. Re-run cascade_read for the intended asset and open a fresh draft before submitting.",
    );
  }

  if (!source.path) return;
  if (body.id !== undefined || body.path !== source.path.path) {
    throw new Error(
      "Edit draft target changed after the draft was opened. Re-run cascade_read for the intended asset and open a fresh draft before submitting.",
    );
  }
  if (source.path.siteId && body.siteId !== source.path.siteId) {
    throw new Error(
      "Edit draft target changed after the draft was opened. Re-run cascade_read for the intended asset and open a fresh draft before submitting.",
    );
  }
  if (source.path.siteName && body.siteName !== source.path.siteName) {
    throw new Error(
      "Edit draft target changed after the draft was opened. Re-run cascade_read for the intended asset and open a fresh draft before submitting.",
    );
  }
}

function assertDraftStillCurrent(
  draftCache: DraftCache,
  handle: string,
  expectedRevision: number,
  expectedHash: string,
): void {
  const current = currentDraftIfUnchanged(
    draftCache,
    handle,
    expectedRevision,
    expectedHash,
  );
  if (current === "missing") {
    throw new Error("Draft was removed before submit. Re-open the draft before submitting.");
  }
  if (current) return;
  const latest = draftCache.get(handle);
  throw new Error(
    `Draft revision changed before submit. Expected ${expectedRevision}, found ${latest?.revision ?? "unknown"}. Re-validate and submit the current draft revision.`,
  );
}

function draftIsStillCurrent(
  draftCache: DraftCache,
  handle: string,
  expectedRevision: number,
  expectedHash: string,
): boolean {
  const current = currentDraftIfUnchanged(
    draftCache,
    handle,
    expectedRevision,
    expectedHash,
  );
  return current !== undefined && current !== "missing";
}

function currentDraftIfUnchanged(
  draftCache: DraftCache,
  handle: string,
  expectedRevision: number,
  expectedHash: string,
): DraftCacheEntry | "missing" | undefined {
  const current = draftCache.get(handle);
  if (!current) return "missing";
  if (current.revision === expectedRevision && current.draftHash === expectedHash) {
    return current;
  }
  return undefined;
}

function assetBodyFromRequest(request: { asset: unknown }): Record<string, unknown> | undefined {
  const asset = isRecord(request.asset) ? request.asset : undefined;
  if (!asset) return undefined;
  for (const value of Object.values(asset)) {
    if (isRecord(value)) return value;
  }
  return undefined;
}

function cascadeResultSucceeded(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { success?: unknown }).success === true
  );
}

function draftNextActions(entry: DraftCacheEntry): Array<Record<string, unknown>> {
  return [
    {
      tool: "cascade_draft_get_value",
      reason: "Fetch a value from this draft by JSON Pointer.",
      input: { draft_handle: entry.handle, pointer: "/asset" },
    },
    {
      tool: "cascade_draft_apply_patch",
      reason: "Mutate this draft with JSON Pointer operations.",
      required_inputs: ["draft_handle", "expected_revision", "operations"],
    },
    {
      tool: "cascade_draft_resolve_nodes",
      reason: "Find structuredData nodes by semantic criteria before patching.",
      required_inputs: ["draft_handle", "selector"],
    },
    {
      tool: "cascade_draft_apply_semantic_patch",
      reason: "Mutate one resolved structuredData field or node without hand-building a JSON Pointer.",
      required_inputs: ["draft_handle", "expected_revision", "match", "op"],
    },
    {
      tool: "cascade_draft_assert_values",
      reason: "Verify structuredData field values before or after draft mutation.",
      required_inputs: ["draft_handle", "assertions"],
    },
    {
      tool: "cascade_draft_validate",
      reason: "Validate the draft before submitting.",
      input: { draft_handle: entry.handle },
    },
    {
      tool: "cascade_draft_submit",
      reason: "Submit the complete draft through cascade_create or cascade_edit.",
      required_inputs: ["draft_handle", "expected_revision"],
    },
  ];
}

function createScaffoldNextActions(
  entry: DraftCacheEntry,
  requiredValuePointers: string[],
): Array<Record<string, unknown>> {
  return [
    {
      tool: "cascade_draft_apply_patch",
      reason: "Replace all null scaffold placeholders with real create values.",
      required_inputs: ["draft_handle", "expected_revision", "operations"],
      input: {
        draft_handle: entry.handle,
        expected_revision: entry.revision,
      },
      placeholder_paths: requiredValuePointers,
    },
    {
      tool: "cascade_draft_validate",
      reason: "Validate the create draft after placeholders are replaced.",
      input: { draft_handle: entry.handle },
    },
    {
      tool: "cascade_draft_submit",
      reason: "Submit the complete create draft through cascade_create.",
      required_inputs: ["draft_handle", "expected_revision"],
    },
  ];
}

function createScaffoldFromAssetNextActions(
  entry: DraftCacheEntry,
  scaffold: CreateScaffoldFromAsset,
): Array<Record<string, unknown>> {
  return [
    {
      tool: "cascade_draft_apply_patch",
      reason: "Fill cleared scaffold values before validation, including structured-data values and credential placeholders. Use replace for replace_value_pointers and add for add_value_pointers.",
      required_inputs: ["draft_handle", "expected_revision", "operations"],
      input: {
        draft_handle: entry.handle,
        expected_revision: entry.revision,
      },
      replace_value_pointers: scaffold.replace_value_pointers,
      add_value_pointers: scaffold.add_value_pointers,
    },
    {
      tool: "cascade_draft_validate",
      reason: "Validate the create draft after cleared values are filled.",
      input: { draft_handle: entry.handle },
    },
    {
      tool: "cascade_draft_submit",
      reason: "Submit the complete create draft through cascade_create.",
      required_inputs: ["draft_handle", "expected_revision"],
    },
  ];
}
