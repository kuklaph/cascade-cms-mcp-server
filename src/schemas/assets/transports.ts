/**
 * Transport asset schemas — FileSystem, FTP, Database, and Cloud transports.
 *
 * Each transport defines how Cascade pushes published output to a remote
 * destination. All extend `ContaineredAsset` (they live in the admin area,
 * not a site's folder tree).
 */

import { z } from "zod";
import { ContaineredAssetFields } from "./base.js";
import { AuthModeSchema, FtpProtocolTypeSchema } from "./enums.js";

// ─── FileSystemTransport (envelope: `fileSystemTransport`) ─────────────────

export const FileSystemTransportAssetSchema = z
  .object({
    ...ContaineredAssetFields,
    directory: z.string().describe("REQUIRED: Target directory on the local filesystem."),
  })
  .strict()
  .describe("Filesystem transport — writes published output to a local path.");

export type FileSystemTransportAsset = z.infer<typeof FileSystemTransportAssetSchema>;

export const FileSystemTransportEnvelopeSchema = z
  .object({
    fileSystemTransport: FileSystemTransportAssetSchema.describe("Filesystem transport payload."),
  })
  .strict();

// ─── FtpTransport (envelope: `ftpTransport`) ───────────────────────────────

export const FtpTransportAssetSchema = z
  .object({
    ...ContaineredAssetFields,
    hostName: z.string().describe("REQUIRED: FTP/SFTP host name."),
    port: z.number().describe("REQUIRED: Port number."),
    doPASV: z
      .boolean()
      .optional()
      .describe("Use PASV mode. Only meaningful for FTP/FTPS."),
    username: z.string().describe("REQUIRED: Login username."),
    authMode: AuthModeSchema.optional().describe(
      "SFTP authentication mode. REQUIRED when ftpProtocolType='SFTP'. 'PASSWORD' or 'PUBLIC_KEY'.",
    ),
    privateKey: z
      .string()
      .optional()
      .describe("SFTP private key. REQUIRED when authMode='PUBLIC_KEY'."),
    password: z
      .string()
      .optional()
      .describe(
        "Password. REQUIRED for FTP/FTPS, or for SFTP with authMode='PASSWORD'.",
      ),
    directory: z
      .string()
      .optional()
      .describe("Remote directory path (relative to the login root)."),
    ftpProtocolType: FtpProtocolTypeSchema.describe(
      "REQUIRED: Protocol variant — 'FTP', 'FTPS', or 'SFTP'.",
    ),
  })
  .strict()
  .describe("FTP / FTPS / SFTP transport.");

export type FtpTransportAsset = z.infer<typeof FtpTransportAssetSchema>;

export const FtpTransportEnvelopeSchema = z
  .object({
    ftpTransport: FtpTransportAssetSchema.describe("FTP transport payload."),
  })
  .strict();

// ─── DatabaseTransport (envelope: `databaseTransport`) ─────────────────────

export const DatabaseTransportAssetSchema = z
  .object({
    ...ContaineredAssetFields,
    transportSiteId: z
      .number()
      .describe("REQUIRED: Cascade-side site id this transport is bound to."),
    serverName: z.string().describe("REQUIRED: Database server host name."),
    serverPort: z.number().describe("REQUIRED: Database server port."),
    databaseName: z.string().describe("REQUIRED: Target database name."),
    username: z.string().describe("REQUIRED: Database login username."),
    password: z.string().optional().describe("Database login password."),
  })
  .strict()
  .describe("Database transport — writes published output into a relational database.");

export type DatabaseTransportAsset = z.infer<typeof DatabaseTransportAssetSchema>;

export const DatabaseTransportEnvelopeSchema = z
  .object({
    databaseTransport: DatabaseTransportAssetSchema.describe("Database transport payload."),
  })
  .strict();

// ─── CloudTransport (envelope: `cloudTransport`) ───────────────────────────

export const CloudTransportAssetSchema = z
  .object({
    ...ContaineredAssetFields,
    key: z.string().describe("REQUIRED: Cloud access key (e.g. S3 access key id)."),
    secret: z.string().describe("REQUIRED: Cloud secret (e.g. S3 secret access key)."),
    bucketName: z.string().describe("REQUIRED: Bucket / container name."),
    basePath: z.string().optional().describe("Optional prefix within the bucket."),
  })
  .strict()
  .describe("Cloud transport — writes published output to S3-compatible storage.");

export type CloudTransportAsset = z.infer<typeof CloudTransportAssetSchema>;

export const CloudTransportEnvelopeSchema = z
  .object({
    cloudTransport: CloudTransportAssetSchema.describe("Cloud transport payload."),
  })
  .strict();
