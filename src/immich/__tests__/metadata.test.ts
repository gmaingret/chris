import { describe, it, expect } from 'vitest';
import { assetToText } from '../metadata.js';
import type { ImmichAsset } from '../client.js';

function makeFullAsset(): ImmichAsset {
  return {
    id: 'asset-1',
    type: 'IMAGE',
    originalFileName: 'IMG_1234.jpg',
    exifInfo: {
      city: 'Nice',
      state: "Provence-Alpes-Côte d'Azur",
      country: 'France',
      dateTimeOriginal: '2024-07-15T18:30:00.000Z',
      description: 'Sunset over the Promenade des Anglais',
      latitude: 43.7102,
      longitude: 7.262,
      make: 'Apple',
      model: 'iPhone 15 Pro',
    },
    people: [
      { id: 'p1', name: 'John' },
      { id: 'p2', name: 'Sophie' },
    ],
  };
}

describe('assetToText', () => {
  it('renders all fields when present', () => {
    const text = assetToText(makeFullAsset());

    expect(text).toContain('Photo: IMG_1234.jpg');
    expect(text).toContain('Date: 2024-07-15');
    expect(text).toContain("Location: Nice, Provence-Alpes-Côte d'Azur, France (43.7102, 7.262)");
    expect(text).toContain('People: John, Sophie');
    expect(text).toContain('Camera: Apple iPhone 15 Pro');
    expect(text).toContain('Description: Sunset over the Promenade des Anglais');
  });

  it('shows "Video:" for video assets', () => {
    const asset = makeFullAsset();
    asset.type = 'VIDEO';
    asset.originalFileName = 'MOV_5678.mp4';

    const text = assetToText(asset);
    expect(text).toMatch(/^Video: MOV_5678\.mp4/);
    expect(text).not.toContain('Photo:');
  });

  it('omits Location line when all location fields are null', () => {
    const asset = makeFullAsset();
    asset.exifInfo = {
      ...asset.exifInfo,
      city: null,
      state: null,
      country: null,
      latitude: null,
      longitude: null,
    };

    const text = assetToText(asset);
    expect(text).not.toContain('Location:');
  });

  it('renders location with city only', () => {
    const asset = makeFullAsset();
    asset.exifInfo = {
      ...asset.exifInfo,
      city: 'Paris',
      state: null,
      country: null,
      latitude: null,
      longitude: null,
    };

    const text = assetToText(asset);
    expect(text).toContain('Location: Paris');
    expect(text).not.toContain('(');
  });

  it('renders location with country only', () => {
    const asset = makeFullAsset();
    asset.exifInfo = {
      ...asset.exifInfo,
      city: null,
      state: null,
      country: 'Japan',
      latitude: 35.6762,
      longitude: 139.6503,
    };

    const text = assetToText(asset);
    expect(text).toContain('Location: Japan (35.6762, 139.6503)');
  });

  it('omits People line when people array is empty', () => {
    const asset = makeFullAsset();
    asset.people = [];

    const text = assetToText(asset);
    expect(text).not.toContain('People:');
  });

  it('omits People line when people have no names', () => {
    const asset = makeFullAsset();
    asset.people = [{ id: 'p1', name: '' }];

    const text = assetToText(asset);
    expect(text).not.toContain('People:');
  });

  it('omits Description line when description is null', () => {
    const asset = makeFullAsset();
    asset.exifInfo = { ...asset.exifInfo, description: null };

    const text = assetToText(asset);
    expect(text).not.toContain('Description:');
  });

  it('omits Camera line when make and model are null', () => {
    const asset = makeFullAsset();
    asset.exifInfo = { ...asset.exifInfo, make: null, model: null };

    const text = assetToText(asset);
    expect(text).not.toContain('Camera:');
  });

  it('renders Camera with make only', () => {
    const asset = makeFullAsset();
    asset.exifInfo = { ...asset.exifInfo, make: 'Canon', model: null };

    const text = assetToText(asset);
    expect(text).toContain('Camera: Canon');
  });

  it('handles missing exifInfo entirely', () => {
    const asset: ImmichAsset = {
      id: 'asset-x',
      type: 'IMAGE',
      originalFileName: 'unknown.jpg',
      exifInfo: null,
      people: [],
    };

    const text = assetToText(asset);
    expect(text).toBe('Photo: unknown.jpg');
    expect(text).not.toContain('Date:');
    expect(text).not.toContain('Location:');
    expect(text).not.toContain('null');
  });

  it('never outputs "null" in any field', () => {
    const asset: ImmichAsset = {
      id: 'asset-y',
      type: 'IMAGE',
      originalFileName: 'test.png',
      exifInfo: {
        city: null,
        country: null,
        state: null,
        dateTimeOriginal: null,
        description: null,
        latitude: null,
        longitude: null,
        make: null,
        model: null,
      },
      people: [],
    };

    const text = assetToText(asset);
    expect(text).not.toContain('null');
    expect(text).not.toContain('undefined');
    expect(text).toBe('Photo: test.png');
  });
});
