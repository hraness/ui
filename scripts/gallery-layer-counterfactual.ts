const UNION_LAYER_PREFIX = "components.hraness-stylex";
const UI_LEGACY_LAYERS = [
  "components.hraness-ui.legacy.base",
  "components.hraness-ui.legacy",
] as const;
const COUNTERFACTUAL_LAYER = "components.hraness-ui.before-legacy";
const TARGET_PRIORITY = "priority5" as const;
const MAX_PRIORITY = 64;

type Priority = `priority${number}`;

interface CssStatement {
  readonly end: number;
  readonly header: string;
  readonly kind: "statement";
  readonly start: number;
}

interface CssBlock {
  readonly close: number;
  readonly end: number;
  readonly header: string;
  readonly kind: "block";
  readonly open: number;
  readonly start: number;
}

type CssConstruct = CssBlock | CssStatement;

interface FooterRule {
  readonly conditionalDepth: number;
  readonly end: number;
  readonly layer: string | undefined;
  readonly start: number;
}

export interface QuietSiteFooterLayerCounterfactual {
  readonly css: string;
  readonly targetPriority: Priority;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function skipComment(source: string, start: number, end: number): number {
  const close = source.indexOf("*/", start + 2);
  invariant(close !== -1 && close + 2 <= end, "counterfactual CSS contains an unterminated comment");
  return close + 2;
}

function skipTrivia(source: string, start: number, end: number): number {
  let cursor = start;
  while (cursor < end) {
    const character = source[cursor];
    if (character !== undefined && /\s/u.test(character)) {
      cursor += 1;
      continue;
    }
    if (character === "/" && source[cursor + 1] === "*") {
      cursor = skipComment(source, cursor, end);
      continue;
    }
    break;
  }
  return cursor;
}

function findClosingBrace(source: string, open: number, end: number): number {
  let depth = 1;
  let escaped = false;
  let quote: "\"" | "'" | undefined;
  for (let cursor = open + 1; cursor < end; cursor += 1) {
    const character = source[cursor];
    if (character === undefined) continue;
    if (quote !== undefined) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === "/" && source[cursor + 1] === "*") {
      cursor = skipComment(source, cursor, end) - 1;
      continue;
    }
    if (character === "\"" || character === "'") quote = character;
    else if (character === "\\") cursor += 1;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  throw new Error("counterfactual CSS contains an unterminated block");
}

function scanConstructs(source: string, start: number, end: number): readonly CssConstruct[] {
  const constructs: CssConstruct[] = [];
  let cursor = start;
  while (true) {
    cursor = skipTrivia(source, cursor, end);
    if (cursor >= end) break;
    const constructStart = cursor;
    let escaped = false;
    let parentheses = 0;
    let brackets = 0;
    let quote: "\"" | "'" | undefined;
    let found = false;
    for (; cursor < end; cursor += 1) {
      const character = source[cursor];
      if (character === undefined) continue;
      if (quote !== undefined) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) quote = undefined;
        continue;
      }
      if (character === "/" && source[cursor + 1] === "*") {
        cursor = skipComment(source, cursor, end) - 1;
        continue;
      }
      if (character === "\"" || character === "'") {
        quote = character;
        continue;
      }
      if (character === "\\") {
        cursor += 1;
        continue;
      }
      if (character === "(") parentheses += 1;
      else if (character === ")") {
        parentheses -= 1;
        invariant(parentheses >= 0, "counterfactual CSS contains an unmatched parenthesis");
      } else if (character === "[") brackets += 1;
      else if (character === "]") {
        brackets -= 1;
        invariant(brackets >= 0, "counterfactual CSS contains an unmatched bracket");
      } else if (parentheses === 0 && brackets === 0 && character === ";") {
        constructs.push({
          end: cursor + 1,
          header: source.slice(constructStart, cursor).trim(),
          kind: "statement",
          start: constructStart,
        });
        cursor += 1;
        found = true;
        break;
      } else if (parentheses === 0 && brackets === 0 && character === "{") {
        const close = findClosingBrace(source, cursor, end);
        constructs.push({
          close,
          end: close + 1,
          header: source.slice(constructStart, cursor).trim(),
          kind: "block",
          open: cursor,
          start: constructStart,
        });
        cursor = close + 1;
        found = true;
        break;
      } else if (parentheses === 0 && brackets === 0 && character === "}") {
        throw new Error("counterfactual CSS contains an unmatched closing brace");
      }
    }
    invariant(found, "counterfactual CSS contains an unterminated construct");
  }
  return constructs;
}

