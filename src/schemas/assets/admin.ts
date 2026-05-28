/**
 * Admin-area asset schemas — User, Group, Role, plus the
 * `GlobalAbilities` / `SiteAbilities` bags that roles carry.
 *
 * These types have unusual inheritance:
 *   - `User` has NO inheritance — standalone object (no `id` field in spec).
 *   - `Group` extends `BaseAsset` ONLY (uses `groupName`, not `name`).
 *   - `Role` extends `NamedAsset`.
 *
 * Ability fields are all booleans, all optional, all default false — kept
 * as `.strict()` objects so unknown ability names are rejected (matches
 * Cascade's current API surface; update when new abilities are added).
 */

import { z } from "zod";
import { BaseAssetFields, NamedAssetFields } from "./base.js";
import { UserAuthTypeSchema } from "./enums.js";

// ─── User (envelope: `user`) ────────────────────────────────────────────────
// User has no inherited BaseAsset. `id` is NOT declared.

export const UserAssetSchema = z
  .object({
    username: z.string().describe("REQUIRED: Login username."),
    fullName: z
      .string()
      .describe("REQUIRED: Full name."),
    email: z
      .string()
      .describe("REQUIRED: Email address."),
    authType: UserAuthTypeSchema.describe(
      "REQUIRED: Auth mode — 'normal', 'ldap', or 'custom'.",
    ),
    password: z
      .string()
      .describe(
        "REQUIRED: Password. Ignored when authType is 'custom'. Cascade stores hashed; write-only.",
      ),
    enabled: z.boolean().optional().describe("Whether the account is enabled. Default false."),
    groups: z
      .string()
      .describe("REQUIRED: Semicolon-delimited list of group names the user belongs to."),
    roles: z.string().describe("REQUIRED: Semicolon-delimited role names assigned to the user."),
    defaultSiteId: z
      .string()
      .optional()
      .describe("Default site id the user lands in. Priority: defaultSiteId > defaultSiteName."),
    defaultSiteName: z
      .string()
      .optional()
      .describe("Default site name (alt)."),
    ldapDN: z
      .string()
      .optional()
      .describe("LDAP distinguished name. REQUIRED when authType='ldap'."),
  })
  .strict()
  .describe("Cascade user account.");

export type UserAsset = z.infer<typeof UserAssetSchema>;

export const UserEnvelopeSchema = z
  .object({
    user: UserAssetSchema.describe("User payload."),
  })
  .strict();

// ─── Group (envelope: `group`) ──────────────────────────────────────────────
// Group extends BaseAsset ONLY — uses `groupName` instead of `name`.

export const GroupAssetSchema = z
  .object({
    ...BaseAssetFields,
    groupName: z.string().describe("REQUIRED: Group name (unique)."),
    users: z
      .string()
      .optional()
      .describe("Semicolon-delimited list of usernames belonging to this group."),
    role: z.string().describe("REQUIRED: Role name assigned to this group."),
  })
  .strict()
  .describe("Cascade security group.");

export type GroupAsset = z.infer<typeof GroupAssetSchema>;

export const GroupEnvelopeSchema = z
  .object({
    group: GroupAssetSchema.describe("Group payload."),
  })
  .strict();

// ─── GlobalAbilities (nested schema on Role) ────────────────────────────────

/** Helper — a boolean ability flag, optional, defaults to false server-side. */
const ability = (description: string) =>
  z.boolean().optional().describe(description);

export const GlobalAbilitiesSchema = z
  .object({
    bypassAllPermissionsChecks: ability("Bypass all permissions checks."),
    accessSiteManagement: ability("Access the Site Management area."),
    createSites: ability("Create new sites."),
    editAccessRights: ability("Edit access rights on any asset."),
    accessAudits: ability("Access audit logs system-wide."),
    accessAllSites: ability("Access every site regardless of membership."),
    viewSystemInfoAndLogs: ability("View system info and logs."),
    forceLogout: ability("Forcibly log users out."),
    diagnosticTests: ability("Run diagnostic tests."),
    accessSecurityArea: ability("Access the Security administration area."),
    optimizeDatabase: ability("Run database optimization."),
    syncLdap: ability("Trigger an LDAP sync."),
    configureLogging: ability("Configure system logging."),
    searchingIndexing: ability("Manage search indexing."),
    accessConfiguration: ability("Access system configuration."),
    editSystemPreferences: ability("Edit system preferences."),
    broadcastMessages: ability("Send broadcast messages to users."),
    viewUsersInMemberGroups: ability("View users in groups the caller is a member of."),
    viewAllUsers: ability("View all users."),
    createUsers: ability("Create new users."),
    deleteUsersInMemberGroups: ability("Delete users in member groups."),
    deleteAllUsers: ability("Delete any user."),
    viewMemberGroups: ability("View groups the caller is a member of."),
    viewAllGroups: ability("View all groups."),
    createGroups: ability("Create new groups."),
    deleteMemberGroups: ability("Delete groups the caller is a member of."),
    accessRoles: ability("Access the Roles management area."),
    createRoles: ability("Create new roles."),
    deleteAnyGroup: ability("Delete any group."),
    editAnyUser: ability("Edit any user."),
    editUsersInMemberGroups: ability("Edit users in member groups."),
    editAnyGroup: ability("Edit any group."),
    editMemberGroups: ability("Edit member groups."),
    databaseExportTool: ability("Use the database export tool."),
    changeIdentity: ability("Change identity (act as another user)."),
    accessDefaultEditorConfiguration: ability("Access the default editor configuration."),
    modifyDictionary: ability("Modify the spell-check dictionary."),
  })
  .strict()
  .describe("Global (system-wide) abilities. Applies when Role.roleType='global'.");

