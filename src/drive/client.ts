import { drive_v3 } from 'googleapis';
import { DriveSyncError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

type Drive = drive_v3.Drive;

/** Minimal representation of a Drive file for sync purposes. */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
}

/** Represents a change event from the Drive Changes API. */
export interface DriveChange {
  fileId: string;
  file: DriveFile | null;
  removed: boolean;
}

/** MIME types we support for text extraction. */
const SUPPORTED_MIME_TYPES = [
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.spreadsheet',
  'text/plain',
  'text/markdown',
  'text/csv',
];

const MIME_QUERY = SUPPORTED_MIME_TYPES.map((m) => `mimeType='${m}'`).join(' or ');

/**
 * List files from Google Drive filtered to supported text-extractable types.
 * Supports pagination via pageToken.
 */
export async function listFiles(
  drive: Drive,
  pageToken?: string,
): Promise<{ files: DriveFile[]; nextPageToken: string | null }> {
  try {
    const res = await drive.files.list({
      q: `(${MIME_QUERY}) and trashed=false`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime)',
      pageSize: 100,
      pageToken: pageToken ?? undefined,
    });

    const files: DriveFile[] = (res.data.files ?? []).map((f) => ({
      id: f.id!,
      name: f.name!,
      mimeType: f.mimeType!,
      modifiedTime: f.modifiedTime!,
    }));

    logger.info({ fileCount: files.length, hasMore: !!res.data.nextPageToken }, 'drive.client.listFiles');

    return {
      files,
      nextPageToken: res.data.nextPageToken ?? null,
    };
  } catch (error) {
    throw new DriveSyncError('Failed to list Drive files', error);
  }
}

/**
 * Export a Google Drive file as text content.
 * - Google Docs → exported as text/plain
 * - Google Sheets → exported as text/csv
 * - Plain text / markdown / CSV files → downloaded directly via media
 */
export async function exportFileAsText(
  drive: Drive,
  fileId: string,
  mimeType: string,
): Promise<string> {
  try {
    if (mimeType === 'application/vnd.google-apps.document') {
      const res = await drive.files.export({
        fileId,
        mimeType: 'text/plain',
      });
      return String(res.data);
    }

    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      const res = await drive.files.export({
        fileId,
        mimeType: 'text/csv',
      });
      return String(res.data);
    }

    // Direct download for text/plain, text/markdown, text/csv
    const res = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'text' },
    );
    return String(res.data);
  } catch (error) {
    throw new DriveSyncError(`Failed to export file ${fileId} (${mimeType})`, error);
  }
}

/**
 * Get the start page token for the Drive Changes API.
 * Used to establish an incremental sync baseline.
 */
export async function getStartPageToken(drive: Drive): Promise<string> {
  try {
    const res = await drive.changes.getStartPageToken();
    const token = res.data.startPageToken;
    if (!token) {
      throw new DriveSyncError('Drive API returned no startPageToken');
    }
    logger.info({ startPageToken: token }, 'drive.client.getStartPageToken');
    return token;
  } catch (error) {
    if (error instanceof DriveSyncError) throw error;
    throw new DriveSyncError('Failed to get Drive start page token', error);
  }
}

/**
 * Fetch changes from the Drive Changes API since a given page token.
 * Returns changed files and the new token for subsequent calls.
 */
export async function getChanges(
  drive: Drive,
  startPageToken: string,
): Promise<{ changes: DriveChange[]; newStartPageToken: string }> {
  try {
    const res = await drive.changes.list({
      pageToken: startPageToken,
      fields: 'newStartPageToken, nextPageToken, changes(fileId, file(id, name, mimeType, modifiedTime), removed)',
      spaces: 'drive',
      includeRemoved: true,
    });

    const changes: DriveChange[] = (res.data.changes ?? []).map((c) => ({
      fileId: c.fileId!,
      file: c.file
        ? {
            id: c.file.id!,
            name: c.file.name!,
            mimeType: c.file.mimeType!,
            modifiedTime: c.file.modifiedTime!,
          }
        : null,
      removed: c.removed ?? false,
    }));

    const newStartPageToken = res.data.newStartPageToken ?? startPageToken;

    logger.info({ changeCount: changes.length, newStartPageToken }, 'drive.client.getChanges');

    return { changes, newStartPageToken };
  } catch (error) {
    throw new DriveSyncError('Failed to get Drive changes', error);
  }
}