function parseLayerNames(header: string, kind: CssConstruct["kind"]): readonly string[] | undefined {
  if (!header.startsWith("@layer")) return undefined;
  const match = /^@layer(?:\s+(.+))?$/u.exec(header);
  invariant(match !== null && match[1] !== undefined, "counterfactual CSS contains an anonymous or malformed layer");
  const names = match[1].split(",").map((name) => name.trim());
  invariant(names.length > 0 && names.every((name) => /^[A-Za-z_-][A-Za-z0-9_.-]*$/u.test(name)),
    "counterfactual CSS contains a malformed layer name");
  invariant(kind === "statement" || names.length === 1,
    "counterfactual CSS contains a multi-name layer block");
  return names;
}

function priorityForLayer(name: string): Priority | undefined {
  const match = new RegExp(`^${UNION_LAYER_PREFIX.replaceAll(".", "\\.")}\\.(priority[1-9]\\d*)$`, "u")
    .exec(name);
  return match?.[1] as Priority | undefined;
}

function isUnionLayer(name: string): boolean {
  return name === UNION_LAYER_PREFIX || name.startsWith(`${UNION_LAYER_PREFIX}.`);
}

function resolveNestedLayer(parent: string | undefined, name: string): string {
  return parent === undefined ? name : `${parent}.${name}`;
}

type AtRuleBlockKind = "declaration-list" | "keyframes" | "rule-list";

function classifyAtRuleBlock(header: string): AtRuleBlockKind {
  if (
    /^@(?:container|document|media|-moz-document|scope|supports)(?=\s|\()/u.test(header)
    || header === "@starting-style"
  ) {
    return "rule-list";
  }
  if (
    header === "@font-face"
    || /^@property\s+--[-_A-Za-z0-9]+$/u.test(header)
  ) return "declaration-list";
  if (/^@(?:-webkit-)?keyframes\s+[-_A-Za-z][-_A-Za-z0-9]*$/u.test(header)) {
    return "keyframes";
  }
  throw new Error(`counterfactual CSS contains an unsupported block at-rule: ${header}`);
}

function readAtKeyword(
  source: string,
  at: number,
  end: number,
): Readonly<{ end: number; name: string }> | undefined {
  let cursor = at + 1;
  let name = "";
  while (cursor < end) {
    const character = source[cursor];
    if (character === undefined) break;
    if (/[-_A-Za-z0-9]/u.test(character) || character.charCodeAt(0) >= 0x80) {
      name += character;
      cursor += 1;
      continue;
    }
    if (character !== "\\") break;
    const escaped = source[cursor + 1];
    invariant(
      escaped !== undefined && !/[\n\r\f]/u.test(escaped),
      "counterfactual CSS contains a malformed escaped at-keyword",
    );
    if (/[0-9A-Fa-f]/u.test(escaped)) {
      let hexEnd = cursor + 1;
      while (
        hexEnd < end
        && hexEnd < cursor + 7
        && /[0-9A-Fa-f]/u.test(source[hexEnd] ?? "")
      ) hexEnd += 1;
      const codePoint = Number.parseInt(source.slice(cursor + 1, hexEnd), 16);
      name += codePoint === 0 || codePoint > 0x10FFFF || (codePoint >= 0xD800 && codePoint <= 0xDFFF)
        ? "\uFFFD"
        : String.fromCodePoint(codePoint);
      if (/\s/u.test(source[hexEnd] ?? "")) {
        if (source[hexEnd] === "\r" && source[hexEnd + 1] === "\n") hexEnd += 1;
        hexEnd += 1;
      }
      cursor = hexEnd;
      continue;
    }
    name += escaped;
    cursor += 2;
  }
  return name.length === 0 ? undefined : { end: cursor, name };
}

function assertNoNestedLayerAtRule(
  source: string,
  start: number,
  end: number,
): void {
  let escaped = false;
  let parentheses = 0;
  let quote: "\"" | "'" | undefined;
  for (let cursor = start; cursor < end; cursor += 1) {
    const character = source[cursor];
    if (character === undefined) continue;
    if (quote !== undefined) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === "/" && source[cursor + 1] === "*") {
      cursor = skipComment(source, cursor, end) - 1;
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
      continue;
    }
    if (character === "\\") {
      cursor += 1;
      continue;
    }
    if (character === "(") parentheses += 1;
    else if (character === ")") {
      parentheses -= 1;
      invariant(parentheses >= 0, "counterfactual CSS contains an unmatched parenthesis");
    } else if (parentheses === 0 && character === "@") {
      const keyword = readAtKeyword(source, cursor, end);
      if (keyword?.name.toLowerCase() === "layer") {
        throw new Error("counterfactual CSS contains a layer nested inside a qualified rule");
      }
      if (keyword !== undefined) cursor = keyword.end - 1;
    }
  }
  invariant(quote === undefined && parentheses === 0,
    "counterfactual CSS contains an unterminated qualified rule value");
}

