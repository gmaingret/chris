import type { ImmichAsset } from './client.js';

/**
 * Convert an Immich asset to labeled text for embedding and semantic search.
 * Omits lines for missing/null fields.
 */
export function assetToText(asset: ImmichAsset): string {
  const lines: string[] = [];

  // Type + filename
  const typeLabel = asset.type === 'VIDEO' ? 'Video' : 'Photo';
  lines.push(`${typeLabel}: ${asset.originalFileName}`);

  const exif = asset.exifInfo;

  // Date
  if (exif?.dateTimeOriginal) {
    const date = exif.dateTimeOriginal.substring(0, 10); // YYYY-MM-DD
    lines.push(`Date: ${date}`);
  }

  // Location
  const locationParts: string[] = [];
  if (exif?.city) locationParts.push(exif.city);
  if (exif?.state) locationParts.push(exif.state);
  if (exif?.country) locationParts.push(exif.country);

  if (locationParts.length > 0) {
    let locationLine = `Location: ${locationParts.join(', ')}`;
    if (exif?.latitude != null && exif?.longitude != null) {
      locationLine += ` (${exif.latitude}, ${exif.longitude})`;
    }
    lines.push(locationLine);
  }

  // People
  const namedPeople = (asset.people ?? []).filter((p) => p.name);
  if (namedPeople.length > 0) {
    lines.push(`People: ${namedPeople.map((p) => p.name).join(', ')}`);
  }

  // Camera
  const make = exif?.make;
  const model = exif?.model;
  if (make || model) {
    const camera = [make, model].filter(Boolean).join(' ');
    lines.push(`Camera: ${camera}`);
  }

  // Description
  if (exif?.description) {
    lines.push(`Description: ${exif.description}`);
  }

  return lines.join('\n');
}
