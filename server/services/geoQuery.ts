const SYNONYMS: Record<string, string[]> = {
  玄妙观: ['圆妙观', '元妙观'],
  圆妙观: ['玄妙观', '元妙观'],
  元妙观: ['玄妙观', '圆妙观'],
};

export function expandGeoQueryTokens(raw: string): string[] {
  const base = raw.trim();
  if (!base) return [];
  const tokens = new Set<string>([base]);
  const extras = SYNONYMS[base];
  if (extras) extras.forEach((t) => tokens.add(t));
  return Array.from(tokens);
}

export function placeMatchesQuery(place: { name: string; aliases?: string[] }, tokens: string[]) {
  if (!tokens.length) return true;
  const p = place as {
    name: string;
    aliases?: string[];
    ancientEvidence?: string;
    ancientSummary?: string;
    modernFactual?: string;
    modernInterpretation?: string;
    modernSummary?: string;
    citations?: Array<{ chapterTitle?: string; quoteText?: string }>;
  };
  const citationText = (p.citations ?? [])
    .map((c) => `${c.chapterTitle ?? ''} ${c.quoteText ?? ''}`)
    .join(' ');
  const hay = [
    p.name,
    ...(p.aliases ?? []),
    p.ancientEvidence ?? '',
    p.ancientSummary ?? '',
    p.modernFactual ?? '',
    p.modernInterpretation ?? '',
    p.modernSummary ?? '',
    citationText,
  ].join(' ');
  return tokens.some((t) => hay.includes(t));
}

export function sectionMatchesQuery(section: { title: string; content: string }, tokens: string[]) {
  if (!tokens.length) return true;
  const hay = `${section.title}\n${section.content}`;
  return tokens.some((t) => hay.includes(t));
}