function splitDeclarations(body: string): readonly { readonly property: string; readonly value: string }[] {
  const segments: string[] = [];
  let cursor = 0;
  let segmentStart = 0;
  let escaped = false;
  let parentheses = 0;
  let quote: "\"" | "'" | undefined;
  while (cursor < body.length) {
    const character = body[cursor];
    if (character === undefined) {
      cursor += 1;
      continue;
    }
    if (quote !== undefined) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
    } else if (character === "/" && body[cursor + 1] === "*") {
      cursor = skipComment(body, cursor, body.length) - 1;
    } else if (character === "\"" || character === "'") quote = character;
    else if (character === "\\") cursor += 1;
    else if (character === "(") parentheses += 1;
    else if (character === ")") {
      parentheses -= 1;
      invariant(parentheses >= 0, "counterfactual target rule contains an unmatched parenthesis");
    } else if (character === ";" && parentheses === 0) {
      segments.push(body.slice(segmentStart, cursor));
      segmentStart = cursor + 1;
    }
    cursor += 1;
  }
  invariant(quote === undefined && parentheses === 0,
    "counterfactual target rule contains an unterminated value");
  segments.push(body.slice(segmentStart));
  return segments.flatMap((segment) => {
    const trimmed = segment.trim();
    if (trimmed.length === 0) return [];
    const colon = trimmed.indexOf(":");
    invariant(colon > 0, "counterfactual target rule contains a malformed declaration");
    return [{
      property: trimmed.slice(0, colon).trim(),
      value: trimmed.slice(colon + 1).trim(),
    }];
  });
}

