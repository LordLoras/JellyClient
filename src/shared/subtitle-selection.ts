export interface SubtitleCandidate {
  id: number;
  language: string | null;
  title: string | null;
  isDefault: boolean;
  isForced: boolean;
}

const LANGUAGE_ALIASES: Record<string, string[]> = {
  eng: ['en', 'eng', 'english'],
  bul: ['bg', 'bul', 'bulgarian'],
  spa: ['es', 'spa', 'spanish'],
  deu: ['de', 'deu', 'ger', 'german'],
  fra: ['fr', 'fra', 'fre', 'french'],
  ita: ['it', 'ita', 'italian'],
  jpn: ['ja', 'jpn', 'japanese'],
  kor: ['ko', 'kor', 'korean'],
  zho: ['zh', 'zho', 'chi', 'chinese']
};

export function choosePreferredSubtitle(
  candidates: SubtitleCandidate[],
  preferredLanguage: string
): SubtitleCandidate | null {
  const aliases = languageAliases(preferredLanguage);
  const ranked = candidates
    .map((candidate, order) => ({
      candidate,
      order,
      score: subtitleScore(candidate, aliases)
    }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) =>
      right.score - left.score || left.order - right.order
    );
  return ranked[0]?.candidate ?? null;
}

export function languageAliases(language: string): string[] {
  const normalized = normalize(language);
  const canonical = Object.entries(LANGUAGE_ALIASES).find(
    ([code, aliases]) => code === normalized || aliases.includes(normalized)
  );
  return canonical
    ? [...new Set([canonical[0], ...canonical[1]])]
    : [normalized];
}

export function mpvLanguagePriority(language: string): string {
  return languageAliases(language).join(',');
}

function subtitleScore(
  candidate: SubtitleCandidate,
  aliases: string[]
): number {
  const language = normalize(candidate.language ?? '');
  const title = normalize(candidate.title ?? '');
  const languageMatch = aliases.includes(language);
  const titleMatch = aliases.some((alias) =>
    alias.length > 2 && title.includes(alias)
  );
  if (!languageMatch && !titleMatch) return -1;

  let score = languageMatch ? 100 : 70;
  if (candidate.isDefault) score += 20;
  if (!candidate.isForced) score += 10;
  if (/\b(commentary|director|descriptive)\b/.test(title)) score -= 40;
  return score;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '-');
}
