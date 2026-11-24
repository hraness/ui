/** Plain searchable metadata, independent of rendering or the active selection. */
export interface SelectSearchText {
  readonly label: string;
  readonly keywords?: readonly string[];
  readonly description?: string;
}

function fold(text: string): string {
  return text
    .normalize("NFKD")
    .toUpperCase()
    .toLowerCase()
    .replace(/ς/gu, "σ")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** One insertion, deletion, replacement or adjacent transposition in a complete word. */
function near(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 2) return false;
  const first = Array.from(a),
    second = Array.from(b);
  const [short, long] = first.length <= second.length ? [first, second] : [second, first];
  if (long.length - short.length > 1) return false;
  let i = 0;
  while (i < short.length && short[i] === long[i]) i++;
  if (short.length !== long.length) return short.slice(i).join("") === long.slice(i + 1).join("");
  return (
    short.slice(i + 1).join("") === long.slice(i + 1).join("") ||
    (short[i] === long[i + 1] &&
      short[i + 1] === long[i] &&
      short.slice(i + 2).join("") === long.slice(i + 2).join(""))
  );
}

function wordCost(term: string, word: string): number {
  if (term === word) return 0;
  if (word.startsWith(term)) return 1;
  const offset = word.indexOf(term);
  if (offset >= 0) return 3 + Math.min(offset, 10) / 20;
  if (term.length < 3) return Infinity;
  let first = -1;
  let end = -1;
  for (const character of term) {
    end = word.indexOf(character, end + 1);
    if (end < 0) break;
    if (first < 0) first = end;
  }
  if (end >= 0 && end - first + 1 <= term.length * 3) {
    return 5 + (end - first + 1 - term.length) / term.length;
  }
  return term.length >= 4 && near(term, word) ? 8 : Infinity;
}

/** Rank names, aliases and descriptions. Equal scores stay in the caller's order. */
export function rankSelectOptions<T extends SelectSearchText>(
  options: readonly T[],
  query: string,
): T[] {
  const spelling = query.trim().normalize("NFC").toLowerCase();
  const phrase = fold(query);
  if (!phrase) return [...options];
  const terms = phrase.split(" ");
  const matches: { option: T; score: number }[] = [];
  for (const option of options) {
    const label = fold(option.label);
    const aliases = (option.keywords ?? []).map(fold);
    const fields = [
      { words: label.split(" "), weight: 0 },
      { words: aliases.flatMap((a) => a.split(" ")), weight: 0.75 },
      { words: fold(option.description ?? "").split(" "), weight: 2 },
    ];
    let score =
      label === phrase ? -5 : aliases.includes(phrase) ? -3 : label.startsWith(phrase) ? -1 : 0;
    if (option.label.normalize("NFC").toLowerCase() === spelling) score -= 1;
    for (const term of terms) {
      let best = Infinity;
      for (const { words, weight } of fields) {
        for (const word of words) best = Math.min(best, weight + wordCost(term, word));
      }
      score += best;
      if (!Number.isFinite(score)) break;
    }
    if (Number.isFinite(score)) matches.push({ option, score });
  }
  return matches.sort((a, b) => a.score - b.score).map((match) => match.option);
}