function collectFooterRules(
  source: string,
  constructs: readonly CssConstruct[],
  layer: string | undefined,
  conditionalDepth: number,
  footerRules: FooterRule[],
): void {
  for (const construct of constructs) {
    if (construct.kind === "statement") continue;
    const layerNames = parseLayerNames(construct.header, construct.kind);
    if (layerNames !== undefined) {
      const nestedLayer = resolveNestedLayer(layer, layerNames[0]!);
      collectFooterRules(
        source,
        scanConstructs(source, construct.open + 1, construct.close),
        nestedLayer,
        conditionalDepth,
        footerRules,
      );
      continue;
    }
    if (construct.header.startsWith("@")) {
      if (classifyAtRuleBlock(construct.header) === "rule-list") {
        collectFooterRules(
          source,
          scanConstructs(source, construct.open + 1, construct.close),
          layer,
          conditionalDepth + 1,
          footerRules,
        );
      }
      continue;
    }
    const body = source.slice(construct.open + 1, construct.close);
    if (!body.includes("padding-top")) continue;
    const declarations = splitDeclarations(body);
    const targetDeclarations = declarations.filter(({ property, value }) =>
      property === "padding-top"
      && value.replace(/\s+/gu, "") === "var(--space-5,1.25rem)"
    );
    if (targetDeclarations.length === 0) continue;
    invariant(
      targetDeclarations.length === 1
        && declarations.length === 1
        && /^\.[A-Za-z0-9_-]+$/u.test(construct.header),
      "the quiet-site footer padding candidate must be one single-class atomic rule with one declaration",
    );
    footerRules.push({
      conditionalDepth,
      end: construct.end,
      layer,
      start: construct.start,
    });
  }
}

function validateNestedLayers(
  source: string,
  constructs: readonly CssConstruct[],
  parentLayer: string | undefined,
  depth = 0,
): void {
  for (const construct of constructs) {
    const names = parseLayerNames(construct.header, construct.kind);
    if (
      construct.kind === "statement"
      && construct.header.startsWith("@")
      && names === undefined
    ) {
      throw new Error(
        `counterfactual CSS contains an unsupported statement at-rule: ${construct.header}`,
      );
    }
    if (names !== undefined) {
      for (const name of names) {
        const resolved = resolveNestedLayer(parentLayer, name);
        invariant(
          depth === 0 || !isUnionLayer(resolved),
          `the shared StyleX union layer must be top-level, not nested: ${resolved}`,
        );
        invariant(
          resolved !== COUNTERFACTUAL_LAYER
            && !resolved.startsWith(`${COUNTERFACTUAL_LAYER}.`),
          `the counterfactual layer is already declared: ${COUNTERFACTUAL_LAYER}`,
        );
      }
    }
    if (construct.kind !== "block") continue;
    if (!construct.header.startsWith("@")) {
      assertNoNestedLayerAtRule(source, construct.open + 1, construct.close);
      continue;
    }
    const recurse = names !== undefined
      || classifyAtRuleBlock(construct.header) === "rule-list";
    if (!recurse) continue;
    const nextParent = names === undefined
      ? parentLayer
      : resolveNestedLayer(parentLayer, names[0]!);
    validateNestedLayers(
      source,
      scanConstructs(source, construct.open + 1, construct.close),
      nextParent,
      depth + 1,
    );
  }
}

