import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models/base-item-dto.js';
import { BaseItemKind } from '@jellyfin/sdk/lib/generated-client/models/base-item-kind.js';

export function isVisibleCatalogItem(item: BaseItemDto): boolean {
  if (item.Type !== BaseItemKind.Folder) return true;

  const playableDescendantCount =
    item.RecursiveItemCount ?? item.ChildCount;

  return playableDescendantCount === null ||
    playableDescendantCount === undefined ||
    playableDescendantCount > 0;
}
