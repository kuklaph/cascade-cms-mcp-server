/**
 * Connector asset schemas — Facebook, WordPress, and Google Analytics connectors.
 *
 * All extend the generated `Connector` type, which itself extends
 * `ContaineredAsset`. Facebook additionally follows the generated
 * `StatusUpdateConnector` shape with destination fields.
 */

import { z } from "zod";
import { ContaineredAssetFields } from "./base.js";

// ─── Nested: ConnectorParameter ─────────────────────────────────────────────

const ConnectorParameterSchema = z
  .object({
    name: z
      .string()
      .describe("REQUIRED: Parameter name."),
    value: z
      .string()
      .describe("REQUIRED: Parameter value."),
  })
  .strict();

// ─── Nested: ConnectorContentTypeLinkParam ─────────────────────────────────

const ConnectorContentTypeLinkParamSchema = z
  .object({
    name: z.string().optional().describe("Optional param name."),
    value: z.string().describe("REQUIRED: Param value."),
  })
  .strict();

// ─── Nested: ConnectorContentTypeLink ──────────────────────────────────────

const ConnectorContentTypeLinkSchema = z
  .union([
    z
      .object({
        contentTypeId: z.string().describe("Linked content type id. Priority: id > path."),
        contentTypePath: z.string().optional().describe("Linked content type path (alt)."),
        pageConfigurationId: z.string().optional().describe("Page configuration id used for publishing."),
        pageConfigurationName: z.string().optional().describe("Page configuration name (alt)."),
        connectorContentTypeLinkParams: z
          .array(ConnectorContentTypeLinkParamSchema)
          .optional()
          .describe("Per-link parameters."),
      })
      .strict(),
    z
      .object({
        contentTypeId: z.string().optional().describe("Linked content type id. Priority: id > path."),
        contentTypePath: z.string().describe("Linked content type path (alt)."),
        pageConfigurationId: z.string().optional().describe("Page configuration id used for publishing."),
        pageConfigurationName: z.string().optional().describe("Page configuration name (alt)."),
        connectorContentTypeLinkParams: z
          .array(ConnectorContentTypeLinkParamSchema)
          .optional()
          .describe("Per-link parameters."),
      })
      .strict(),
  ])
  .describe("Connector content type link. Requires contentTypeId or contentTypePath.");

// ─── Connector (abstract) — shared fields ──────────────────────────────────

const ConnectorFields = {
  ...ContaineredAssetFields,
  auth1: z
    .string()
    .optional()
    .describe("First auth token — often username, email, or OAuth key."),
  auth2: z
    .string()
    .optional()
    .describe("Second auth token — often password or OAuth secret. Write-only; hidden on read."),
  url: z
    .string()
    .optional()
    .describe("Connector endpoint URL."),
  verified: z
    .boolean()
    .optional()
    .describe("Read-only: whether the connector has been successfully verified."),
  verifiedDate: z
    .string()
    .optional()
    .describe("Read-only: timestamp of last successful verification."),
  connectorParameters: z
    .array(ConnectorParameterSchema)
    .optional()
    .describe("Connector-specific parameters (name/value pairs)."),
  connectorContentTypeLinks: z
    .array(ConnectorContentTypeLinkSchema)
    .optional()
    .describe(
      "Content-type links. Required for WordPressConnector; optional for FacebookConnector and GoogleAnalyticsConnector. Cascade may enforce additional connector-specific rules server-side.",
    ),
};

// ─── FacebookConnector (envelope: `facebookConnector`) ─────────────────────

export const FacebookConnectorAssetSchema = z
  .union([
    z
      .object({
        ...ConnectorFields,
        destinationId: z.string().describe("Destination id. Priority: id > path."),
        destinationPath: z.string().optional().describe("Destination path (alt)."),
      })
      .strict(),
    z
      .object({
        ...ConnectorFields,
        destinationId: z.string().optional().describe("Destination id. Priority: id > path."),
        destinationPath: z.string().describe("Destination path (alt)."),
      })
      .strict(),
  ])
  .describe("Facebook connector.");

export type FacebookConnectorAsset = z.infer<typeof FacebookConnectorAssetSchema>;

export const FacebookConnectorEnvelopeSchema = z
  .object({
    facebookConnector: FacebookConnectorAssetSchema.describe("Facebook connector payload."),
  })
  .strict();

// ─── WordPressConnector (envelope: `wordPressConnector`) ───────────────────

export const WordPressConnectorAssetSchema = z
  .object({
    ...ConnectorFields,
    connectorContentTypeLinks: z
      .array(ConnectorContentTypeLinkSchema)
      .describe("REQUIRED: Content-type links for this connector."),
  })
  .strict()
  .describe("WordPress connector — pushes content to a WordPress site.");

export type WordPressConnectorAsset = z.infer<typeof WordPressConnectorAssetSchema>;

export const WordPressConnectorEnvelopeSchema = z
  .object({
    wordPressConnector: WordPressConnectorAssetSchema.describe("WordPress connector payload."),
  })
  .strict();

// ─── GoogleAnalyticsConnector (envelope: `googleAnalyticsConnector`) ───────

export const GoogleAnalyticsConnectorAssetSchema = z
  .object({ ...ConnectorFields })
  .strict()
  .describe("Google Analytics connector — pulls analytics data into Cascade.");

export type GoogleAnalyticsConnectorAsset = z.infer<typeof GoogleAnalyticsConnectorAssetSchema>;

export const GoogleAnalyticsConnectorEnvelopeSchema = z
  .object({
    googleAnalyticsConnector: GoogleAnalyticsConnectorAssetSchema.describe(
      "Google Analytics connector payload.",
    ),
  })
  .strict();