export function placeQuietSiteFooterPriorityBeforeLegacy(
  css: string,
): QuietSiteFooterLayerCounterfactual {
  invariant(css.length > 0, "the packed gallery union CSS must be nonempty");
  const topLevel = scanConstructs(css, 0, css.length);
  validateNestedLayers(css, topLevel, undefined);

  const priorityStatements: Array<{
    readonly names: readonly string[];
    readonly start: number;
  }> = [];
  const priorityBlocks: Array<{
    readonly block: CssBlock;
    readonly name: string;
    readonly priority: Priority;
  }> = [];
  for (const construct of topLevel) {
    const names = parseLayerNames(construct.header, construct.kind);
    if (names === undefined) continue;
    const unionNames = names.filter(isUnionLayer);
    for (const name of unionNames) {
      invariant(priorityForLayer(name) !== undefined,
        `the packed gallery union contains an unknown shared StyleX layer: ${name}`);
    }
    if (construct.kind === "statement" && unionNames.length > 0) {
      priorityStatements.push({ names, start: construct.start });
    }
    if (construct.kind === "block" && unionNames.length > 0) {
      const name = unionNames[0]!;
      priorityBlocks.push({
        block: construct,
        name,
        priority: priorityForLayer(name)!,
      });
    }
  }

  invariant(priorityStatements.length === 1,
    `the packed gallery union must contain exactly one complete shared priority statement; got ${String(priorityStatements.length)}`);
  const priorityStatement = priorityStatements[0]!;
  const priorityNames = priorityStatement.names.slice(UI_LEGACY_LAYERS.length);
  invariant(
    UI_LEGACY_LAYERS.every((name, index) => priorityStatement.names[index] === name),
    "the packed gallery union statement must begin with the exact ordered UI legacy layers",
  );
  invariant(priorityNames.length > 0 && priorityNames.every((name) => priorityForLayer(name) !== undefined),
    "the packed gallery union statement must contain only shared finite priority layers after UI legacy",
  );
  const highestPriority = Number(priorityForLayer(priorityNames.at(-1)!)!.slice("priority".length));
  invariant(Number.isSafeInteger(highestPriority) && highestPriority >= 5 && highestPriority <= MAX_PRIORITY,
    "the packed gallery union has an invalid finite priority bound");
  const expectedPriorityNames = Array.from(
    { length: highestPriority },
    (_, index) => `${UNION_LAYER_PREFIX}.priority${String(index + 1)}`,
  );
  invariant(
    priorityNames.length === expectedPriorityNames.length
      && priorityNames.every((name, index) => name === expectedPriorityNames[index]),
    "the packed gallery union priority statement must be contiguous, finite, and unique",
  );

  const seenBlocks = new Set<string>();
  let previousBlockPriority = 0;
  for (const { block, name, priority } of priorityBlocks) {
    invariant(!seenBlocks.has(name), `the packed gallery union contains a duplicate priority block: ${name}`);
    seenBlocks.add(name);
    invariant(priorityNames.includes(name), `the packed gallery union contains an undeclared priority block: ${name}`);
    const numericPriority = Number(priority.slice("priority".length));
    invariant(numericPriority > previousBlockPriority,
      "the packed gallery union priority blocks must remain in ascending order");
    invariant(priorityStatement.start < block.start,
      `the complete shared priority statement must precede ${name}`);
    previousBlockPriority = numericPriority;
  }

  const footerRules: FooterRule[] = [];
  collectFooterRules(css, topLevel, undefined, 0, footerRules);
  invariant(footerRules.length === 1,
    `the packed gallery union must contain exactly one quiet-site footer padding atom; got ${String(footerRules.length)}`);
  const footerRule = footerRules[0]!;
  invariant(
    footerRule.layer === `${UNION_LAYER_PREFIX}.${TARGET_PRIORITY}`
      && footerRule.conditionalDepth === 0,
    `the quiet-site footer padding atom must be a direct rule in ${UNION_LAYER_PREFIX}.${TARGET_PRIORITY}`,
  );
  invariant(seenBlocks.has(`${UNION_LAYER_PREFIX}.${TARGET_PRIORITY}`),
    `the packed gallery union is missing the ${TARGET_PRIORITY} block`);

  const targetRule = css.slice(footerRule.start, footerRule.end);
  invariant(targetRule.length > 0, "the quiet-site footer padding atom is empty");
  const cssWithoutTarget = css.slice(0, footerRule.start) + css.slice(footerRule.end);
  const counterfactualPrelude = [
    COUNTERFACTUAL_LAYER,
    ...UI_LEGACY_LAYERS,
    ...priorityNames,
  ].join(", ");
  const counterfactualPrefix = [
    "@layer base, components;",
    `@layer ${counterfactualPrelude};`,
    `@layer ${COUNTERFACTUAL_LAYER} {\n${targetRule}\n}`,
  ].join("\n");
  return {
    css: `${counterfactualPrefix}\n${cssWithoutTarget}`,
    targetPriority: TARGET_PRIORITY,
  };
}
