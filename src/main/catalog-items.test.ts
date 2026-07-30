import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto.js';
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind.js';
import {
  describe,
  expect,
  it
} from 'vitest';
import { isVisibleCatalogItem } from './catalog-items.js';

function item(overrides: Partial<BaseItemDto>): BaseItemDto {
  return {
    Id: 'fixture-item',
    Name: 'Fixture item',
    ...overrides
  };
}

describe('catalog item visibility', () => {
  it('hides a generic folder with no playable descendants', () => {
    expect(isVisibleCatalogItem(item({
      Type: BaseItemKind.Folder,
      RecursiveItemCount: 0
    }))).toBe(false);
  });

  it('falls back to the direct child count when needed', () => {
    expect(isVisibleCatalogItem(item({
      Type: BaseItemKind.Folder,
      ChildCount: 0
    }))).toBe(false);
  });

  it('keeps folders that contain playable descendants', () => {
    expect(isVisibleCatalogItem(item({
      Type: BaseItemKind.Folder,
      RecursiveItemCount: 1
    }))).toBe(true);
  });

  it('keeps folders when an older server omits both counts', () => {
    expect(isVisibleCatalogItem(item({
      Type: BaseItemKind.Folder
    }))).toBe(true);
  });

  it('never hides a playable media item because its child count is zero', () => {
    expect(isVisibleCatalogItem(item({
      Type: BaseItemKind.Movie,
      RecursiveItemCount: 0,
      ChildCount: 0
    }))).toBe(true);
  });
});