export type GlobalAbilities = z.infer<typeof GlobalAbilitiesSchema>;

// ─── SiteAbilities (nested schema on Role) ──────────────────────────────────

export const SiteAbilitiesSchema = z
  .object({
    bypassAllPermissionsChecks: ability("Bypass all permissions checks within the site."),
    uploadImagesFromWysiwyg: ability("Upload images directly from the WYSIWYG editor."),
    multiSelectCopy: ability("Copy multiple assets in one action."),
    multiSelectPublish: ability("Publish multiple assets in one action."),
    multiSelectMove: ability("Move multiple assets in one action."),
    multiSelectDelete: ability("Delete multiple assets in one action."),
    editPageLevelConfigurations: ability("Edit page-level configuration overrides."),
    editPageContentType: ability("Change a page's content type."),
    editDataDefinition: ability("Edit data definitions."),
    publishReadableHomeAssets: ability("Publish home-folder assets the user can read."),
    publishWritableHomeAssets: ability("Publish home-folder assets the user can write."),
    editAccessRights: ability("Edit access rights on site assets."),
    viewVersions: ability("View asset versions."),
    activateDeleteVersions: ability("Activate or delete asset versions."),
    accessAudits: ability("Access site audit logs."),
    bypassWorkflow: ability("Bypass workflow requirements."),
    assignApproveWorkflowSteps: ability("Assign or approve workflow steps."),
    deleteWorkflows: ability("Delete active workflows."),
    breakLocks: ability("Break locks on checked-out assets."),
    assignWorkflowsToFolders: ability("Assign workflow definitions to folders."),
    bypassAssetFactoryGroupsNewMenu: ability("Bypass asset-factory group restrictions in the New menu."),
    bypassDestinationGroupsWhenPublishing: ability("Bypass destination group restrictions during publish."),
    bypassWorkflowDefintionGroupsForFolders: ability("Bypass workflow-definition group restrictions for folders."),
    accessManageSiteArea: ability("Access the Manage Site administration area."),
    accessAssetFactories: ability("Access the Asset Factories area."),
    accessConfigurationSets: ability("Access Page Configuration Sets."),
    accessDataDefinitions: ability("Access Data Definitions."),
    accessSharedFields: ability("Access Shared Fields."),
    accessMetadataSets: ability("Access Metadata Sets."),
    accessPublishSets: ability("Access Publish Sets."),
    accessDestinations: ability("Access Destinations."),
    accessTransports: ability("Access Transports."),
    accessWorkflowDefinitions: ability("Access Workflow Definitions."),
    accessWorkflowEmails: ability("Access Workflow Emails."),
    accessContentTypes: ability("Access Content Types."),
    accessConnectors: ability("Access Connectors."),
    publishReadableAdminAreaAssets: ability("Publish admin-area assets the user can read."),
    publishWritableAdminAreaAssets: ability("Publish admin-area assets the user can write."),
    importZipArchive: ability("Import assets from a zip archive."),
    bulkChange: ability("Apply bulk changes."),
    recycleBinViewRestoreUserAssets: ability("View/restore own recycled assets."),
    recycleBinDeleteAssets: ability("Hard-delete assets from the recycle bin."),
    recycleBinViewRestoreAllAssets: ability("View/restore any recycled asset."),
    moveRenameAssets: ability("Move and rename assets."),
    diagnosticTests: ability("Run site-level diagnostic tests."),
    alwaysAllowedToToggleDataChecks: ability("Always allowed to toggle data checks."),
    viewPublishQueue: ability("View the publish queue."),
    reorderPublishQueue: ability("Reorder the publish queue."),
    cancelPublishJobs: ability("Cancel publish jobs."),
    sendStaleAssetNotifications: ability("Trigger stale-asset notifications."),
    brokenLinkReportAccess: ability("Access the broken-link report."),
    brokenLinkReportMarkFixed: ability("Mark broken links as fixed."),
    accessEditorConfigurations: ability("Access Editor Configurations."),
    bypassWysiwygEditorRestrictions: ability("Bypass WYSIWYG editor restrictions."),
    accessSiteImproveIntegration: ability("Access SiteImprove integration."),
  })
  .strict()
  .describe("Per-site abilities. Applies when Role.roleType='site'.");

export type SiteAbilities = z.infer<typeof SiteAbilitiesSchema>;

// ─── Role (envelope: `role`) ────────────────────────────────────────────────

export const RoleAssetSchema = z
  .union([
    z
      .object({
        ...NamedAssetFields,
        roleType: z.literal("global").describe("REQUIRED: Global role scope."),
        globalAbilities: GlobalAbilitiesSchema.describe(
          "REQUIRED for global roles.",
        ),
      })
      .strict(),
    z
      .object({
        ...NamedAssetFields,
        roleType: z.literal("site").describe("REQUIRED: Site role scope."),
        siteAbilities: SiteAbilitiesSchema.describe("REQUIRED for site roles."),
      })
      .strict(),
  ])
  .describe("Cascade role — a named bundle of abilities granted to users/groups.");

export type RoleAsset = z.infer<typeof RoleAssetSchema>;

export const RoleEnvelopeSchema = z
  .object({
    role: RoleAssetSchema.describe("Role payload."),
  })
  .strict();
