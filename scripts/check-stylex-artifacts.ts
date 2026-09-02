import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const COMPONENTS_IMPORT = '@import "./components.css";';
const CARD_DESCRIPTION_BRIDGE_PATTERN =
  /:where\(\s*\.hraness-card\s*,\s*\.hraness-pressable-card\s*\)\s*\{\s*--hraness-card-description\s*:\s*var\(--_hraness-card-description\)\s*;\s*\}/gu;
const GALLERY_LAYER_CONFLICT_SENTINELS = [
  "data-gallery-stylex-layer-conflict",
  "data-gallery-quiet-site-layer-conflict",
  "data-gallery-quiet-site-priority4-conflict",
  "data-gallery-viewport-frame-layer-conflict",
  "data-gallery-wrapping-row-layer-conflict",
  "data-gallery-themed-surface-layer-conflict",
  "data-gallery-avatar-layer-conflict",
  "data-gallery-status-family-layer-conflict",
  "data-gallery-card-family-layer-conflict",
  "data-gallery-toolbar-layer-conflict",
  "data-gallery-key-hint-layer-conflict",
  "data-gallery-link-layer-conflict",
  "data-gallery-checkbox-field-layer-conflict",
  "data-gallery-action-family-layer-conflict",
  "data-gallery-skip-link-layer-conflict",
  "data-gallery-visually-hidden-layer-conflict",
  "data-gallery-form-layer-conflict",
] as const;
const LEGACY_LAYER = "components.hraness-ui.legacy";
const LEGACY_LAYERS = [
  "components.hraness-ui.legacy.base",
  LEGACY_LAYER,
] as const;
const LAYER_PRELUDE =
  "@layer components.hraness-ui.legacy, components.hraness-ui.priority1, components.hraness-ui.priority2, components.hraness-ui.priority3, components.hraness-ui.priority4;";
const STYLEX_IMPORT = '@import "../dist/stylex.css";';
const STYLEX_LAYERS = [
  "components.hraness-ui.priority1",
  "components.hraness-ui.priority2",
  "components.hraness-ui.priority3",
  "components.hraness-ui.priority4",
] as const;
const TOP_LEVEL_LAYER_PRELUDE = "@layer base, components;";

function requireMatch(
  source: string,
  pattern: RegExp,
  description: string,
): void {
  if (!pattern.test(source)) {
    throw new Error(`StyleX artifact is missing ${description}`);
  }
}

function forbid(
  source: string,
  pattern: RegExp,
  description: string,
): void {
  if (pattern.test(source)) {
    throw new Error(`StyleX artifact unexpectedly contains ${description}`);
  }
}

function topLevelStatements(source: string, description: string): string[] {
  const statements: string[] = [];
  let blockDepth = 0;
  let escaped = false;
  let start = -1;
  let stringQuote: '"' | "'" | undefined;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];
    if (character === undefined) continue;

    if (stringQuote !== undefined) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === stringQuote) {
        stringQuote = undefined;
      }
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      const commentEnd = source.indexOf("*/", index + 2);
      if (commentEnd < 0) {
        throw new Error(`${description} contains an unterminated comment`);
      }
      index = commentEnd + 1;
      continue;
    }

    if (start < 0) {
      if (/\s/u.test(character)) continue;
      start = index;
    }

    if (character === '"' || character === "'") {
      stringQuote = character;
      continue;
    }

    if (character === "{") {
      blockDepth += 1;
      continue;
    }
    if (character === "}") {
      blockDepth -= 1;
      if (blockDepth < 0) {
        throw new Error(`${description} contains an unmatched closing brace`);
      }
      if (blockDepth === 0 && start >= 0) {
        statements.push(source.slice(start, index + 1).trim());
        start = -1;
      }
      continue;
    }
    if (character === ";" && blockDepth === 0 && start >= 0) {
      statements.push(source.slice(start, index + 1).trim());
      start = -1;
    }
  }

  if (stringQuote !== undefined || blockDepth !== 0) {
    throw new Error(`${description} contains an unterminated CSS construct`);
  }
  if (start >= 0 && source.slice(start).trim().length > 0) {
    throw new Error(`${description} contains an unterminated top-level statement`);
  }
  return statements;
}

interface CssBlock {
  readonly body: string;
  readonly header: string;
  readonly source: string;
}

interface CssRule extends CssBlock {
  readonly ancestors: readonly CssBlock[];
}

const CHECKBOX_STYLE_KEYS = [
  "control",
  "disabled",
  "focusVisible",
  "indicator",
  "invalidIndicator",
  "label",
  "root",
  "selectedIndicator",
] as const;
const ACTION_STYLE_KEYS = [
  "compactControl",
  "control",
  "hoveredLabeledPrimary",
  "nativeInlineInteractionFallbacks",
  "root",
  "spinner",
  "transportIconControl",
] as const;
const ACTION_NATIVE_STYLE_SITES = [
  {
    component: "Button",
    endMarker: "function validateCopyFeedbackDuration(",
    presentation: "presentation",
    startMarker: "export const Button =",
  },
  {
    component: "IconButton",
    endMarker: "export type ToggleButtonProps",
    presentation: "presentation",
    startMarker: "export function IconButton(",
  },
  {
    component: "ToggleButton",
    endMarker: "export type LinkProps",
    presentation: "presentation",
    startMarker: "export function ToggleButton(",
  },
  {
    component: "LinkButton",
    endMarker: "export type IconLinkProps",
    presentation: "presentation",
    startMarker: "export function LinkButton(",
  },
  {
    component: "IconLink",
    endMarker: undefined,
    presentation: "controlPresentation",
    startMarker: "export function IconLink(",
  },
] as const;
const LINK_STYLE_KEYS = [
  "focusVisible",
  "hovered",
  "nativeInteractionFallbacks",
  "root",
] as const;
const TOOLBAR_STYLE_KEYS = [
  "nativeFocusFallback",
  "root",
  "vertical",
] as const;
type CheckboxStyleKey = (typeof CHECKBOX_STYLE_KEYS)[number];
type LinkStyleKey = (typeof LINK_STYLE_KEYS)[number];
type ToolbarStyleKey = (typeof TOOLBAR_STYLE_KEYS)[number];

function blockFromStatement(
  statement: string,
  description: string,
): CssBlock | undefined {
  const open = statement.indexOf("{");
  if (open < 0) return undefined;
  if (!statement.endsWith("}")) {
    throw new Error(`${description} contains an incomplete block`);
  }
  return {
    body: statement.slice(open + 1, -1),
    header: statement.slice(0, open).trim(),
    source: statement,
  };
}

function cssRules(
  source: string,
  description: string,
  ancestors: readonly CssBlock[] = [],
): CssRule[] {
  const rules: CssRule[] = [];
  for (const statement of topLevelStatements(source, description)) {
    const block = blockFromStatement(statement, description);
    if (block === undefined) continue;
    if (block.header.startsWith("@")) {
      rules.push(...cssRules(
        block.body,
        description,
        [...ancestors, block],
      ));
    } else {
      rules.push({ ...block, ancestors });
    }
  }
  return rules;
}

function cssSelectorList(header: string): readonly string[] {
  const selectors: string[] = [];
  let escaped = false;
  let quote: "\"" | "'" | undefined;
  let parentheses = 0;
  let brackets = 0;
  let start = 0;
  for (let index = 0; index < header.length; index += 1) {
    const character = header[index];
    if (character === undefined) continue;
    if (quote !== undefined) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === "\"" || character === "'") quote = character;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "," && parentheses === 0 && brackets === 0) {
      selectors.push(header.slice(start, index).trim());
      start = index + 1;
    }
  }
  selectors.push(header.slice(start).trim());
  return selectors.filter((selector) => selector.length > 0);
}

function declarationSelectors(
  rules: readonly CssRule[],
  classNames: ReadonlySet<string>,
  declaration: RegExp,
  description: string,
): readonly string[] {
  const selectors = rules
    .filter((rule) => declaration.test(rule.body))
    .flatMap((rule) => cssSelectorList(rule.header))
    .filter((selector) => [...classNames].some((className) =>
      new RegExp(`\\.${className}(?![A-Za-z0-9_-])`, "u").test(selector)
    ));
  if (selectors.length === 0) {
    throw new Error(`${description} has no class-owned selector`);
  }
  return selectors;
}

function requirePositivePseudoSelector(
  selector: string,
  pseudo: "focus-visible" | "hover",
  description: string,
): void {
  forbid(
    selector,
    new RegExp(`:not\\([^)]*:${pseudo}(?![A-Za-z0-9_-])[^)]*\\)`, "u"),
    `a negated ${description}`,
  );
  requireMatch(
    selector,
    new RegExp(`:${pseudo}(?![A-Za-z0-9_-])`, "u"),
    description,
  );
}

function balancedObject(
  source: string,
  open: number,
  description: string,
): string {
  let depth = 0;
  let escaped = false;
  let quote: "\"" | "'" | "`" | undefined;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];
    if (character === undefined) continue;
    if (quote !== undefined) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      const end = source.indexOf("*/", index + 2);
      if (end < 0) throw new Error(`${description} contains an unterminated comment`);
      index = end + 1;
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  throw new Error(`${description} contains an unterminated object`);
}

interface CompiledObjectProperty {
  readonly key: string;
  readonly source: string;
  readonly value: string;
  readonly valueEnd: number;
  readonly valueStart: number;
}

interface CompiledStyleMap {
  readonly object: string;
  readonly properties: ReadonlyMap<string, CompiledObjectProperty>;
}

interface VisuallyHiddenArtifact {
  readonly classNames: ReadonlySet<string>;
  readonly rules: readonly CssRule[];
}

interface FormArtifact {
  readonly classNames: ReadonlySet<string>;
  readonly identifier: string;
  readonly rules: readonly CssRule[];
  readonly styleMap: CompiledStyleMap;
}

interface VisuallyHiddenSources {
  readonly actions: string;
  readonly fields: string;
  readonly feedback: string;
  readonly helper: string;
  readonly knob: string;
  readonly selectField: string;
}

function compiledObjectProperties(
  object: string,
  description: string,
): ReadonlyMap<string, CompiledObjectProperty> {
  if (!object.startsWith("{") || !object.endsWith("}")) {
    throw new Error(`${description} must be a complete object`);
  }
  const body = object.slice(1, -1);
  const segments: Array<Readonly<{ end: number; start: number }>> = [];
  let braceDepth = 0;
  let bracketDepth = 0;
  let escaped = false;
  let parenthesisDepth = 0;
  let quote: "\"" | "'" | "`" | undefined;
  let segmentStart = 0;

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    const nextCharacter = body[index + 1];
    if (character === undefined) continue;
    if (quote !== undefined) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      const end = body.indexOf("*/", index + 2);
      if (end < 0) throw new Error(`${description} contains an unterminated comment`);
      index = end + 1;
      continue;
    }
    if (character === "\"" || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") braceDepth += 1;
    else if (character === "}") braceDepth -= 1;
    else if (character === "[") bracketDepth += 1;
    else if (character === "]") bracketDepth -= 1;
    else if (character === "(") parenthesisDepth += 1;
    else if (character === ")") parenthesisDepth -= 1;
    else if (
      character === ","
      && braceDepth === 0
      && bracketDepth === 0
      && parenthesisDepth === 0
    ) {
      segments.push({ end: index, start: segmentStart });
      segmentStart = index + 1;
    }
    if (braceDepth < 0 || bracketDepth < 0 || parenthesisDepth < 0) {
      throw new Error(`${description} contains an unmatched closing delimiter`);
    }
  }
  if (
    quote !== undefined
    || braceDepth !== 0
    || bracketDepth !== 0
    || parenthesisDepth !== 0
  ) {
    throw new Error(`${description} contains an unterminated property value`);
  }
  segments.push({ end: body.length, start: segmentStart });

  const properties = new Map<string, CompiledObjectProperty>();
  for (const segment of segments) {
    const raw = body.slice(segment.start, segment.end);
    const property = raw.match(
      /^\s*(?:([A-Za-z_$][\w$]*)|"([^"\\]+)"|'([^'\\]+)')\s*:\s*/u,
    );
    if (property === null) continue;
    const key = property[1] ?? property[2] ?? property[3];
    if (key === undefined) continue;
    let valueStart = segment.start + property[0].length;
    let valueEnd = segment.end;
    while (/\s/u.test(body[valueStart] ?? "")) valueStart += 1;
    while (valueEnd > valueStart && /\s/u.test(body[valueEnd - 1] ?? "")) {
      valueEnd -= 1;
    }
    properties.set(key, {
      key,
      source: raw.trim(),
      value: body.slice(valueStart, valueEnd),
      valueEnd: valueEnd + 1,
      valueStart: valueStart + 1,
    });
  }
  return properties;
}

function actionStyleMap(compiledJavaScript: string): CompiledStyleMap {
  const candidates: CompiledStyleMap[] = [];
  for (const anchor of compiledJavaScript.matchAll(
    /(?:compactControl|["']compactControl["'])\s*:\s*\{/gu,
  )) {
    const anchorIndex = anchor.index ?? 0;
    const assignments = [...compiledJavaScript.slice(0, anchorIndex).matchAll(
      /(?:\b(?:const|let|var)\s+|,)([A-Za-z_$][\w$]*)\s*=\s*\{/gu,
    )];
    const assignment = assignments.at(-1);
    if (assignment === undefined) continue;
    const open = (assignment.index ?? 0) + assignment[0].lastIndexOf("{");
    const object = balancedObject(
      compiledJavaScript,
      open,
      "dist/index.js actionStyles class map",
    );
    if (open + object.length <= anchorIndex) continue;
    const properties = compiledObjectProperties(
      object,
      "dist/index.js actionStyles class map",
    );
    if (ACTION_STYLE_KEYS.every((key) => properties.get(key)?.value.startsWith("{"))) {
      candidates.push({ object, properties });
    }
  }
  if (candidates.length !== 1) {
    throw new Error(
      `dist/index.js must contain exactly one compiled actionStyles class map; found ${String(candidates.length)}`,
    );
  }
  return candidates[0]!;
}

function generatedClassNames(
  object: string,
  description: string,
): ReadonlySet<string> {
  const classNames = new Set<string>();
  for (const match of object.matchAll(
    /["']((?:x[A-Za-z0-9_-]+)(?:\s+x[A-Za-z0-9_-]+)*)["']/gu,
  )) {
    for (const className of match[1]!.split(/\s+/u)) classNames.add(className);
  }
  if (classNames.size === 0) {
    throw new Error(`${description} has no generated classes`);
  }
  return classNames;
}

function checkboxStyleMap(compiledJavaScript: string): string {
  const candidates: string[] = [];
  for (const match of compiledJavaScript.matchAll(
    /(?:\b(?:const|let|var)\s+|,)([A-Za-z_$][\w$]*)\s*=\s*\{\s*control\s*:\s*\{/gu,
  )) {
    const open = (match.index ?? 0) + match[0].indexOf("{");
    const object = balancedObject(
      compiledJavaScript,
      open,
      "dist/index.js CheckboxField StyleX map",
    );
    if (CHECKBOX_STYLE_KEYS.every(
      (key) => new RegExp(`(?:^|,)\\s*${key}\\s*:\\s*\\{`, "u")
        .test(object.slice(1, -1)),
    )) {
      candidates.push(object);
    }
  }
  if (candidates.length !== 1) {
    throw new Error(
      `dist/index.js must contain exactly one compiled checkboxFieldStyles class map; found ${String(candidates.length)}`,
    );
  }
  return candidates[0]!;
}

function checkboxStyleObject(
  compiledJavaScript: string,
  key: CheckboxStyleKey,
): string {
  const map = checkboxStyleMap(compiledJavaScript);
  const body = map.slice(1, -1);
  const matches = [...body.matchAll(
    new RegExp(`(?:^|,)\\s*${key}\\s*:\\s*\\{`, "gu"),
  )];
  if (matches.length !== 1) {
    throw new Error(
      `the compiled checkboxFieldStyles map must contain exactly one ${key} object; found ${String(matches.length)}`,
    );
  }
  const match = matches[0]!;
  const open = 1 + (match.index ?? 0) + match[0].lastIndexOf("{");
  return balancedObject(
    map,
    open,
    `dist/index.js CheckboxField ${key} StyleX map`,
  );
}

function checkboxStyleClassNames(
  compiledJavaScript: string,
  key?: CheckboxStyleKey,
): ReadonlySet<string> {
  return generatedClassNames(
    key === undefined
      ? checkboxStyleMap(compiledJavaScript)
      : checkboxStyleObject(compiledJavaScript, key),
    key === undefined
      ? "the compiled checkboxFieldStyles class map"
      : `the compiled checkboxFieldStyles ${key} class map`,
  );
}

function checkboxStyleRules(
  compiledJavaScript: string,
  compiledCss: string,
  key?: CheckboxStyleKey,
): CssRule[] {
  const classNames = checkboxStyleClassNames(compiledJavaScript, key);
  const rules = cssRules(compiledCss, "dist/stylex.css").filter((rule) =>
    [...classNames].some((className) =>
      new RegExp(`\\.${className}(?![A-Za-z0-9_-])`, "u").test(rule.header)
    )
  );
  if (rules.length === 0) {
    throw new Error(
      key === undefined
        ? "dist/stylex.css has no rules owned by checkboxFieldStyles"
        : `dist/stylex.css has no rules owned by checkboxFieldStyles.${key}`,
    );
  }
  return rules;
}

function actionStyleClassNamesByKey(
  compiledJavaScript: string,
): ReadonlyMap<string, ReadonlySet<string>> {
  const styleMap = actionStyleMap(compiledJavaScript);
  const classNamesByKey = new Map<string, ReadonlySet<string>>();
  for (const [key, property] of styleMap.properties) {
    if (!property.value.startsWith("{")) continue;
    classNamesByKey.set(
      key,
      generatedClassNames(
        property.value,
        `the compiled actionStyles.${key} class map`,
      ),
    );
  }
  return classNamesByKey;
}

function rulesForClassNames(
  rules: readonly CssRule[],
  classNames: ReadonlySet<string>,
): CssRule[] {
  return rules.filter((rule) =>
    [...classNames].some((className) =>
      new RegExp(`\\.${className}(?![A-Za-z0-9_-])`, "u").test(rule.header),
    ),
  );
}

function formArtifact(
  compiledJavaScript: string,
  compiledCss: string,
): FormArtifact {
  const allRules = cssRules(compiledCss, "dist/stylex.css");
  const expectedDeclarations = new Set([
    "display:grid;",
    "gap:var(--space-6);",
    "min-width:0;",
  ]);
  const candidates: FormArtifact[] = [];

  for (const match of compiledJavaScript.matchAll(
    /(?:\b(?:const|let|var)\s+|,)([A-Za-z_$][\w$]*)\s*=\s*\{\s*root\s*:\s*\{/gu,
  )) {
    const open = (match.index ?? 0) + match[0].indexOf("{");
    const object = balancedObject(
      compiledJavaScript,
      open,
      "dist/index.js formStyles class map",
    );
    const properties = compiledObjectProperties(
      object,
      "dist/index.js formStyles class map",
    );
    const root = properties.get("root");
    if (properties.size !== 1 || root === undefined || !root.value.startsWith("{")) {
      continue;
    }
    const classNames = generatedClassNames(
      root.value,
      "the compiled formStyles.root class map",
    );
    if (classNames.size !== 3) continue;
    const rules = rulesForClassNames(allRules, classNames);
    const declarations = new Set(
      rules.map((rule) => normalizedAtomicDeclaration(rule.body)),
    );
    if (
      declarations.size === expectedDeclarations.size
      && [...expectedDeclarations].every((value) => declarations.has(value))
    ) {
      candidates.push({
        classNames,
        identifier: match[1]!,
        rules,
        styleMap: { object, properties },
      });
    }
  }

  if (candidates.length !== 1) {
    throw new Error(
      `dist/index.js must contain exactly one compiled formStyles class map; found ${String(candidates.length)}`,
    );
  }
  return candidates[0]!;
}

function normalizedAtomicDeclaration(body: string): string {
  return body
    .toLowerCase()
    .replace(/,/gu, " ")
    .replace(/\s+/gu, " ")
    .replace(/\s*:\s*/gu, ":")
    .replace(/\s*!important/gu, "!important")
    .replace(/\s*;\s*/gu, ";")
    .trim()
    .replace(/;?$/u, ";");
}

function visuallyHiddenArtifact(
  compiledJavaScript: string,
  compiledCss: string,
): VisuallyHiddenArtifact {
  const allRules = cssRules(compiledCss, "dist/stylex.css");
  const candidates: VisuallyHiddenArtifact[] = [];
  const candidateKeys = new Set<string>();
  const fingerprints = new Set([
    "clip:rect(0 0 0 0)!important;",
    "height:1px!important;",
    "overflow:hidden!important;",
    "position:absolute!important;",
    "white-space:nowrap!important;",
    "width:1px!important;",
  ]);
  const addCandidate = (classNames: ReadonlySet<string>): void => {
    const rules = rulesForClassNames(allRules, classNames);
    const fingerprintCount = [
      ...new Set(rules.map((rule) => normalizedAtomicDeclaration(rule.body))),
    ].filter((declaration) => fingerprints.has(declaration)).length;
    const key = [...classNames].sort().join(" ");
    if (fingerprintCount >= 4 && !candidateKeys.has(key)) {
      candidateKeys.add(key);
      candidates.push({ classNames, rules });
    }
  };

  for (const match of compiledJavaScript.matchAll(
    /(?:\b(?:const|let|var)\s+|,)([A-Za-z_$][\w$]*)\s*=\s*\{\s*root\s*:\s*\{/gu,
  )) {
    const open = (match.index ?? 0) + match[0].indexOf("{");
    const object = balancedObject(
      compiledJavaScript,
      open,
      "dist/index.js visuallyHiddenStyles class map",
    );
    const properties = compiledObjectProperties(
      object,
      "dist/index.js visuallyHiddenStyles class map",
    );
    const root = properties.get("root");
    if (properties.size !== 1 || root === undefined || !root.value.startsWith("{")) {
      continue;
    }
    const classNames = generatedClassNames(
      root.value,
      "the compiled visuallyHiddenStyles.root class map",
    );
    addCandidate(classNames);
  }

  for (const match of compiledJavaScript.matchAll(
    /["']((?:x[A-Za-z0-9_-]+)(?:\s+x[A-Za-z0-9_-]+){3,})["']/gu,
  )) {
    addCandidate(
      generatedClassNames(
        match[0],
        "the compiled visually-hidden helper class set",
      ),
    );
  }

  if (candidates.length !== 1) {
    throw new Error(
      `dist/index.js must contain exactly one compiled visuallyHiddenStyles class set; found ${String(candidates.length)}`,
    );
  }
  return candidates[0]!;
}

function replaceVisuallyHiddenDeclaration(
  compiledJavaScript: string,
  compiledCss: string,
  declaration: RegExp,
  replacement: string,
  description: string,
): string {
  const matches = visuallyHiddenArtifact(compiledJavaScript, compiledCss).rules.filter(
    (rule) => declaration.test(rule.body),
  );
  if (matches.length !== 1) {
    throw new Error(`${description} mutation expected one visually-hidden rule`);
  }
  const rule = matches[0]!;
  const mutatedRule = rule.source.replace(declaration, replacement);
  if (mutatedRule === rule.source) {
    throw new Error(`${description} mutation did not change its exact rule`);
  }
  const ruleIndex = compiledCss.indexOf(rule.source);
  if (ruleIndex < 0 || ruleIndex !== compiledCss.lastIndexOf(rule.source)) {
    throw new Error(`${description} mutation requires one exact visually-hidden rule`);
  }
  return `${compiledCss.slice(0, ruleIndex)}${mutatedRule}${compiledCss.slice(
    ruleIndex + rule.source.length,
  )}`;
}

function actionRecipeStyleRules(
  compiledJavaScript: string,
  compiledCss: string,
  key: string,
): CssRule[] {
  const classNames = actionStyleClassNamesByKey(compiledJavaScript).get(key);
  if (classNames === undefined) {
    throw new Error(`the compiled actionStyles map is missing ${key}`);
  }
  const rules = rulesForClassNames(
    cssRules(compiledCss, "dist/stylex.css"),
    classNames,
  );
  if (rules.length === 0) {
    throw new Error(`dist/stylex.css has no rules owned by actionStyles.${key}`);
  }
  return rules;
}

function toolbarStyleMap(compiledJavaScript: string): string {
  const candidates: string[] = [];
  for (const match of compiledJavaScript.matchAll(
    /(?:\b(?:const|let|var)\s+|,)([A-Za-z_$][\w$]*)\s*=\s*\{\s*nativeFocusFallback\s*:\s*\{/gu,
  )) {
    const open = (match.index ?? 0) + match[0].indexOf("{");
    const object = balancedObject(
      compiledJavaScript,
      open,
      "dist/index.js Toolbar StyleX map",
    );
    if (TOOLBAR_STYLE_KEYS.every(
      (key) => new RegExp(`(?:^|,)\\s*${key}\\s*:\\s*\\{`, "u")
        .test(object.slice(1, -1)),
    )) {
      candidates.push(object);
    }
  }
  if (candidates.length !== 1) {
    throw new Error(
      `dist/index.js must contain exactly one compiled toolbarStyles class map; found ${String(candidates.length)}`,
    );
  }
  return candidates[0]!;
}

function toolbarStyleObject(
  compiledJavaScript: string,
  key: ToolbarStyleKey,
): string {
  const map = toolbarStyleMap(compiledJavaScript);
  const body = map.slice(1, -1);
  const matches = [...body.matchAll(
    new RegExp(`(?:^|,)\\s*${key}\\s*:\\s*\\{`, "gu"),
  )];
  if (matches.length !== 1) {
    throw new Error(
      `the compiled toolbarStyles map must contain exactly one ${key} object; found ${String(matches.length)}`,
    );
  }
  const match = matches[0]!;
  const open = 1 + (match.index ?? 0) + match[0].lastIndexOf("{");
  return balancedObject(
    map,
    open,
    `dist/index.js Toolbar ${key} StyleX map`,
  );
}

function toolbarStyleRules(
  compiledJavaScript: string,
  compiledCss: string,
  key: ToolbarStyleKey,
): CssRule[] {
  const classNames = toolbarStyleClassNames(compiledJavaScript, key);
  const rules = cssRules(compiledCss, "dist/stylex.css").filter((rule) =>
    [...classNames].some((className) =>
      new RegExp(`\\.${className}(?![A-Za-z0-9_-])`, "u").test(rule.header)
    )
  );
  if (rules.length === 0) {
    throw new Error(`dist/stylex.css has no rules owned by toolbarStyles.${key}`);
  }
  return rules;
}

function toolbarStyleClassNames(
  compiledJavaScript: string,
  key: ToolbarStyleKey,
): ReadonlySet<string> {
  return generatedClassNames(
    toolbarStyleObject(compiledJavaScript, key),
    `the compiled toolbarStyles ${key} class map`,
  );
}

function replaceToolbarDeclaration(
  compiledJavaScript: string,
  compiledCss: string,
  key: ToolbarStyleKey,
  declaration: RegExp,
  replacement: string,
  description: string,
): string {
  const matches = toolbarStyleRules(compiledJavaScript, compiledCss, key)
    .filter((rule) => declaration.test(rule.body));
  if (matches.length !== 1) {
    throw new Error(`${description} mutation expected one Toolbar rule`);
  }
  const rule = matches[0]!;
  const mutatedRule = rule.source.replace(declaration, replacement);
  if (mutatedRule === rule.source) {
    throw new Error(`${description} mutation did not change its exact rule`);
  }
  const ruleIndex = compiledCss.indexOf(rule.source);
  if (ruleIndex < 0 || ruleIndex !== compiledCss.lastIndexOf(rule.source)) {
    throw new Error(`${description} mutation requires one exact Toolbar rule`);
  }
  return `${compiledCss.slice(0, ruleIndex)}${mutatedRule}${compiledCss.slice(
    ruleIndex + rule.source.length,
  )}`;
}

function linkStyleMap(compiledJavaScript: string): string {
  const candidates: string[] = [];
  for (const match of compiledJavaScript.matchAll(
    /(?:\b(?:const|let|var)\s+|,)([A-Za-z_$][\w$]*)\s*=\s*\{\s*focusVisible\s*:\s*\{/gu,
  )) {
    const open = (match.index ?? 0) + match[0].indexOf("{");
    const object = balancedObject(
      compiledJavaScript,
      open,
      "dist/index.js Link StyleX map",
    );
    if (LINK_STYLE_KEYS.every(
      (key) => new RegExp(`(?:^|,)\\s*${key}\\s*:\\s*\\{`, "u")
        .test(object.slice(1, -1)),
    )) {
      candidates.push(object);
    }
  }
  if (candidates.length !== 1) {
    throw new Error(
      `dist/index.js must contain exactly one compiled linkStyles class map; found ${String(candidates.length)}`,
    );
  }
  return candidates[0]!;
}

function linkStyleObject(
  compiledJavaScript: string,
  key: LinkStyleKey,
): string {
  const map = linkStyleMap(compiledJavaScript);
  const body = map.slice(1, -1);
  const matches = [...body.matchAll(
    new RegExp(`(?:^|,)\\s*${key}\\s*:\\s*\\{`, "gu"),
  )];
  if (matches.length !== 1) {
    throw new Error(
      `the compiled linkStyles map must contain exactly one ${key} object; found ${String(matches.length)}`,
    );
  }
  const match = matches[0]!;
  const open = 1 + (match.index ?? 0) + match[0].lastIndexOf("{");
  return balancedObject(
    map,
    open,
    `dist/index.js Link ${key} StyleX map`,
  );
}

function linkStyleClassNames(
  compiledJavaScript: string,
  key?: LinkStyleKey,
): ReadonlySet<string> {
  return generatedClassNames(
    key === undefined
      ? linkStyleMap(compiledJavaScript)
      : linkStyleObject(compiledJavaScript, key),
    key === undefined
      ? "the compiled linkStyles class map"
      : `the compiled linkStyles ${key} class map`,
  );
}

function linkStyleRules(
  compiledJavaScript: string,
  compiledCss: string,
  key?: LinkStyleKey,
): CssRule[] {
  const classNames = linkStyleClassNames(compiledJavaScript, key);
  const rules = cssRules(compiledCss, "dist/stylex.css").filter((rule) =>
    [...classNames].some((className) =>
      new RegExp(`\\.${className}(?![A-Za-z0-9_-])`, "u").test(rule.header)
    )
  );
  if (rules.length === 0) {
    throw new Error(
      key === undefined
        ? "dist/stylex.css has no rules owned by linkStyles"
        : `dist/stylex.css has no rules owned by linkStyles.${key}`,
    );
  }
  return rules;
}

function replaceFormDeclaration(
  compiledJavaScript: string,
  compiledCss: string,
  declaration: RegExp,
  replacement: string,
  description: string,
): string {
  const matches = formArtifact(compiledJavaScript, compiledCss).rules.filter(
    (rule) => declaration.test(rule.body),
  );
  if (matches.length !== 1) {
    throw new Error(`${description} mutation expected one Form rule`);
  }
  const rule = matches[0]!;
  const mutatedRule = rule.source.replace(declaration, replacement);
  if (mutatedRule === rule.source) {
    throw new Error(`${description} mutation did not change its exact rule`);
  }
  const ruleIndex = compiledCss.indexOf(rule.source);
  if (ruleIndex < 0 || ruleIndex !== compiledCss.lastIndexOf(rule.source)) {
    throw new Error(`${description} mutation requires one exact Form rule`);
  }
  return `${compiledCss.slice(0, ruleIndex)}${mutatedRule}${compiledCss.slice(
    ruleIndex + rule.source.length,
  )}`;
}

function wrapFormDeclarationInCondition(
  compiledJavaScript: string,
  compiledCss: string,
  declaration: RegExp,
  condition: string,
  description: string,
): string {
  const matches = formArtifact(compiledJavaScript, compiledCss).rules.filter(
    (rule) => declaration.test(rule.body),
  );
  if (matches.length !== 1) {
    throw new Error(`${description} mutation expected one Form rule`);
  }
  const rule = matches[0]!;
  const ruleIndex = compiledCss.indexOf(rule.source);
  if (ruleIndex < 0 || ruleIndex !== compiledCss.lastIndexOf(rule.source)) {
    throw new Error(`${description} mutation requires one exact Form rule`);
  }
  const conditionalRule = `${condition} { ${rule.source} }`;
  return `${compiledCss.slice(0, ruleIndex)}${conditionalRule}${compiledCss.slice(
    ruleIndex + rule.source.length,
  )}`;
}

function disconnectFormCompiledBinding(
  compiledJavaScript: string,
  compiledCss: string,
): string {
  const artifact = formArtifact(compiledJavaScript, compiledCss);
  const matches = formCompiledBindingMatches(
    compiledJavaScript,
    artifact.identifier,
  );
  const match = matches[0];
  const matchIndex = match?.index;
  if (matches.length !== 1 || match === undefined || matchIndex === undefined) {
    throw new Error("Form binding mutation expected one compiled StyleX props call");
  }
  return `${compiledJavaScript.slice(0, matchIndex)}.props(unrelatedFormStyles.root,${compiledJavaScript.slice(
    matchIndex + match[0].length,
  )}`;
}

function replaceLinkDeclaration(
  compiledJavaScript: string,
  compiledCss: string,
  key: LinkStyleKey,
  declaration: RegExp,
  replacement: string,
  description: string,
): string {
  const matches = linkStyleRules(compiledJavaScript, compiledCss, key).filter(
    (rule) => declaration.test(rule.body),
  );
  if (matches.length !== 1) {
    throw new Error(`${description} mutation expected one Link rule`);
  }
  const rule = matches[0]!;
  const mutatedRule = rule.source.replace(declaration, replacement);
  if (mutatedRule === rule.source) {
    throw new Error(`${description} mutation did not change its exact rule`);
  }
  const ruleIndex = compiledCss.indexOf(rule.source);
  if (ruleIndex < 0 || ruleIndex !== compiledCss.lastIndexOf(rule.source)) {
    throw new Error(`${description} mutation requires one exact Link rule`);
  }
  return `${compiledCss.slice(0, ruleIndex)}${mutatedRule}${compiledCss.slice(
    ruleIndex + rule.source.length,
  )}`;
}

function replaceCheckboxStyleClassName(
  compiledJavaScript: string,
  key: CheckboxStyleKey,
  target: string,
  replacement: string,
): string {
  const map = checkboxStyleMap(compiledJavaScript);
  const styleObject = checkboxStyleObject(compiledJavaScript, key);
  if (styleObject.split(target).length !== 2) {
    throw new Error(
      `the compiled checkboxFieldStyles ${key} mutation must match ${target} exactly once`,
    );
  }
  if (compiledJavaScript.includes(replacement)) {
    throw new Error(
      `the compiled checkboxFieldStyles mutation replacement already exists: ${replacement}`,
    );
  }
  const styleIndex = map.indexOf(styleObject);
  if (styleIndex < 0 || styleIndex !== map.lastIndexOf(styleObject)) {
    throw new Error(
      `the compiled checkboxFieldStyles map must contain one exact ${key} object`,
    );
  }
  const mutatedStyleObject = styleObject.replace(target, replacement);
  const mutatedMap = `${map.slice(0, styleIndex)}${mutatedStyleObject}${map.slice(
    styleIndex + styleObject.length,
  )}`;
  const mapIndex = compiledJavaScript.indexOf(map);
  if (mapIndex < 0 || mapIndex !== compiledJavaScript.lastIndexOf(map)) {
    throw new Error("dist/index.js must contain one exact checkboxFieldStyles class map");
  }
  return `${compiledJavaScript.slice(0, mapIndex)}${mutatedMap}${compiledJavaScript.slice(
    mapIndex + map.length,
  )}`;
}

function normalizedHeader(header: string): string {
  return header.replace(/\s+/gu, "").toLowerCase();
}

function requireActionConditionalDeclaration(
  rules: readonly CssRule[],
  condition: string,
  declaration: RegExp,
  description: string,
): void {
  const matches = rules.filter((rule) => declaration.test(rule.body));
  if (matches.length === 0) {
    throw new Error(`StyleX artifact is missing ${description}`);
  }
  if (matches.some(
    (rule) => normalizedHeader(rule.ancestors.at(-1)?.header ?? "") !== condition,
  )) {
    throw new Error(`${description} must remain directly inside ${condition}`);
  }
}

function requireActionUnconditionalDeclaration(
  rules: readonly CssRule[],
  declaration: RegExp,
  description: string,
): void {
  const matches = rules.filter((rule) => declaration.test(rule.body));
  if (matches.length === 0) {
    throw new Error(`StyleX artifact is missing ${description}`);
  }
  if (matches.some((rule) =>
    rule.ancestors.some((ancestor) =>
      /^@(?:container|media|supports)/u.test(normalizedHeader(ancestor.header))
    )
  )) {
    throw new Error(`${description} must remain unconditional`);
  }
}

function relocateActionConditionalRule(
  compiledJavaScript: string,
  compiledCss: string,
  key: string,
  condition: string,
  declaration: RegExp,
  description: string,
): string {
  const matches = actionRecipeStyleRules(compiledJavaScript, compiledCss, key).filter(
    (rule) =>
      declaration.test(rule.body)
      && normalizedHeader(rule.ancestors.at(-1)?.header ?? "") === condition,
  );
  if (matches.length === 0) {
    throw new Error(`${description} mutation expected a conditional rule`);
  }
  const rule = matches[0]!;
  const conditional = rule.ancestors.at(-1)!;
  const withoutRule = conditional.body.replace(rule.source, "");
  if (withoutRule === conditional.body) {
    throw new Error(`${description} mutation could not remove its exact rule`);
  }
  const replacement = `${conditional.header}{${withoutRule}}${rule.source}`;
  const conditionalIndex = compiledCss.indexOf(conditional.source);
  if (
    conditionalIndex < 0
    || conditionalIndex !== compiledCss.lastIndexOf(conditional.source)
  ) {
    throw new Error(`${description} mutation requires one exact conditional block`);
  }
  return `${compiledCss.slice(0, conditionalIndex)}${replacement}${compiledCss.slice(
    conditionalIndex + conditional.source.length,
  )}`;
}

function replaceActionDeclaration(
  compiledJavaScript: string,
  compiledCss: string,
  key: string,
  declaration: RegExp,
  replacement: string,
  description: string,
): string {
  const matches = actionRecipeStyleRules(compiledJavaScript, compiledCss, key).filter(
    (rule) => declaration.test(rule.body),
  );
  if (matches.length !== 1) {
    throw new Error(`${description} mutation expected one action-family rule`);
  }
  const rule = matches[0]!;
  const mutatedRule = rule.source.replace(declaration, replacement);
  if (mutatedRule === rule.source) {
    throw new Error(`${description} mutation did not change its exact rule`);
  }
  const ruleIndex = compiledCss.indexOf(rule.source);
  if (ruleIndex < 0 || ruleIndex !== compiledCss.lastIndexOf(rule.source)) {
    throw new Error(`${description} mutation requires one exact action-family rule`);
  }
  return `${compiledCss.slice(0, ruleIndex)}${mutatedRule}${compiledCss.slice(
    ruleIndex + rule.source.length,
  )}`;
}

function replaceExactlyOnce(
  source: string,
  pattern: RegExp,
  replacement: (match: RegExpExecArray) => string,
  description: string,
): string {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length !== 1) {
    throw new Error(`${description} mutation expected one source match`);
  }
  const match = matches[0]!;
  const start = match.index ?? 0;
  const changed = replacement(match);
  if (changed === match[0]) {
    throw new Error(`${description} mutation did not change its exact source`);
  }
  return `${source.slice(0, start)}${changed}${source.slice(start + match[0].length)}`;
}

function boundedSource(
  source: string,
  startMarker: string,
  endMarker: string | undefined,
  description: string,
): Readonly<{ body: string; end: number; start: number }> {
  const start = source.indexOf(startMarker);
  const end = endMarker === undefined ? source.length : source.indexOf(endMarker, start);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`${description} must retain its bounded source`);
  }
  return { body: source.slice(start, end), end, start };
}

function replaceExactlyOnceInBoundedSource(
  source: string,
  startMarker: string,
  endMarker: string | undefined,
  pattern: RegExp,
  replacement: (match: RegExpExecArray) => string,
  description: string,
): string {
  const bounded = boundedSource(source, startMarker, endMarker, description);
  const changed = replaceExactlyOnce(
    bounded.body,
    pattern,
    replacement,
    description,
  );
  return `${source.slice(0, bounded.start)}${changed}${source.slice(bounded.end)}`;
}

function swapActionRecipeValues(
  compiledJavaScript: string,
  leftKey: string,
  rightKey: string,
  description: string,
): string {
  const styleMap = actionStyleMap(compiledJavaScript);
  const left = styleMap.properties.get(leftKey);
  const right = styleMap.properties.get(rightKey);
  if (left === undefined || right === undefined) {
    throw new Error(`${description} mutation requires both action recipes`);
  }
  const replacements = [
    { end: left.valueEnd, start: left.valueStart, value: right.value },
    { end: right.valueEnd, start: right.valueStart, value: left.value },
  ].sort((leftReplacement, rightReplacement) =>
    rightReplacement.start - leftReplacement.start
  );
  let changedObject = styleMap.object;
  for (const replacement of replacements) {
    changedObject = `${changedObject.slice(0, replacement.start)}${replacement.value}${changedObject.slice(replacement.end)}`;
  }
  if (changedObject === styleMap.object) {
    throw new Error(`${description} mutation did not change the compiled map`);
  }
  const objectIndex = compiledJavaScript.indexOf(styleMap.object);
  if (
    objectIndex < 0
    || objectIndex !== compiledJavaScript.lastIndexOf(styleMap.object)
  ) {
    throw new Error(`${description} mutation requires one exact actionStyles map`);
  }
  return `${compiledJavaScript.slice(0, objectIndex)}${changedObject}${compiledJavaScript.slice(
    objectIndex + styleMap.object.length,
  )}`;
}

function reverseActionRecipeOrder(
  compiledJavaScript: string,
  description: string,
): string {
  const styleMap = actionStyleMap(compiledJavaScript);
  const properties = [...styleMap.properties.values()];
  if (properties.length < 2) {
    throw new Error(`${description} mutation requires multiple action recipes`);
  }
  const reordered = properties.toReversed().map((property) => property.source);
  const changedObject = `{${reordered.join(",")}}`;
  if (changedObject === styleMap.object) {
    throw new Error(`${description} mutation did not reorder the compiled map`);
  }
  const objectIndex = compiledJavaScript.indexOf(styleMap.object);
  if (
    objectIndex < 0
    || objectIndex !== compiledJavaScript.lastIndexOf(styleMap.object)
  ) {
    throw new Error(`${description} mutation requires one exact actionStyles map`);
  }
  return `${compiledJavaScript.slice(0, objectIndex)}${changedObject}${compiledJavaScript.slice(
    objectIndex + styleMap.object.length,
  )}`;
}

function requireCheckboxConditionalDeclaration(
  rules: readonly CssRule[],
  condition: string,
  declaration: RegExp,
  description: string,
): void {
  const matches = rules.filter((rule) => declaration.test(rule.body));
  if (matches.length === 0) {
    throw new Error(`StyleX artifact is missing ${description}`);
  }
  if (matches.some(
    (rule) => normalizedHeader(rule.ancestors.at(-1)?.header ?? "") !== condition,
  )) {
    throw new Error(`${description} must remain directly inside ${condition}`);
  }
}

function relocateCheckboxConditionalRule(
  compiledJavaScript: string,
  compiledCss: string,
  condition: string,
  declaration: RegExp,
  description: string,
): string {
  const matches = checkboxStyleRules(compiledJavaScript, compiledCss).filter(
    (rule) =>
      declaration.test(rule.body)
      && normalizedHeader(rule.ancestors.at(-1)?.header ?? "") === condition,
  );
  if (matches.length !== 1) {
    throw new Error(`${description} mutation expected one conditional rule`);
  }
  const rule = matches[0]!;
  const conditional = rule.ancestors.at(-1)!;
  const withoutRule = conditional.body.replace(rule.source, "");
  if (withoutRule === conditional.body) {
    throw new Error(`${description} mutation could not remove its exact rule`);
  }
  const replacement = `${conditional.header}{${withoutRule}}${rule.source}`;
  const conditionalIndex = compiledCss.indexOf(conditional.source);
  if (
    conditionalIndex < 0
    || conditionalIndex !== compiledCss.lastIndexOf(conditional.source)
  ) {
    throw new Error(`${description} mutation requires one exact conditional block`);
  }
  return `${compiledCss.slice(0, conditionalIndex)}${replacement}${compiledCss.slice(
    conditionalIndex + conditional.source.length,
  )}`;
}

function replaceCheckboxDeclaration(
  compiledJavaScript: string,
  compiledCss: string,
  declaration: RegExp,
  replacement: string,
  description: string,
): string {
  const matches = checkboxStyleRules(compiledJavaScript, compiledCss).filter(
    (rule) => declaration.test(rule.body),
  );
  if (matches.length !== 1) {
    throw new Error(`${description} mutation expected one CheckboxField rule`);
  }
  const rule = matches[0]!;
  const mutatedRule = rule.source.replace(declaration, replacement);
  if (mutatedRule === rule.source) {
    throw new Error(`${description} mutation did not change its exact rule`);
  }
  const ruleIndex = compiledCss.indexOf(rule.source);
  if (ruleIndex < 0 || ruleIndex !== compiledCss.lastIndexOf(rule.source)) {
    throw new Error(`${description} mutation requires one exact CheckboxField rule`);
  }
  return `${compiledCss.slice(0, ruleIndex)}${mutatedRule}${compiledCss.slice(
    ruleIndex + rule.source.length,
  )}`;
}

function requireOnlyLayerBlocks(
  source: string,
  allowedLayers: ReadonlySet<string>,
  description: string,
): string[] {
  const statements = topLevelStatements(source, description);
  if (statements.length === 0) {
    throw new Error(`${description} must contain a named layer block`);
  }

  return statements.map((statement) => {
    const layer = statement.match(
      /^@layer\s+([A-Za-z0-9_.-]+)\s*\{/u,
    )?.[1];
    if (layer === undefined || !allowedLayers.has(layer)) {
      throw new Error(
        `${description} contains top-level content outside its allowed named layers`,
      );
    }
    return layer;
  });
}

function requirePublicLayerContract(
  legacyComponents: string,
  orderedStylesheet: string,
  compiledCss: string,
): void {
  const bareComponentsLayer = /@layer\s+components(?=\s*[,;{])/u;
  forbid(
    legacyComponents,
    bareComponentsLayer,
    "a bare direct components layer",
  );
  forbid(
    compiledCss,
    bareComponentsLayer,
    "a generated bare direct components layer",
  );

  const legacyLayers = requireOnlyLayerBlocks(
    legacyComponents,
    new Set(LEGACY_LAYERS),
    "src/components.css",
  );
  for (const expectedLayer of LEGACY_LAYERS) {
    if (!legacyLayers.includes(expectedLayer)) {
      throw new Error(`src/components.css must declare ${expectedLayer}`);
    }
  }
  const generatedLayers = requireOnlyLayerBlocks(
    compiledCss,
    new Set(STYLEX_LAYERS),
    "dist/stylex.css",
  );
  if (
    generatedLayers.length !== STYLEX_LAYERS.length
    || generatedLayers.some(
      (layer, index) => layer !== STYLEX_LAYERS[index],
    )
  ) {
    throw new Error(
      "dist/stylex.css must contain the exact priority1 < priority2 < priority3 < priority4 layer sequence",
    );
  }
  for (const expectedLayer of STYLEX_LAYERS) {
    if (!generatedLayers.includes(expectedLayer)) {
      throw new Error(`dist/stylex.css must declare ${expectedLayer}`);
    }
  }

  const lines = orderedStylesheet
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const expectedLines = [
    TOP_LEVEL_LAYER_PRELUDE,
    LAYER_PRELUDE,
    '@import "./tokens.css";',
    '@import "./reset.css";',
    COMPONENTS_IMPORT,
    STYLEX_IMPORT,
    '@import "./tailwind.css";',
  ];
  if (
    lines.length !== expectedLines.length
    || lines.some((line, index) => line !== expectedLines[index])
  ) {
    throw new Error(
      "src/styles.css must contain the exact base < components and legacy < priority1 < priority2 < priority3 < priority4 preludes and ordered public imports",
    );
  }
}

function requireEarliestLayerPrelude(resetStylesheet: string): void {
  const expectedPrefix = `${TOP_LEVEL_LAYER_PRELUDE}\n${LAYER_PRELUDE}\n`;
  if (!resetStylesheet.startsWith(expectedPrefix)) {
    throw new Error(
      "src/reset.css must begin with the exact base < components and legacy < priority1 < priority2 < priority3 < priority4 preludes",
    );
  }
}

function requireViewportHeightFallbacks(compiledCss: string): void {
  const fallbacks = [
    /height:\s*100vh;/gu,
    /height:\s*100svh;/gu,
    /height:\s*100dvh;/gu,
  ] as const;
  const positions = fallbacks.map((pattern) => {
    const matches = [...compiledCss.matchAll(pattern)];
    if (matches.length !== 1 || matches[0]?.index === undefined) {
      throw new Error(
        "dist/stylex.css must contain exactly one 100vh, 100svh, and 100dvh viewport height fallback",
      );
    }
    return matches[0].index;
  });
  if (!(positions[0]! < positions[1]! && positions[1]! < positions[2]!)) {
    throw new Error(
      "dist/stylex.css must preserve the 100vh < 100svh < 100dvh viewport height fallback order",
    );
  }
  requireMatch(
    compiledCss,
    /@supports\s*\(height:\s*100svh\)\s*\{[\s\S]*height:\s*100svh;[\s\S]*@supports\s*\(height:\s*100dvh\)\s*\{[\s\S]*height:\s*100dvh;/u,
    "the nested svh then dvh viewport height capability fallbacks",
  );
}

function requireThemedSurfaceContract(
  legacyComponents: string,
  compiledCss: string,
): void {
  forbid(
    legacyComponents,
    /\.hraness-themed-surface(?![A-Za-z0-9_-])/u,
    "a legacy themed-surface recipe",
  );
  const declarations = [
    [/background-color:\s*var\(--ui-accent\);/u, "the accent surface background"],
    [/background-color:\s*var\(--ui-card\);/u, "the card surface background"],
    [/background-color:\s*var\(--ui-foreground\);/u, "the inverse surface background"],
    [/background-color:\s*var\(--ui-popover\);/u, "the popover surface background"],
    [/background-color:\s*var\(--ui-secondary\);/u, "the secondary surface background"],
    [/border-color:\s*var\(--ui-border\);/u, "the surface border color"],
    [/border-color:\s*var\(--ui-foreground\);/u, "the inverse surface border color"],
    [/border-radius:\s*var\(--radius-lg\);/u, "the rounded surface shape"],
    [/border-radius:\s*var\(--radius-sharp\);/u, "the rectangular surface shape"],
    [/border-style:\s*solid;/u, "the surface border style"],
    [/border-width:\s*1px;/u, "the surface border width"],
    [/box-shadow:\s*var\(--elevation-raised\);/u, "the popover surface elevation"],
    [/color:\s*var\(--ui-accent-foreground\);/u, "the accent surface foreground"],
    [/color:\s*var\(--ui-background\);/u, "the inverse surface foreground"],
    [/color:\s*var\(--ui-card-foreground\);/u, "the card surface foreground"],
    [/color:\s*var\(--ui-popover-foreground\);/u, "the popover surface foreground"],
    [/color:\s*var\(--ui-secondary-foreground\);/u, "the secondary surface foreground"],
    [/min-inline-size:\s*0;/u, "the surface logical minimum"],
    [/padding-block:\s*var\(--space-6\);/u, "the surface block padding"],
    [/padding-inline:\s*var\(--space-6\);/u, "the surface inline padding"],
  ] as const;
  for (const [pattern, description] of declarations) {
    requireMatch(compiledCss, pattern, description);
  }
  forbid(
    compiledCss,
    /background:\s*var\(--ui-(?:accent|card|foreground|popover|secondary)\);/u,
    "a themed-surface background shorthand",
  );
  forbid(
    compiledCss,
    /border:\s*1px\s+solid\s+var\(--ui-border\);/u,
    "a themed-surface border shorthand",
  );
}

function requireAvatarContract(
  legacyComponents: string,
  compiledCss: string,
): void {
  forbid(
    legacyComponents,
    /\.hraness-avatar(?:__image|__fallback)?(?![A-Za-z0-9_-])/u,
    "a legacy avatar recipe",
  );
  const declarations = [
    [/align-items:\s*center;/u, "avatar alignment"],
    [/background-color:\s*var\(--ui-muted\);/u, "avatar background token"],
    [/border-radius:\s*var\(--radius-round\);/u, "avatar circular clipping radius"],
    [/color:\s*var\(--ui-muted-foreground\);/u, "avatar foreground token"],
    [/display:\s*inline-grid;/u, "avatar root display"],
    [/display:\s*grid;/u, "avatar fallback display"],
    [/flex:\s*none;/u, "avatar fixed flex normalization"],
    [/font-size:\s*var\(--text-caption\);/u, "avatar small text size"],
    [/font-size:\s*var\(--text-body\);/u, "avatar large text size"],
    [/font-weight:\s*var\(--font-weight-medium\);/u, "avatar fallback weight"],
    [/height:\s*100%;/u, "avatar child fill height"],
    [/height:\s*2rem;/u, "avatar small height"],
    [/height:\s*2\.5rem;/u, "avatar default height"],
    [/height:\s*3\.5rem;/u, "avatar large height"],
    [/justify-items:\s*center;/u, "avatar fallback centering"],
    [/object-fit:\s*cover;/u, "avatar image crop"],
    [/overflow:\s*hidden;/u, "avatar circular clipping"],
    [/width:\s*100%;/u, "avatar child fill width"],
    [/width:\s*2rem;/u, "avatar small width"],
    [/width:\s*2\.5rem;/u, "avatar default width"],
    [/width:\s*3\.5rem;/u, "avatar large width"],
  ] as const;
  for (const [pattern, description] of declarations) {
    requireMatch(compiledCss, pattern, description);
  }
  forbid(
    compiledCss,
    /background:\s*var\(--ui-muted\);/u,
    "an avatar background shorthand",
  );
  forbid(
    compiledCss,
    /place-items:\s*center;/u,
    "an unsupported avatar place-items shorthand",
  );
}

function requireStatusFamilyContract(
  legacyComponents: string,
  compiledCss: string,
): void {
  forbid(
    legacyComponents,
    /\.hraness-(?:badge(?:--[A-Za-z0-9_-]+)?|status-dot|tag(?:__(?:icon|label))?)(?![A-Za-z0-9_-])/u,
    "a legacy Badge, Badge tone alias, Tag, or StatusDot recipe",
  );
  const declarations = [
    [/align-items:\s*center;/u, "status-family alignment"],
    [/background-color:\s*#0000;/u, "the transparent outline Tag background"],
    [/background-color:\s*color-mix\(in oklch,var\(--ui-destructive\) 12%,var\(--ui-card\)\);/u, "the danger Badge background"],
    [/background-color:\s*var\(--ui-destructive\);/u, "the danger StatusDot background"],
    [/background-color:\s*var\(--ui-info-soft\);/u, "the info Badge background"],
    [/background-color:\s*var\(--ui-info\);/u, "the info StatusDot background"],
    [/background-color:\s*var\(--ui-muted-foreground\);/u, "the neutral StatusDot background"],
    [/background-color:\s*var\(--ui-muted\);/u, "the muted Tag background"],
    [/background-color:\s*var\(--ui-secondary\);/u, "the neutral status-pill background"],
    [/background-color:\s*var\(--ui-success-soft\);/u, "the success Badge background"],
    [/background-color:\s*var\(--ui-success\);/u, "the success StatusDot background"],
    [/background-color:\s*var\(--ui-warning-soft\);/u, "the warning Badge background"],
    [/background-color:\s*var\(--ui-warning\);/u, "the warning StatusDot background"],
    [/border-color:\s*#0000;/u, "the transparent default Tag border"],
    [/border-color:\s*canvastext;/u, "the forced-colors status-pill border"],
    [/border-color:\s*color-mix\(in oklch,currentColor 35%,transparent\);/u, "the StatusDot border"],
    [/border-color:\s*color-mix\(in oklch,var\(--ui-destructive\) 45%,var\(--ui-border\)\);/u, "the danger Badge border"],
    [/border-color:\s*color-mix\(in oklch,var\(--ui-info\) 45%,var\(--ui-border\)\);/u, "the info Badge border"],
    [/border-color:\s*color-mix\(in oklch,var\(--ui-success\) 45%,var\(--ui-border\)\);/u, "the success Badge border"],
    [/border-color:\s*color-mix\(in oklch,var\(--ui-warning\) 45%,var\(--ui-border\)\);/u, "the warning Badge border"],
    [/border-color:\s*var\(--hraness-tag-accent,\s*var\(--ui-border\)\);/u, "the public Tag accent variable"],
    [/border-radius:\s*var\(--radius-round\);/u, "the status-family round geometry"],
    [/border-style:\s*solid;/u, "the status-family border style"],
    [/border-width:\s*1px;/u, "the status-family border width"],
    [/color:\s*var\(--ui-destructive\);/u, "the danger Badge foreground"],
    [/color:\s*var\(--ui-foreground\);/u, "the outline Tag foreground"],
    [/color:\s*var\(--ui-info\);/u, "the info Badge foreground"],
    [/color:\s*var\(--ui-muted-foreground\);/u, "the muted Tag foreground"],
    [/color:\s*var\(--ui-secondary-foreground\);/u, "the neutral status-pill foreground"],
    [/color:\s*var\(--ui-success\);/u, "the success Badge foreground"],
    [/color:\s*var\(--ui-warning\);/u, "the warning Badge foreground"],
    [/display:\s*inline-block;/u, "the StatusDot display"],
    [/display:\s*inline-flex;/u, "the status-pill display"],
    [/flex:\s*none;/u, "the fixed status-child flex normalization"],
    [/font-size:\s*var\(--text-caption\);/u, "the status-pill text size"],
    [/font-weight:\s*var\(--font-weight-medium\);/u, "the status-pill text weight"],
    [/forced-color-adjust:\s*auto;/u, "the forced-colors status-pill adjustment"],
    [/gap:\s*var\(--space-1\);/u, "the status-pill gap"],
    [/height:\s*\.625rem;/u, "the StatusDot height"],
    [/justify-content:\s*center;/u, "the status-family centering"],
    [/line-height:\s*1;/u, "the status-family line height"],
    [/min-height:\s*1\.5rem;/u, "the status-pill minimum height"],
    [/min-width:\s*0;/u, "the Tag label shrink boundary"],
    [/padding-inline:\s*var\(--space-2\);/u, "the status-pill inline padding"],
    [/white-space:\s*nowrap;/u, "the status-pill wrapping contract"],
    [/width:\s*\.625rem;/u, "the StatusDot width"],
    [/width:\s*fit-content;/u, "the status-pill intrinsic width"],
  ] as const;
  for (const [pattern, description] of declarations) {
    requireMatch(compiledCss, pattern, description);
  }
  requireMatch(
    compiledCss,
    /@media\s*\(forced-colors:\s*active\)\s*\{[\s\S]*border-color:\s*canvastext;[\s\S]*forced-color-adjust:\s*auto;/u,
    "the forced-colors Badge and Tag override",
  );
  forbid(
    compiledCss,
    /background:\s*(?:transparent|var\(--ui-(?:destructive|info|muted|secondary|success|warning))/u,
    "a status-family background shorthand",
  );
  forbid(
    compiledCss,
    /border:\s*1px\s+solid/u,
    "a status-family border shorthand",
  );
}

function requireCardFamilyContract(
  legacyComponents: string,
  compiledCss: string,
  compiledJavaScript: string,
): void {
  const bridgeMatches = [
    ...legacyComponents.matchAll(CARD_DESCRIPTION_BRIDGE_PATTERN),
  ];
  if (bridgeMatches.length !== 1 || bridgeMatches[0]?.index === undefined) {
    throw new Error(
      "src/components.css must contain exactly one Card description compatibility bridge with no extra declarations",
    );
  }
  const interactiveLegacyLayerIndex = legacyComponents.indexOf(
    `@layer ${LEGACY_LAYER} {`,
  );
  if (
    interactiveLegacyLayerIndex < 0
    || bridgeMatches[0].index >= interactiveLegacyLayerIndex
  ) {
    throw new Error(
      "the Card description compatibility bridge must stay in the legacy.base layer",
    );
  }
  const legacyComponentsWithoutBridge = legacyComponents.replace(
    CARD_DESCRIPTION_BRIDGE_PATTERN,
    "",
  );
  forbid(
    legacyComponentsWithoutBridge,
    /\.hraness-(?:card(?:__(?:header|title|description|content|footer))?|pressable-card)(?![A-Za-z0-9_-])/u,
    "a legacy Card-family recipe beyond the compatibility bridge",
  );
  const declarations = [
    [/background-color:\s*var\(--ui-accent\);/u, "the accent Card background"],
    [/background-color:\s*var\(--ui-background\);/u, "the neutral Card background"],
    [/background-color:\s*var\(--ui-card\);/u, "the default Card background"],
    [/background-color:\s*var\(--ui-foreground\);/u, "the inverse Card background"],
    [/border-color:\s*canvastext;/u, "the forced-colors Card border"],
    [/border-color:\s*color-mix\(in oklch,var\(--ui-primary\) 28%,var\(--ui-border\)\);/u, "the accent Card border"],
    [/border-color:\s*color-mix\(in oklch,var\(--ui-primary\) 35%,var\(--ui-border\)\);/u, "the PressableCard hover border"],
    [/border-color:\s*var\(--ui-border\);/u, "the default Card border"],
    [/border-color:\s*var\(--ui-foreground\);/u, "the inverse Card border"],
    [/border-radius:\s*var\(--radius-lg\);/u, "the rounded Card shape"],
    [/border-radius:\s*var\(--radius-sharp\);/u, "the rectangular Card shape"],
    [/border-style:\s*solid;/u, "the Card border style"],
    [/border-width:\s*1px;/u, "the Card border width"],
    [/box-shadow:\s*var\(--elevation-low\);/u, "the Card elevation"],
    [/box-shadow:\s*var\(--elevation-raised\);/u, "the hovered PressableCard elevation"],
    [/color:\s*inherit;/u, "the CardTitle inherited foreground"],
    [/color:\s*var\(--hraness-card-description\);/u, "the public Card description variable consumer"],
    [/color:\s*var\(--ui-accent-foreground\);/u, "the accent Card foreground"],
    [/color:\s*var\(--ui-background\);/u, "the inverse Card foreground"],
    [/color:\s*var\(--ui-card-foreground\);/u, "the default Card foreground"],
    [/color:\s*var\(--ui-foreground\);/u, "the neutral Card foreground"],
    [/display:\s*flex;/u, "the Card and CardFooter flex layout"],
    [/display:\s*grid;/u, "the CardHeader and PressableCard grid layout"],
    [/flex-direction:\s*column;/u, "the Card column layout"],
    [/flex-wrap:\s*wrap;/u, "the CardFooter wrapping"],
    [/font-size:\s*var\(--text-heading\);/u, "the CardTitle size"],
    [/font-size:\s*var\(--text-label\);/u, "the CardDescription size"],
    [/font-weight:\s*var\(--font-weight-bold\);/u, "the CardTitle weight"],
    [/forced-color-adjust:\s*auto;/u, "the forced-colors Card adjustment"],
    [/gap:\s*var\(--space-2\);/u, "the CardHeader and CardFooter gap"],
    [/gap:\s*var\(--space-4\);/u, "the PressableCard gap"],
    [/gap:\s*var\(--space-6\);/u, "the Card root gap"],
    [/line-height:\s*1\.2;/u, "the CardTitle line height"],
    [/line-height:\s*1\.5;/u, "the CardDescription line height"],
    [/min-width:\s*0;/u, "the physical PressableCard shrink boundary"],
    [/outline-color:\s*var\(--ui-ring\);/u, "the PressableCard focus ring color"],
    [/outline-offset:\s*3px;/u, "the PressableCard focus ring offset"],
    [/outline-style:\s*solid;/u, "the PressableCard focus ring style"],
    [/outline-width:\s*2px;/u, "the PressableCard focus ring width"],
    [/padding-block:\s*var\(--space-6\);/u, "the Card-family block padding"],
    [/padding-inline:\s*var\(--space-6\);/u, "the Card-family inline padding"],
    [/text-align:\s*start;/u, "the PressableCard logical text alignment"],
    [/transform:\s*translateY\(1px\);/u, "the pressed PressableCard transform"],
    [/transition-delay:\s*0s, 0s, 0s;/u, "the PressableCard transition delay"],
    [/transition-duration:\s*var\(--motion-duration-fast\),var\(--motion-duration-fast\),var\(--motion-duration-fast\);/u, "the PressableCard transition duration"],
    [/transition-property:\s*border-color, box-shadow, transform;/u, "the PressableCard transition properties"],
    [/transition-timing-function:\s*var\(--motion-easing-standard\),var\(--motion-easing-standard\),var\(--motion-easing-standard\);/u, "the PressableCard transition easing"],
    [/width:\s*100%;/u, "the physical PressableCard width"],
  ] as const;
  for (const [pattern, description] of declarations) {
    requireMatch(compiledCss, pattern, description);
  }
  const nativePseudoFallbacks = [
    [/:hover\s*\{\s*border-color:\s*color-mix\(in oklch,var\(--ui-primary\) 35%,var\(--ui-border\)\);/u, "the native PressableCard hover fallback"],
    [/:active\s*\{\s*transform:\s*translateY\(1px\);/u, "the native PressableCard active fallback"],
    [/:focus-visible\s*\{\s*outline-color:\s*var\(--ui-ring\);/u, "the native PressableCard focus-visible fallback"],
  ] as const;
  for (const [pattern, description] of nativePseudoFallbacks) {
    requireMatch(compiledCss, pattern, description);
  }
  for (const [pattern, description] of [
    [/--_hraness-card-description/u, "the literal private Card description inline property"],
    [/color-mix\(in oklch,\s*var\(--ui-accent-foreground\) 78%,\s*var\(--ui-accent\)\)/u, "the accent Card description tone"],
    [/color-mix\(in oklch,\s*var\(--ui-background\) 80%,\s*var\(--ui-foreground\)\)/u, "the inverse Card description tone"],
    [/isHovered/u, "the React Aria hover-state recipe seam"],
    [/isPressed/u, "the React Aria pressed-state recipe seam"],
    [/isFocusVisible/u, "the React Aria focus-visible recipe seam"],
  ] as const) {
    requireMatch(compiledJavaScript, pattern, description);
  }
  forbid(
    compiledCss,
    /--hraness-card-description\s*:/u,
    "a generated public Card description variable assignment",
  );
  forbid(
    compiledCss,
    /--_hraness-card-description/u,
    "the private Card description inline property in generated CSS",
  );
  forbid(
    compiledCss,
    /background:\s*var\(--ui-(?:accent|background|card|foreground)\);/u,
    "a Card-family background shorthand",
  );
  forbid(
    compiledCss,
    /border:\s*1px\s+solid/u,
    "a Card-family border shorthand",
  );
  forbid(
    compiledCss,
    /outline:\s*(?:2px|none)/u,
    "a PressableCard outline shorthand",
  );
  forbid(
    compiledCss,
    /padding:\s*var\(--space-6\);/u,
    "a Card-family padding shorthand",
  );
  forbid(
    compiledCss,
    /transition:\s*border-color/u,
    "a PressableCard transition shorthand",
  );
}

function requireCardFamilyCallerFallbackSeam(cardSource: string): void {
  const seams = cardSource.match(
    /!hasStylexPresentation\(xstyle\)\s*&&\s*cardStyles\.nativeInteractionFallbacks/gu,
  ) ?? [];
  if (seams.length !== 1) {
    throw new Error(
      "src/card.tsx must omit native PressableCard pseudo fallbacks exactly when caller xstyle contributes presentation",
    );
  }
}

function requireToolbarContract(
  legacyComponents: string,
  compiledCss: string,
  compiledJavaScript: string,
): void {
  forbid(
    legacyComponents,
    /\.hraness-toolbar(?![A-Za-z0-9_-])/u,
    "a legacy Toolbar recipe",
  );
  const rootRules = toolbarStyleRules(
    compiledJavaScript,
    compiledCss,
    "root",
  );
  const verticalRules = toolbarStyleRules(
    compiledJavaScript,
    compiledCss,
    "vertical",
  );
  const nativeFocusRules = toolbarStyleRules(
    compiledJavaScript,
    compiledCss,
    "nativeFocusFallback",
  );
  const rootClassNames = toolbarStyleClassNames(compiledJavaScript, "root");
  const verticalClassNames = toolbarStyleClassNames(compiledJavaScript, "vertical");
  const nativeFocusClassNames = toolbarStyleClassNames(
    compiledJavaScript,
    "nativeFocusFallback",
  );
  const rootCss = rootRules.map((rule) => rule.source).join("\n");
  const verticalCss = verticalRules.map((rule) => rule.source).join("\n");
  const nativeFocusCss = nativeFocusRules.map((rule) => rule.source).join("\n");
  const rootDeclarations = [
    [/align-items:\s*center;/u, "the horizontal Toolbar alignment"],
    [/background-color:\s*var\(--ui-card\);/u, "the Toolbar background"],
    [/border-color:\s*var\(--ui-border\);/u, "the Toolbar border color"],
    [/border-radius:\s*var\(--radius-lg\);/u, "the Toolbar radius"],
    [/border-style:\s*solid;/u, "the Toolbar border style"],
    [/border-width:\s*1px;/u, "the Toolbar border width"],
    [/display:\s*flex;/u, "the Toolbar flex layout"],
    [/flex-wrap:\s*wrap;/u, "the horizontal Toolbar wrapping"],
    [/gap:\s*var\(--space-1\);/u, "the Toolbar gap"],
    [/min-width:\s*0;/u, "the physical Toolbar shrink boundary"],
    [/padding-block:\s*var\(--space-1\);/u, "the Toolbar block padding"],
    [/padding-inline:\s*var\(--space-1\);/u, "the Toolbar inline padding"],
  ] as const;
  for (const [pattern, description] of rootDeclarations) {
    requireMatch(rootCss, pattern, description);
    for (const selector of declarationSelectors(
      rootRules,
      rootClassNames,
      pattern,
      description,
    )) {
      forbid(
        selector,
        /:(?:focus-visible|hover)(?![A-Za-z0-9_-])/u,
        `a pseudo-qualified ${description}`,
      );
    }
  }
  const verticalDeclarations = [
    [/align-items:\s*stretch;/u, "the vertical Toolbar alignment"],
    [/flex-direction:\s*column;/u, "the vertical Toolbar direction"],
    [/flex-wrap:\s*nowrap;/u, "the vertical Toolbar wrapping"],
    [/width:\s*fit-content;/u, "the vertical Toolbar width"],
  ] as const;
  for (const [pattern, description] of verticalDeclarations) {
    requireMatch(verticalCss, pattern, description);
    for (const selector of declarationSelectors(
      verticalRules,
      verticalClassNames,
      pattern,
      description,
    )) {
      forbid(
        selector,
        /:(?:focus-visible|hover)(?![A-Za-z0-9_-])/u,
        `a pseudo-qualified ${description}`,
      );
    }
  }
  const focusDeclarations = [
    [/outline-color:\s*var\(--ui-ring\);/u, "the Toolbar focus ring color"],
    [/outline-offset:\s*2px;/u, "the Toolbar focus ring offset"],
    [/outline-style:\s*solid;/u, "the Toolbar focus ring style"],
    [/outline-width:\s*2px;/u, "the Toolbar focus ring width"],
  ] as const;
  for (const [pattern, description] of focusDeclarations) {
    requireMatch(nativeFocusCss, pattern, description);
    for (const selector of declarationSelectors(
      nativeFocusRules,
      nativeFocusClassNames,
      pattern,
      description,
    )) {
      requirePositivePseudoSelector(
        selector,
        "focus-visible",
        `the native ${description} selector`,
      );
    }
  }
  forbid(
    rootCss,
    /background:\s*var\(--ui-card\);/u,
    "a Toolbar background shorthand",
  );
  forbid(
    rootCss,
    /border:\s*1px\s+solid\s+var\(--ui-border\)/u,
    "a Toolbar border shorthand",
  );
  forbid(
    nativeFocusCss,
    /outline:\s*2px\s+solid\s+var\(--ui-ring\)/u,
    "a Toolbar outline shorthand",
  );
  forbid(
    rootCss,
    /padding:\s*var\(--space-1\)/u,
    "a Toolbar padding shorthand",
  );
}

function requireToolbarCallerFallbackSeam(toolbarSource: string): void {
  const seams = toolbarSource.match(
    /!hasStylexPresentation\(xstyle\)\s*&&\s*toolbarStyles\.nativeFocusFallback/gu,
  ) ?? [];
  if (seams.length !== 1) {
    throw new Error(
      "src/toolbar.tsx must omit the native Toolbar focus fallback exactly when caller xstyle contributes presentation",
    );
  }
}

function requireKeyHintContract(
  legacyComponents: string,
  compiledCss: string,
): void {
  forbid(
    legacyComponents,
    /\.hraness-key-hint(?![A-Za-z0-9_-])/u,
    "a legacy KeyHint recipe",
  );
  const declarations = [
    [/align-items:\s*center;/u, "the KeyHint block-axis alignment"],
    [/background-color:\s*var\(--ui-muted\);/u, "the KeyHint background"],
    [/border-block-end-width:\s*2px;/u, "the KeyHint block-end depth"],
    [/border-color:\s*var\(--ui-border\);/u, "the KeyHint border color"],
    [/border-radius:\s*var\(--radius-sm\);/u, "the KeyHint radius"],
    [/border-style:\s*solid;/u, "the KeyHint border style"],
    [/border-width:\s*1px;/u, "the KeyHint border width"],
    [/color:\s*var\(--ui-muted-foreground\);/u, "the KeyHint foreground"],
    [/display:\s*inline-flex;/u, "the KeyHint layout"],
    [/font-family:\s*var\(--ui-font-mono\);/u, "the KeyHint font family"],
    [/font-size:\s*var\(--text-caption\);/u, "the KeyHint font size"],
    [/justify-content:\s*center;/u, "the KeyHint inline-axis alignment"],
    [/min-block-size:\s*1\.5rem;/u, "the KeyHint minimum block size"],
    [/min-inline-size:\s*1\.5rem;/u, "the KeyHint minimum inline size"],
    [/padding-inline:\s*var\(--space-1\);/u, "the KeyHint inline padding"],
  ] as const;
  for (const [pattern, description] of declarations) {
    requireMatch(compiledCss, pattern, description);
  }
  forbid(
    compiledCss,
    /background:\s*var\(--ui-muted\);/u,
    "a KeyHint background shorthand",
  );
  forbid(
    compiledCss,
    /border:\s*1px\s+solid\s+var\(--ui-border\)/u,
    "a KeyHint border shorthand",
  );
  forbid(
    compiledCss,
    /padding:\s*var\(--space-1\)/u,
    "a KeyHint padding shorthand",
  );
}

function requireKeyHintSourceContract(contentSource: string): void {
  forbid(
    contentSource,
    /^\s*["']use client["'];?/u,
    "a client boundary on the server-compatible content module",
  );
  requireMatch(
    contentSource,
    /stylex\.props\(keyHintStyles\.root,\s*xstyle\)/u,
    "the caller-last KeyHint xstyle merge",
  );
  requireMatch(
    contentSource,
    /mergeStylexInlineStyles\(presentation\.style,\s*style\)/u,
    "the KeyHint StyleX-before-native inline merge",
  );
}

function requireLinkContract(
  legacyComponents: string,
  compiledCss: string,
  compiledJavaScript: string,
): void {
  forbid(
    legacyComponents,
    /\.hraness-link(?![A-Za-z0-9_-])/u,
    "a legacy Link recipe",
  );
  const rootRules = linkStyleRules(
    compiledJavaScript,
    compiledCss,
    "root",
  );
  const hoveredRules = linkStyleRules(
    compiledJavaScript,
    compiledCss,
    "hovered",
  );
  const focusVisibleRules = linkStyleRules(
    compiledJavaScript,
    compiledCss,
    "focusVisible",
  );
  const nativeFallbackRules = linkStyleRules(
    compiledJavaScript,
    compiledCss,
    "nativeInteractionFallbacks",
  );
  const rootClassNames = linkStyleClassNames(compiledJavaScript, "root");
  const hoveredClassNames = linkStyleClassNames(compiledJavaScript, "hovered");
  const focusVisibleClassNames = linkStyleClassNames(
    compiledJavaScript,
    "focusVisible",
  );
  const nativeFallbackClassNames = linkStyleClassNames(
    compiledJavaScript,
    "nativeInteractionFallbacks",
  );
  const rootCss = rootRules.map((rule) => rule.source).join("\n");
  const hoveredCss = hoveredRules.map((rule) => rule.source).join("\n");
  const focusVisibleCss = focusVisibleRules
    .map((rule) => rule.source).join("\n");
  const nativeFallbackCss = nativeFallbackRules
    .map((rule) => rule.source).join("\n");
  const rootDeclarations = [
    [/border-radius:\s*var\(--radius-sm\);/u, "the Link radius"],
    [/color:\s*var\(--ui-primary\);/u, "the Link color"],
    [/text-decoration:\s*underline;/u, "the Link underline"],
    [/text-decoration-thickness:\s*1px;/u, "the Link base underline thickness"],
    [/text-underline-offset:\s*0?\.2em;/u, "the Link underline offset"],
  ] as const;
  for (const [pattern, description] of rootDeclarations) {
    requireMatch(rootCss, pattern, description);
    for (const selector of declarationSelectors(
      rootRules,
      rootClassNames,
      pattern,
      description,
    )) {
      forbid(
        selector,
        /:(?:focus-visible|hover)(?![A-Za-z0-9_-])/u,
        `a pseudo-qualified ${description}`,
      );
    }
  }
  const hoveredDeclaration = /text-decoration-thickness:\s*2px;/u;
  requireMatch(
    hoveredCss,
    hoveredDeclaration,
    "the Link hovered underline thickness",
  );
  for (const selector of declarationSelectors(
    hoveredRules,
    hoveredClassNames,
    hoveredDeclaration,
    "the Link hovered underline thickness",
  )) {
    forbid(
      selector,
      /:hover(?![A-Za-z0-9_-])/u,
      "a pseudo-qualified explicit Link hovered recipe",
    );
  }
  const focusDeclarations = [
    [/outline-color:\s*var\(--ui-ring\);/u, "the Link focus-ring color"],
    [/outline-offset:\s*2px;/u, "the Link focus-ring offset"],
    [/outline-style:\s*solid;/u, "the Link focus-ring style"],
    [/outline-width:\s*2px;/u, "the Link focus-ring width"],
  ] as const;
  for (const [pattern, description] of focusDeclarations) {
    requireMatch(focusVisibleCss, pattern, description);
    requireMatch(nativeFallbackCss, pattern, `the native ${description}`);
    for (const selector of declarationSelectors(
      focusVisibleRules,
      focusVisibleClassNames,
      pattern,
      description,
    )) {
      forbid(
        selector,
        /:focus-visible(?![A-Za-z0-9_-])/u,
        `a pseudo-qualified explicit ${description}`,
      );
    }
    for (const selector of declarationSelectors(
      nativeFallbackRules,
      nativeFallbackClassNames,
      pattern,
      `the native ${description}`,
    )) {
      requirePositivePseudoSelector(
        selector,
        "focus-visible",
        `the native ${description} selector`,
      );
    }
  }
  requireMatch(
    nativeFallbackCss,
    hoveredDeclaration,
    "the native Link hover thickness",
  );
  for (const selector of declarationSelectors(
    nativeFallbackRules,
    nativeFallbackClassNames,
    hoveredDeclaration,
    "the native Link hover thickness",
  )) {
    requirePositivePseudoSelector(
      selector,
      "hover",
      "the native Link hover fallback selector",
    );
  }
  forbid(
    `${focusVisibleCss}\n${nativeFallbackCss}`,
    /outline:\s*2px\s+solid\s+var\(--ui-ring\)/u,
    "a Link outline shorthand",
  );
}

function requireLinkSourceContract(actionsSource: string): void {
  const start = actionsSource.indexOf("export type LinkProps");
  const end = actionsSource.indexOf("export type LinkButtonProps", start);
  if (start < 0 || end < 0) {
    throw new Error("src/actions.tsx must retain the bounded Link source family");
  }
  const linkSource = actionsSource.slice(start, end);
  requireMatch(linkSource, /href:\s*RequiredHref;/u, "the required Link href");
  requireMatch(linkSource, /xstyle\?:\s*StyleXStyles;/u, "the typed Link xstyle seam");
  requireMatch(
    linkSource,
    /!hasStylexPresentation\(xstyle\)\s*&&\s*linkStyles\.nativeInteractionFallbacks/u,
    "the conditional native Link interaction fallbacks",
  );
  requireMatch(
    linkSource,
    /state\.isHovered\s*&&\s*linkStyles\.hovered/u,
    "the explicit React Aria Link hover recipe",
  );
  requireMatch(
    linkSource,
    /state\.isFocusVisible\s*&&\s*linkStyles\.focusVisible/u,
    "the explicit React Aria Link focus recipe",
  );
  requireMatch(
    linkSource,
    /stylex\.props\(\s*linkStyles\.root,\s*!hasStylexPresentation\(xstyle\)\s*&&\s*linkStyles\.nativeInteractionFallbacks,\s*state\.isHovered\s*&&\s*linkStyles\.hovered,\s*state\.isFocusVisible\s*&&\s*linkStyles\.focusVisible,\s*xstyle,?\s*\)/u,
    "the caller-last Link state and xstyle merge",
  );
  requireMatch(
    linkSource,
    /mergeStylexInlineStyles\(presentation\.style,\s*callerStyle\)/u,
    "the Link StyleX-before-native inline merge",
  );
  requireMatch(linkSource, /["']hraness-link["']/u, "the Link semantic hook");
  requireMatch(linkSource, /data-slot=["']link["']/u, "the Link semantic slot");
}

function requireActionFamilyContract(
  legacyComponents: string,
  compiledCss: string,
  compiledJavaScript: string,
  actionsSource: string,
): void {
  forbid(
    legacyComponents,
    /\.hraness-(?:action__spinner|(?:button|copy-button|icon-button|icon-link|inline-icon-link|link-button|toggle-button)(?:__[A-Za-z0-9_-]+)?)(?![A-Za-z0-9_-])/u,
    "a legacy action-family recipe",
  );
  const classNamesByKey = actionStyleClassNamesByKey(compiledJavaScript);
  const compiledRules = cssRules(compiledCss, "dist/stylex.css");
  const rulesForRecipe = (key: string): CssRule[] => {
    const classNames = classNamesByKey.get(key);
    if (classNames === undefined) {
      throw new Error(`the compiled actionStyles map is missing ${key}`);
    }
    const rules = rulesForClassNames(compiledRules, classNames);
    if (rules.length === 0) {
      throw new Error(`dist/stylex.css has no rules owned by actionStyles.${key}`);
    }
    return rules;
  };
  for (const [key, pattern, description] of [
    ["danger", /background-color:\s*var\(--ui-destructive\);/u, "the danger action surface"],
    ["hoveredQuiet", /background-color:\s*var\(--ui-accent\);/u, "the quiet hover surface"],
    ["control", /font-family:\s*inherit;/u, "the inherited action font family"],
    ["control", /font-stretch:\s*inherit;/u, "the inherited action font stretch"],
    ["control", /font-style:\s*inherit;/u, "the inherited action font style"],
    ["control", /font-variant:\s*inherit;/u, "the inherited action font variant"],
    ["inlineControl", /(?:^|;)\s*height:\s*1\.5rem;/u, "the inline IconLink height"],
    ["inlineControl", /min-height:\s*1\.5rem;/u, "the inline IconLink minimum height"],
    ["inlineControl", /min-width:\s*1\.5rem;/u, "the inline IconLink minimum width"],
    ["inlineControl", /(?:^|;)\s*width:\s*1\.5rem;/u, "the inline IconLink width"],
    ["spinner", /animation-name:\s*hraness-spin;/u, "the action spinner animation"],
  ] as const) {
    requireActionUnconditionalDeclaration(
      rulesForRecipe(key),
      pattern,
      description,
    );
  }
  for (const [key, pattern, description] of [
    ["compactControl", /min-height:\s*var\(--interactive-target-min\);/u, "the compact action coarse-pointer height"],
    ["compactIconControl", /min-height:\s*var\(--interactive-target-min\);/u, "the compact icon action coarse-pointer height"],
    ["compactIconControl", /min-width:\s*var\(--interactive-target-min\);/u, "the compact icon action coarse-pointer minimum width"],
    ["compactIconControl", /(?:^|;)\s*width:\s*var\(--interactive-target-min\);/u, "the compact icon action coarse-pointer width"],
    ["control", /min-height:\s*var\(--interactive-target-min\);/u, "the default action coarse-pointer height"],
    ["control", /min-width:\s*var\(--interactive-target-min\);/u, "the default action coarse-pointer minimum width"],
    ["iconControl", /min-height:\s*var\(--interactive-target-min\);/u, "the icon action coarse-pointer height"],
    ["iconControl", /min-width:\s*var\(--interactive-target-min\);/u, "the icon action coarse-pointer minimum width"],
    ["iconControl", /(?:^|;)\s*width:\s*var\(--interactive-target-min\);/u, "the icon action coarse-pointer width"],
    ["iconOnlyToggle", /min-width:\s*var\(--interactive-target-min\);/u, "the icon-only toggle coarse-pointer minimum width"],
    ["iconOnlyToggle", /(?:^|;)\s*width:\s*var\(--interactive-target-min\);/u, "the icon-only toggle coarse-pointer width"],
    ["largeControl", /min-height:\s*var\(--control-height-primary\);/u, "the large action coarse-pointer height"],
    ["largeIconControl", /min-height:\s*var\(--control-height-primary\);/u, "the large icon action coarse-pointer height"],
    ["largeIconControl", /min-width:\s*var\(--control-height-primary\);/u, "the large icon action coarse-pointer minimum width"],
    ["largeIconControl", /(?:^|;)\s*width:\s*var\(--control-height-primary\);/u, "the large icon action coarse-pointer width"],
    ["transportControl", /min-height:\s*var\(--control-height-transport\);/u, "the transport action coarse-pointer height"],
    ["transportIconControl", /min-height:\s*var\(--control-height-transport\);/u, "the transport icon action coarse-pointer height"],
    ["transportIconControl", /min-width:\s*var\(--control-height-transport\);/u, "the transport icon action coarse-pointer minimum width"],
    ["transportIconControl", /(?:^|;)\s*width:\s*var\(--control-height-transport\);/u, "the transport icon action coarse-pointer width"],
  ] as const) {
    requireActionConditionalDeclaration(
      rulesForRecipe(key),
      "@media(pointer:coarse)",
      pattern,
      description,
    );
  }
  const forcedColorContracts: Array<readonly [string, RegExp, string]> = [
    ["control", /border-color:\s*canvastext;/u, "the forced-color action border"],
  ];
  for (const key of ["quiet", "labeledQuiet"] as const) {
    forcedColorContracts.push([
      key,
      /border-color:\s*canvastext;/u,
      `the forced-color ${key} border`,
    ]);
  }
  for (const key of [
    "labeledDanger",
    "labeledPrimary",
    "labeledQuiet",
    "labeledSecondary",
    "hoveredLabeledDanger",
    "hoveredLabeledPrimary",
    "hoveredLabeledQuiet",
    "hoveredLabeledSecondary",
    "nativeLabeledDangerHover",
    "nativeLabeledPrimaryHover",
    "nativeLabeledQuietHover",
    "nativeLabeledSecondaryHover",
  ] as const) {
    forcedColorContracts.push(
      [
        key,
        /background-color:\s*buttonface;/u,
        `the forced-color ${key} surface`,
      ],
      [
        key,
        /(?:^|;)\s*color:\s*buttontext;/u,
        `the forced-color ${key} text`,
      ],
    );
  }
  for (const key of ["selected", "nativeSelectedHover"] as const) {
    forcedColorContracts.push(
      [
        key,
        /background-color:\s*buttonface;/u,
        `the forced-color ${key} surface`,
      ],
      [
        key,
        /border-color:\s*canvastext;/u,
        `the forced-color ${key} border`,
      ],
      [
        key,
        /(?:^|;)\s*color:\s*buttontext;/u,
        `the forced-color ${key} text`,
      ],
    );
  }
  for (const [key, pattern, description] of forcedColorContracts) {
    requireActionConditionalDeclaration(
      rulesForRecipe(key),
      "@media(forced-colors:active)",
      pattern,
      description,
    );
  }
  requireActionConditionalDeclaration(
    rulesForRecipe("spinner"),
    "@media(prefers-reduced-motion:reduce)",
    /animation-name:\s*none;/u,
    "the reduced-motion action spinner",
  );
  requireMatch(
    legacyComponents,
    /:root\[data-verification-pointer=["']coarse["']\]\s*\{\s*--hraness-action-coarse-min:\s*var\(--interactive-target-min\);\s*\}/u,
    "the synthetic coarse-pointer action variable",
  );
  requireMatch(
    actionsSource,
    /xstyle\?:\s*StyleXStyles;/u,
    "the action wrapper xstyle seam",
  );
  requireMatch(
    actionsSource,
    /controlXstyle\?:\s*StyleXStyles;/u,
    "the action controlXstyle seam",
  );
  requireMatch(
    actionsSource,
    /partXstyles\?:\s*ActionLabelPartXstyles;/u,
    "the closed action label-part seam",
  );
  const actionRootStart = actionsSource.indexOf(
    "function actionRootPresentation(",
  );
  const actionControlStart = actionsSource.indexOf(
    "function actionControlPresentation(",
    actionRootStart,
  );
  const inlineControlStart = actionsSource.indexOf(
    "function inlineIconControlPresentation(",
    actionControlStart,
  );
  const pendingIndicatorStart = actionsSource.indexOf(
    "function PendingIndicator(",
    inlineControlStart,
  );
  if (
    actionRootStart < 0
    || actionControlStart < 0
    || inlineControlStart < 0
    || pendingIndicatorStart < 0
  ) {
    throw new Error("src/actions.tsx must retain the bounded action presentation helpers");
  }
  const actionRootSource = actionsSource.slice(
    actionRootStart,
    actionControlStart,
  );
  const actionControlSource = actionsSource.slice(
    actionControlStart,
    inlineControlStart,
  );
  const inlineControlSource = actionsSource.slice(
    inlineControlStart,
    pendingIndicatorStart,
  );
  requireMatch(
    actionRootSource,
    /stylex\.props\(\s*actionStyles\.root,\s*xstyle,?\s*\)/u,
    "the action wrapper caller precedence",
  );
  requireMatch(
    actionControlSource,
    /!hasControlPresentation\s*&&\s*actionStyles\.nativeInteractionFallbacks,/u,
    "the conditional native action interaction fallbacks",
  );
  requireMatch(
    actionControlSource,
    /!hasControlPresentation\s*&&\s*\(options\.labeled\s*\?\s*actionNativeLabeledHoverStyles\[variant\]\s*:\s*actionNativeHoverStyles\[variant\]\),/u,
    "the conditional native action hover fallbacks",
  );
  requireMatch(
    actionControlSource,
    /stylex\.props\(\s*actionStyles\.control,[\s\S]*?!hasControlPresentation\s*&&\s*actionStyles\.nativeInteractionFallbacks,\s*!hasControlPresentation\s*&&\s*\(options\.labeled\s*\?\s*actionNativeLabeledHoverStyles\[variant\]\s*:\s*actionNativeHoverStyles\[variant\]\),\s*state\.isHovered\s*&&\s*\(options\.labeled\s*\?\s*actionLabeledHoverStyles\[variant\]\s*:\s*actionHoverStyles\[variant\]\),[\s\S]*?state\.isSelected\s*&&\s*actionStyles\.selected,[\s\S]*?!hasControlPresentation\s*&&\s*state\.isSelected\s*&&\s*actionStyles\.nativeSelectedHover,[\s\S]*?controlXstyle,?\s*\);/u,
    "the action state, selection, and caller precedence",
  );
  requireMatch(
    inlineControlSource,
    /!hasStylexPresentation\(controlXstyle\)\s*&&\s*actionStyles\.nativeInlineInteractionFallbacks,/u,
    "the conditional native inline IconLink interaction fallbacks",
  );
  requireMatch(
    inlineControlSource,
    /stylex\.props\(\s*actionStyles\.inlineControl,\s*!hasStylexPresentation\(controlXstyle\)\s*&&\s*actionStyles\.nativeInlineInteractionFallbacks,\s*state\.isHovered\s*&&\s*actionStyles\.hoveredQuiet,\s*state\.isFocusVisible\s*&&\s*actionStyles\.focusVisible,\s*state\.isDisabled\s*&&\s*actionStyles\.disabled,\s*controlXstyle,?\s*\);/u,
    "the inline IconLink state and caller precedence",
  );
  for (const {
    component,
    endMarker,
    presentation,
    startMarker,
  } of ACTION_NATIVE_STYLE_SITES) {
    const componentSource = boundedSource(
      actionsSource,
      startMarker,
      endMarker,
      `the ${component} action component`,
    ).body;
    const mergeCallCount = componentSource.match(/mergeStylexInlineStyles\s*\(/gu)?.length ?? 0;
    if (mergeCallCount !== 1) {
      throw new Error(
        `the ${component} action component must retain exactly one native inline-style merge; found ${String(mergeCallCount)}`,
      );
    }
    requireMatch(
      componentSource,
      new RegExp(
        `mergeStylexInlineStyles\\(\\s*${presentation}\\.style,\\s*callerStyle,?\\s*\\)`,
        "u",
      ),
      `the ${component} StyleX-before-native inline merge`,
    );
  }
}

function requireSkipLinkContract(
  legacyComponents: string,
  compiledCss: string,
  skipLinkSource: string,
): void {
  forbid(
    legacyComponents,
    /\.hraness-skip-link(?![A-Za-z0-9_-])/u,
    "a legacy SkipLink recipe",
  );
  for (const [pattern, description] of [
    [/align-items:\s*center;/u, "the SkipLink alignment"],
    [/background-attachment:\s*scroll;/u, "the SkipLink background attachment reset"],
    [/background-clip:\s*border-box;/u, "the SkipLink background clip reset"],
    [/background-color:\s*var\(--ui-foreground\);/u, "the SkipLink background color"],
    [/background-image:\s*none;/u, "the SkipLink background image reset"],
    [/background-origin:\s*padding-box;/u, "the SkipLink background origin reset"],
    [/background-position:\s*0 0;/u, "the SkipLink background position reset"],
    [/background-repeat:\s*repeat;/u, "the SkipLink background repeat reset"],
    [/background-size:\s*auto;/u, "the SkipLink background size reset"],
    [/border-radius:\s*var\(--radius-md\);/u, "the SkipLink radius"],
    [/color:\s*var\(--ui-background\);/u, "the SkipLink foreground"],
    [/display:\s*inline-flex;/u, "the SkipLink display"],
    [/font-weight:\s*var\(--font-weight-medium\);/u, "the SkipLink weight"],
    [/position:\s*fixed;/u, "the fixed SkipLink position"],
    [/z-index:\s*var\(--z-skip-link\);/u, "the SkipLink stack order"],
    [/inset-block-start:\s*var\(--space-3\);/u, "the SkipLink block inset"],
    [/inset-inline-start:\s*var\(--space-3\);/u, "the SkipLink inline inset"],
    [/min-height:\s*var\(--interactive-target-min\);/u, "the SkipLink target height"],
    [/padding-inline:\s*var\(--space-4\);/u, "the SkipLink inline padding"],
    [
      /transform:\s*translateY\(calc\(-100%\s*-\s*var\(--space-6\)\)\);/u,
      "the offscreen SkipLink transform",
    ],
    [
      /:focus\s*\{[^{}]*transform:\s*translateY\(0\);/u,
      "the native SkipLink focus reveal",
    ],
  ] as const) {
    requireMatch(compiledCss, pattern, description);
  }
  requireMatch(
    skipLinkSource,
    /xstyle\?:\s*StyleXStyles;/u,
    "the typed SkipLink xstyle seam",
  );
  requireMatch(
    skipLinkSource,
    /stylex\.props\(skipLinkStyles\.root,\s*xstyle\)/u,
    "the caller-last SkipLink StyleX composition",
  );
  requireMatch(
    skipLinkSource,
    /cn\(\s*["']hraness-skip-link["'],\s*presentation\.className,\s*className,?\s*\)/u,
    "the SkipLink stable, generated, and caller class order",
  );
  requireMatch(
    skipLinkSource,
    /mergeStylexInlineStyles\(presentation\.style,\s*style\)/u,
    "the SkipLink StyleX-before-native inline merge",
  );
  for (const [pattern, description] of [
    [/href\?:\s*`#\$\{string\}`;/u, "the hash-only SkipLink href"],
    [/href\s*=\s*["']#main-content["']/u, "the default SkipLink hash"],
    [/data-slot=["']skip-link["']/u, "the SkipLink semantic slot"],
    [/onClick\?\.\(event\)/u, "the caller SkipLink click callback"],
    [/onKeyDown\?\.\(event\)/u, "the caller SkipLink keyboard callback"],
    [/onClick=\{handleClick\}/u, "the SkipLink click handler"],
    [/onKeyDown=\{handleKeyDown\}/u, "the SkipLink keyboard handler"],
    [/ref=\{ref\}/u, "the SkipLink anchor ref"],
    [/document\.getElementById\(href\.slice\(1\)\)/u, "the SkipLink hash target lookup"],
    [/target\.focus\(\{ preventScroll:\s*true \}\)/u, "the non-scrolling SkipLink focus attempt"],
    [/target\.setAttribute\(["']tabindex["'],\s*["']-1["']\)/u, "the temporary SkipLink tabindex"],
    [/target\.removeAttribute\(["']tabindex["']\)/u, "the SkipLink tabindex cleanup"],
    [/scrollTargetIntoView\(target\)/u, "the SkipLink target scroll"],
  ] as const) {
    requireMatch(skipLinkSource, pattern, description);
  }
  const focusTransfers = skipLinkSource.match(
    /if \(focusHashTarget\(href\)\) event\.preventDefault\(\);/gu,
  );
  if (focusTransfers?.length !== 2) {
    throw new Error(
      "StyleX artifact is missing the SkipLink click and keyboard focus transfers",
    );
  }
}

function requireFormStyleSourceContract(formStyleSource: string): void {
  requireMatch(
    formStyleSource,
    /^\s*import \* as stylex from ["']@stylexjs\/stylex["'];\s*export const formStyles = stylex\.create\(\{\s*root:\s*\{\s*display:\s*["']grid["'],\s*gap:\s*["']var\(--space-6\)["'],\s*minWidth:\s*0,?\s*\},?\s*\}\);\s*$/u,
    "the exact formStyles source recipe",
  );
}

function formCompiledBindingMatches(
  compiledJavaScript: string,
  identifier: string,
): RegExpMatchArray[] {
  const escapedIdentifier = identifier.replace(
    /[.*+?^${}()|[\]\\]/gu,
    "\\$&",
  );
  return [...compiledJavaScript.matchAll(
    new RegExp(`\\.props\\(\\s*${escapedIdentifier}\\.root\\s*,`, "gu"),
  )];
}

function requireFormContract(
  legacyComponents: string,
  compiledCss: string,
  compiledJavaScript: string,
  formSource: string,
  formStyleSource: string,
): void {
  forbid(
    legacyComponents,
    /\.hraness-form(?![A-Za-z0-9_-])/u,
    "a legacy Form recipe",
  );
  const artifact = formArtifact(compiledJavaScript, compiledCss);
  requireFormStyleSourceContract(formStyleSource);
  const compiledBindings = formCompiledBindingMatches(
    compiledJavaScript,
    artifact.identifier,
  );
  if (compiledBindings.length !== 1) {
    throw new Error(
      `compiled formStyles map must be bound to exactly one StyleX props call; found ${String(compiledBindings.length)}`,
    );
  }
  const stableHooks = [...compiledJavaScript.matchAll(/["']hraness-form["']/gu)];
  const semanticSlots = [
    ...compiledJavaScript.matchAll(/["']data-slot["']\s*:\s*["']form["']/gu),
  ];
  if (stableHooks.length !== 1 || semanticSlots.length !== 1) {
    throw new Error(
      "compiled Form must preserve exactly one stable hook and semantic slot",
    );
  }
  const bindingIndex = compiledBindings[0]!.index!;
  const hookIndex = stableHooks[0]!.index!;
  const slotIndex = semanticSlots[0]!.index!;
  const componentStart = Math.max(0, hookIndex - 1_500);
  const componentEnd = Math.min(compiledJavaScript.length, hookIndex + 2_500);
  if (
    bindingIndex < componentStart
    || bindingIndex >= componentEnd
    || slotIndex < componentStart
    || slotIndex >= componentEnd
  ) {
    throw new Error(
      "compiled formStyles map is not linked to the compiled Form component",
    );
  }
  if (artifact.classNames.size !== 3 || artifact.rules.length !== 3) {
    throw new Error(
      "StyleX Form recipe must preserve exactly three unconditional atomic rules",
    );
  }
  const declarations = new Set(
    artifact.rules.map((rule) => normalizedAtomicDeclaration(rule.body)),
  );
  const expectedDeclarations = new Set([
    "display:grid;",
    "gap:var(--space-6);",
    "min-width:0;",
  ]);
  if (
    declarations.size !== expectedDeclarations.size
    || [...expectedDeclarations].some((value) => !declarations.has(value))
  ) {
    throw new Error("StyleX Form recipe does not match its exact declaration set");
  }
  for (const className of artifact.classNames) {
    const ownedRules = artifact.rules.filter((rule) =>
      new RegExp(`\\.${className}(?![A-Za-z0-9_-])`, "u").test(rule.header)
    );
    if (ownedRules.length !== 1) {
      throw new Error(`StyleX Form atom ${className} must own exactly one rule`);
    }
    const rule = ownedRules[0]!;
    if (rule.header.includes(":")) {
      throw new Error(`StyleX Form atom ${className} must remain unconditional`);
    }
    if (
      rule.ancestors.length !== 1
      || !STYLEX_LAYERS.some(
        (layer) => rule.ancestors[0]!.header === `@layer ${layer}`,
      )
    ) {
      throw new Error(
        `StyleX Form atom ${className} must remain unconditional in the package priority layers`,
      );
    }
  }
  for (const [pattern, description] of [
    [/import \{ formStyles \} from ["']\.\/form\.stylex\.js["'];/u, "the formStyles source import"],
    [/FormContext,/u, "the React Aria Form context import"],
    [/useSlottedContext,/u, "the React Aria slotted-context helper import"],
    [/Omit<AriaFormProps,\s*["']className["']>/u, "the static Form className boundary"],
    [/Pick<FormHTMLAttributes<HTMLFormElement>,\s*["']acceptCharset["']>/u, "the native Form acceptCharset seam"],
    [/slot\?:\s*string\s*\|\s*null;/u, "the nullable Form context slot"],
    [/xstyle\?:\s*StyleXStyles;/u, "the typed Form xstyle seam"],
    [/\{ className,\s*render,\s*style,\s*xstyle,\s*\.\.\.props \}/u, "the Form presentation prop split"],
    [/const inheritedRender\s*=\s*useSlottedContext\(FormContext,\s*props\.slot\)\?\.render;/u, "the inherited Form context renderer"],
    [/const resolvedRender\s*=\s*render\s*\?\?\s*inheritedRender;/u, "the caller-before-context Form renderer precedence"],
    [/stylex\.props\(formStyles\.root,\s*xstyle\)/u, "the Form base-before-caller StyleX order"],
    [/const composedProps\s*=\s*\{\s*\.\.\.domProps,/u, "the Form DOM prop and ref retention"],
    [/className=["']hraness-form["']/u, "the Form stable semantic hook"],
    [/cn\(\s*domProps\.className,\s*presentation\.className,\s*className,?\s*\)/u, "the Form stable, generated, and caller class order"],
    [/mergeStylexInlineStyles\(\s*presentation\.style,\s*domProps\.style,?\s*\)/u, "the Form StyleX-before-native inline merge"],
    [/<form\s+\{\.\.\.composedProps\}\s*\/>/u, "the default native Form element"],
    [/resolvedRender\s*===\s*undefined/u, "the Form default-render branch"],
    [/resolvedRender\(composedProps,\s*undefined\)/u, "the resolved Form custom renderer"],
    [/data-slot=["']form["']/u, "the Form semantic slot"],
    [/ref=\{ref\}/u, "the Form native ref"],
    [/Form\.displayName\s*=\s*["']Form["']/u, "the Form display name"],
  ] as const) {
    requireMatch(formSource, pattern, description);
  }
  requireExactSourceMatches(
    formSource,
    /\bformStyles\b/gu,
    2,
    "formStyles source bindings",
  );
}

function requireExactSourceMatches(
  source: string,
  pattern: RegExp,
  expected: number,
  description: string,
): void {
  const matches = source.match(pattern)?.length ?? 0;
  if (matches !== expected) {
    throw new Error(
      `StyleX source must contain ${String(expected)} ${description}; found ${String(matches)}`,
    );
  }
}

function requireVisuallyHiddenContract(
  legacyComponents: string,
  compiledCss: string,
  compiledJavaScript: string,
  sources: VisuallyHiddenSources,
): void {
  forbid(
    legacyComponents,
    /\.hraness-visually-hidden(?![A-Za-z0-9_-])/u,
    "a legacy visually-hidden recipe",
  );
  const artifact = visuallyHiddenArtifact(compiledJavaScript, compiledCss);
  if (artifact.classNames.size !== 15) {
    throw new Error(
      `visuallyHiddenStyles.root must own exactly 15 atomic classes; found ${String(artifact.classNames.size)}`,
    );
  }

  const expectedDeclarations = new Set([
    "border-color:currentcolor!important;",
    "border-image-outset:0!important;",
    "border-image-repeat:stretch!important;",
    "border-image-slice:100%!important;",
    "border-image-source:none!important;",
    "border-image-width:1!important;",
    "border-style:none!important;",
    "border-width:0!important;",
    "clip:rect(0 0 0 0)!important;",
    "height:1px!important;",
    "overflow:hidden!important;",
    "padding:0!important;",
    "position:absolute!important;",
    "white-space:nowrap!important;",
    "width:1px!important;",
  ]);
  const allRules = cssRules(compiledCss, "dist/stylex.css");
  const actualDeclarations = new Set<string>();
  for (const className of artifact.classNames) {
    const escapedClassName = className.replace(
      /[.*+?^${}()|[\]\\]/gu,
      "\\$&",
    );
    const ownedRules = allRules.filter((rule) =>
      new RegExp(`\\.${escapedClassName}(?![A-Za-z0-9_-])`, "u")
        .test(rule.header)
    );
    if (ownedRules.length !== 1) {
      throw new Error(
        `dist/stylex.css must contain one rule for visually-hidden class ${className}; found ${String(ownedRules.length)}`,
      );
    }
    const rule = ownedRules[0]!;
    if (
      rule.header.includes(":")
      || rule.ancestors.some((ancestor) => !ancestor.header.startsWith("@layer "))
    ) {
      throw new Error(
        `visually-hidden class ${className} must remain an unconditional atomic rule`,
      );
    }
    actualDeclarations.add(normalizedAtomicDeclaration(rule.body));
  }
  if (
    actualDeclarations.size !== expectedDeclarations.size
    || [...actualDeclarations].some(
      (declaration) => !expectedDeclarations.has(declaration),
    )
  ) {
    throw new Error(
      `visuallyHiddenStyles.root does not preserve its exact important declaration set: ${JSON.stringify([...actualDeclarations].sort())}`,
    );
  }

  requireMatch(
    sources.helper,
    /export const visuallyHiddenStyles\s*=\s*stylex\.create\(\{\s*root:\s*\{/u,
    "the shared visually-hidden StyleX recipe",
  );
  requireMatch(
    sources.helper,
    /visuallyHiddenClassName\(hidden\s*=\s*true\)[\s\S]*?stylex\.props\(hidden\s*&&\s*visuallyHiddenStyles\.root\)\.className/u,
    "the default-on conditional visually-hidden helper",
  );
  if ((sources.helper.match(/!important/gu)?.length ?? 0) !== 15) {
    throw new Error(
      "the visually-hidden source recipe must preserve all 15 important declarations",
    );
  }

  for (const [source, description] of [
    [sources.actions, "actions"],
    [sources.feedback, "feedback"],
    [sources.fields, "fields"],
    [sources.knob, "knob"],
    [sources.selectField, "select-field"],
  ] as const) {
    requireMatch(
      source,
      /from ["']\.\/visually-hidden\.stylex\.js["']/u,
      `the shared visually-hidden import in ${description}`,
    );
  }
  requireExactSourceMatches(
    sources.actions,
    /visuallyHiddenClassName\(\)/gu,
    1,
    "CopyButton visually-hidden helper call",
  );
  requireExactSourceMatches(
    sources.feedback,
    /visuallyHiddenClassName\(\)/gu,
    1,
    "Spinner visually-hidden helper call",
  );
  requireExactSourceMatches(
    sources.fields,
    /visuallyHiddenClassName\(\s*!showLabel\s*\)/gu,
    7,
    "field visually-hidden helper calls",
  );
  requireExactSourceMatches(
    sources.selectField,
    /visuallyHiddenClassName\(\s*!showLabel\s*\)/gu,
    1,
    "SelectField visually-hidden helper call",
  );
  requireExactSourceMatches(
    sources.knob,
    /visuallyHiddenClassName\(\s*outputVisibility\s*===\s*["']visually-hidden["'],?\s*\)/gu,
    2,
    "Knob visually-hidden helper calls",
  );
  for (const [source, pattern, expected, description] of [
    [
      sources.actions,
      /["']hraness-visually-hidden["'],\s*visuallyHiddenClassName\(\)/gu,
      1,
      "CopyButton stable-before-generated order",
    ],
    [
      sources.feedback,
      /["']hraness-visually-hidden["'],\s*visuallyHiddenClassName\(\)/gu,
      1,
      "Spinner stable-before-generated order",
    ],
    [
      sources.fields,
      /!showLabel\s*&&\s*["']hraness-visually-hidden["'],\s*visuallyHiddenClassName\(\s*!showLabel\s*\)/gu,
      7,
      "field stable-before-generated order",
    ],
    [
      sources.selectField,
      /!showLabel\s*&&\s*["']hraness-visually-hidden["'],\s*visuallyHiddenClassName\(\s*!showLabel\s*\)/gu,
      1,
      "SelectField stable-before-generated order",
    ],
    [
      sources.knob,
      /outputVisibility\s*===\s*["']visually-hidden["']\s*&&\s*["']hraness-visually-hidden["'],\s*visuallyHiddenClassName\(\s*outputVisibility\s*===\s*["']visually-hidden["'],?\s*\)/gu,
      2,
      "Knob stable-before-generated order",
    ],
  ] as const) {
    requireExactSourceMatches(source, pattern, expected, description);
  }
}

function requireCheckboxFieldContract(
  legacyComponents: string,
  compiledCss: string,
  compiledJavaScript: string,
): void {
  forbid(
    legacyComponents,
    /\.hraness-checkbox-field(?:__(?:control|indicator|label))?(?![A-Za-z0-9_-])/u,
    "a legacy CheckboxField recipe",
  );
  const rules = checkboxStyleRules(compiledJavaScript, compiledCss);
  const checkboxCss = rules.map((rule) => rule.body).join("\n");
  const indicatorCss = checkboxStyleRules(
    compiledJavaScript,
    compiledCss,
    "indicator",
  ).map((rule) => rule.body).join("\n");
  const declarations = [
    [/display:\s*grid;/u, "the CheckboxField grid layout"],
    [/grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\);/u, "the CheckboxField control columns"],
    [/min-height:\s*var\(--interactive-target-compact\);/u, "the CheckboxField default target"],
    [/outline-offset:\s*3px;/u, "the CheckboxField focus-ring offset"],
    [/font-size:\s*var\(--text-label\);/u, "the CheckboxField label size"],
    [/forced-color-adjust:\s*auto;/u, "the CheckboxField forced-colors adjustment"],
  ] as const;
  for (const [pattern, description] of declarations) {
    requireMatch(checkboxCss, pattern, description);
  }
  for (const [pattern, description] of [
    [/align-items:\s*center;/u, "the CheckboxField indicator block-axis alignment"],
    [
      /background-color:\s*var\(--hraness-field-surface,\s*var\(--ui-background\)\);/u,
      "the CheckboxField overridable surface fallback",
    ],
    [/height:\s*1\.25rem;/u, "the CheckboxField indicator height"],
    [/justify-items:\s*center;/u, "the CheckboxField indicator inline-axis alignment"],
    [
      /transition-duration:\s*var\(--motion-duration-fast\);/u,
      "the CheckboxField indicator transition duration",
    ],
    [
      /transition-property:\s*background-color,\s*border-color;/u,
      "the CheckboxField indicator transition properties",
    ],
    [
      /transition-timing-function:\s*var\(--motion-easing-standard\);/u,
      "the CheckboxField indicator transition timing",
    ],
    [/width:\s*1\.25rem;/u, "the CheckboxField indicator width"],
  ] as const) {
    requireMatch(indicatorCss, pattern, description);
  }
  requireCheckboxConditionalDeclaration(
    rules,
    "@media(pointer:coarse)",
    /min-height:\s*var\(--interactive-target-min\);/u,
    "the CheckboxField coarse-pointer target",
  );
  requireCheckboxConditionalDeclaration(
    rules,
    "@media(forced-colors:active)",
    /border-color:\s*canvastext;/u,
    "the CheckboxField forced-colors border",
  );
  requireCheckboxConditionalDeclaration(
    rules,
    "@media(forced-colors:active)",
    /forced-color-adjust:\s*auto;/u,
    "the CheckboxField forced-colors adjustment",
  );
  for (const [pattern, description] of [
    [/background:\s*var\(--ui-primary\);/u, "a CheckboxField background shorthand"],
    [/border:\s*1px\s+solid/u, "a CheckboxField border shorthand"],
    [/outline:\s*2px\s+solid/u, "a CheckboxField outline shorthand"],
    [/place-items:\s*center;/u, "an unsupported CheckboxField place-items shorthand"],
    [/transition:\s*background-color/u, "a CheckboxField transition shorthand"],
  ] as const) {
    forbid(checkboxCss, pattern, description);
  }
}

function requireCheckboxFieldSourceContract(fieldsSource: string): void {
  const start = fieldsSource.indexOf("export type CheckboxFieldProps");
  const end = fieldsSource.indexOf("export type RadioGroupProps", start);
  if (start < 0 || end < 0) {
    throw new Error("src/fields.tsx must retain the bounded CheckboxField source family");
  }
  const checkboxSource = fieldsSource.slice(start, end);
  requireMatch(
    checkboxSource,
    /label:\s*ReactNode;/u,
    "the required CheckboxField label",
  );
  forbid(checkboxSource, /label\?:\s*ReactNode/u, "an optional CheckboxField label");
  forbid(checkboxSource, /\bcompact\b/u, "a CheckboxField compact API");
  requireMatch(
    checkboxSource,
    /showLabel\s*=\s*true/u,
    "the visible-by-default CheckboxField label",
  );
  requireMatch(
    checkboxSource,
    /!showLabel\s*&&\s*["']hraness-visually-hidden["']/u,
    "the stable visually-hidden CheckboxField label hook",
  );
  requireMatch(
    checkboxSource,
    /visuallyHiddenClassName\(\s*!showLabel\s*\)/u,
    "the generated visually-hidden CheckboxField label helper",
  );
  requireMatch(
    checkboxSource,
    /stylex\.props\(\s*checkboxFieldStyles\.root,[\s\S]*?state\.isDisabled\s*&&\s*checkboxFieldStyles\.disabled,[\s\S]*?xstyle,?\s*\)/u,
    "the caller-last CheckboxField root xstyle merge",
  );
  requireMatch(
    checkboxSource,
    /stylex\.props\(\s*checkboxFieldStyles\.control,[\s\S]*?state\.isFocusVisible\s*&&\s*checkboxFieldStyles\.focusVisible,[\s\S]*?controlXstyle,?\s*\)/u,
    "the caller-last CheckboxField controlXstyle merge",
  );
  requireMatch(
    checkboxSource,
    /mergeStylexInlineStyles\(presentation\.style,\s*domProps\.style\)/u,
    "the CheckboxField StyleX-before-native root style merge",
  );
  requireMatch(
    checkboxSource,
    /useSlottedContext\(\s*CheckboxFieldContext,\s*props\.slot,?\s*\)\?\.render/u,
    "the CheckboxField inherited context render seam",
  );
  for (const hook of [
    "hraness-checkbox-field",
    "hraness-checkbox-field__control",
    "hraness-checkbox-field__indicator",
    "hraness-checkbox-field__label",
  ]) {
    requireMatch(checkboxSource, new RegExp(hook, "u"), `the ${hook} semantic hook`);
  }
}

function replaceCheckboxFieldSourceOnce(
  fieldsSource: string,
  target: string,
  replacement: string,
): string {
  const start = fieldsSource.indexOf("export type CheckboxFieldProps");
  const end = fieldsSource.indexOf("export type RadioGroupProps", start);
  if (start < 0 || end < 0) {
    throw new Error("src/fields.tsx must retain the bounded CheckboxField source family");
  }
  const checkboxSource = fieldsSource.slice(start, end);
  if (checkboxSource.split(target).length !== 2) {
    throw new Error(`the bounded CheckboxField mutation must match exactly once: ${target}`);
  }
  return `${fieldsSource.slice(0, start)}${checkboxSource.replace(target, replacement)}${fieldsSource.slice(end)}`;
}

function requireNoGallerySentinels(source: string): void {
  for (const sentinel of GALLERY_LAYER_CONFLICT_SENTINELS) {
    forbid(
      source,
      new RegExp(sentinel, "u"),
      `the gallery-only ${sentinel} sentinel in package output`,
    );
  }
}

const repository = process.cwd();
const [
  compiledJavaScript,
  compiledCss,
  legacyComponents,
  orderedStylesheet,
  cardSource,
  toolbarSource,
  contentSource,
  actionsSource,
  fieldsSource,
  visuallyHiddenSource,
  feedbackSource,
  knobSource,
  selectFieldSource,
  resetStylesheet,
  skipLinkSource,
  formSource,
  formStyleSource,
] =
  await Promise.all([
    readFile(resolve(repository, "dist/index.js"), "utf8"),
    readFile(resolve(repository, "dist/stylex.css"), "utf8"),
    readFile(resolve(repository, "src/components.css"), "utf8"),
    readFile(resolve(repository, "src/styles.css"), "utf8"),
    readFile(resolve(repository, "src/card.tsx"), "utf8"),
    readFile(resolve(repository, "src/toolbar.tsx"), "utf8"),
    readFile(resolve(repository, "src/content.tsx"), "utf8"),
    readFile(resolve(repository, "src/actions.tsx"), "utf8"),
    readFile(resolve(repository, "src/fields.tsx"), "utf8"),
    readFile(resolve(repository, "src/visually-hidden.stylex.ts"), "utf8"),
    readFile(resolve(repository, "src/feedback.tsx"), "utf8"),
    readFile(resolve(repository, "src/knob.tsx"), "utf8"),
    readFile(resolve(repository, "src/select-field.tsx"), "utf8"),
    readFile(resolve(repository, "src/reset.css"), "utf8"),
    readFile(resolve(repository, "src/skip-link.tsx"), "utf8"),
    readFile(resolve(repository, "src/form.tsx"), "utf8"),
    readFile(resolve(repository, "src/form.stylex.ts"), "utf8"),
  ]);

const visuallyHiddenSources: VisuallyHiddenSources = {
  actions: actionsSource,
  feedback: feedbackSource,
  fields: fieldsSource,
  helper: visuallyHiddenSource,
  knob: knobSource,
  selectField: selectFieldSource,
};

if (compiledCss.trim().length === 0) {
  throw new Error("dist/stylex.css is empty");
}

requireMatch(
  compiledCss,
  /@layer components\.hraness-ui\.priority1\s*\{/u,
  "the package-owned priority1 layer",
);
requireMatch(
  compiledCss,
  /@layer components\.hraness-ui\.priority2\s*\{/u,
  "the package-owned priority2 layer",
);
requireMatch(
  compiledCss,
  /@layer components\.hraness-ui\.priority3\s*\{/u,
  "the package-owned priority3 layer",
);
requireMatch(
  compiledCss,
  /@layer components\.hraness-ui\.priority4\s*\{/u,
  "the package-owned priority4 layer",
);
requireMatch(compiledCss, /flex:\s*none;/u, "the icon flex declaration");
requireMatch(
  compiledCss,
  /display:\s*inline-block;/u,
  "the icon display declaration",
);
requireMatch(
  compiledCss,
  /align-items:\s*center;/u,
  "the icon-wrapper alignment declaration",
);
requireMatch(
  compiledCss,
  /display:\s*inline-flex;/u,
  "the icon-wrapper display declaration",
);
requireMatch(
  compiledCss,
  /justify-content:\s*center;/u,
  "the icon-wrapper justification declaration",
);
const quietSiteDeclarations = [
  [/align-items:\s*center;/u, "quiet-site footer alignment"],
  [/border-top-color:\s*var\(--ui-border\);/u, "quiet-site footer border color"],
  [/border-top-style:\s*solid;/u, "quiet-site footer border style"],
  [/border-top-width:\s*1px;/u, "quiet-site footer border width"],
  [/box-sizing:\s*border-box;/u, "quiet-site border-box sizing"],
  [/color:\s*var\(--ui-muted-foreground\);/u, "quiet-site footer color"],
  [/display:\s*flex;/u, "quiet-site footer display"],
  [/flex:\s*1 0 auto;/u, "quiet-site page flex"],
  [/flex-wrap:\s*wrap;/u, "quiet-site footer wrapping"],
  [/gap:\s*var\(--space-4,\s*1rem\);/u, "quiet-site footer gap"],
  [/justify-content:\s*space-between;/u, "quiet-site footer distribution"],
  [/margin-block:\s*clamp\(2rem,\s*6vh,\s*4rem\) clamp\(3\.5rem,\s*10vh,\s*6rem\);/u, "quiet-site page block margins"],
  [/margin-inline:\s*auto;/u, "quiet-site inline centering"],
  [/max-inline-size:\s*var\(--hraness-quiet-site-measure,\s*34rem\);/u, "quiet-site shared logical measure"],
  [/min-inline-size:\s*0;/u, "quiet-site footer minimum logical size"],
  [/overflow:\s*clip;/u, "quiet-site footer clipping"],
  [/padding-bottom:\s*max\(var\(--space-5,\s*1\.25rem\),\s*env\(safe-area-inset-bottom\)\);/u, "quiet-site footer safe-area bottom padding"],
  [/padding-inline:\s*var\(--hraness-quiet-site-gutter,\s*1\.25rem\);/u, "quiet-site page gutter"],
  [/padding-left:\s*max\(var\(--hraness-quiet-site-gutter,\s*1\.25rem\),\s*env\(safe-area-inset-left\)\);/u, "quiet-site footer safe-area left padding"],
  [/padding-right:\s*max\(var\(--hraness-quiet-site-gutter,\s*1\.25rem\),\s*env\(safe-area-inset-right\)\);/u, "quiet-site footer safe-area right padding"],
  [/padding-top:\s*var\(--space-5,\s*1\.25rem\);/u, "quiet-site footer top padding"],
  [/inline-size:\s*100%;/u, "quiet-site full logical inline size"],
] as const;
for (const [pattern, description] of quietSiteDeclarations) {
  requireMatch(compiledCss, pattern, description);
}
const structuralSurfaceDeclarations = [
  [/align-items:\s*center;/u, "wrapping-row alignment"],
  [/display:\s*flex;/u, "wrapping-row display"],
  [/flex-wrap:\s*wrap;/u, "wrapping-row wrapping"],
  [/gap:\s*var\(--space-3\);/u, "wrapping-row gap"],
  [/inline-size:\s*100%;/u, "viewport-frame logical inline size"],
  [/min-inline-size:\s*0;/u, "structural-surface logical minimum"],
  [/overflow:\s*hidden;/u, "viewport-frame overflow"],
] as const;
for (const [pattern, description] of structuralSurfaceDeclarations) {
  requireMatch(compiledCss, pattern, description);
}
requireViewportHeightFallbacks(compiledCss);
forbid(
  legacyComponents,
  /\.hraness-(?:appearance|social)-icon(?![A-Za-z0-9_-])/u,
  "a legacy social- or appearance-icon recipe",
);
forbid(
  legacyComponents,
  /\.hraness-quiet-site-(?:footer|page)(?![A-Za-z0-9_-])/u,
  "a legacy quiet-site landmark recipe",
);
forbid(
  legacyComponents,
  /\.hraness-(?:viewport-frame|wrapping-row)(?![A-Za-z0-9_-])/u,
  "a legacy structural-surface recipe",
);
requireThemedSurfaceContract(legacyComponents, compiledCss);
requireAvatarContract(legacyComponents, compiledCss);
requireStatusFamilyContract(legacyComponents, compiledCss);
requireCardFamilyContract(legacyComponents, compiledCss, compiledJavaScript);
requireCardFamilyCallerFallbackSeam(cardSource);
requireToolbarContract(legacyComponents, compiledCss, compiledJavaScript);
requireToolbarCallerFallbackSeam(toolbarSource);
requireKeyHintContract(legacyComponents, compiledCss);
requireKeyHintSourceContract(contentSource);
requireLinkContract(legacyComponents, compiledCss, compiledJavaScript);
requireLinkSourceContract(actionsSource);
requireActionFamilyContract(
  legacyComponents,
  compiledCss,
  compiledJavaScript,
  actionsSource,
);
requireSkipLinkContract(legacyComponents, compiledCss, skipLinkSource);
requireFormContract(
  legacyComponents,
  compiledCss,
  compiledJavaScript,
  formSource,
  formStyleSource,
);
requireVisuallyHiddenContract(
  legacyComponents,
  compiledCss,
  compiledJavaScript,
  visuallyHiddenSources,
);
requireCheckboxFieldContract(legacyComponents, compiledCss, compiledJavaScript);
requireCheckboxFieldSourceContract(fieldsSource);
requireEarliestLayerPrelude(resetStylesheet);
requirePublicLayerContract(legacyComponents, orderedStylesheet, compiledCss);
forbid(
  compiledCss,
  /max-width:\s*var\(--hraness-quiet-site-measure,\s*34rem\);/u,
  "a physical quiet-site measure produced from its logical source contract",
);
const physicalHundredPercentWidths = [
  ...compiledCss.matchAll(/(?:^|[\s{;])width:\s*100%;/gu),
];
if (physicalHundredPercentWidths.length !== 1) {
  throw new Error(
    "dist/stylex.css must contain exactly one shared physical 100% width declaration for Avatar children and PressableCard without lowering ViewportFrame's logical inline size",
  );
}
const physicalZeroMinimumWidths = [
  ...compiledCss.matchAll(/(?:^|[\s{;])min-width:\s*0;/gu),
];
if (physicalZeroMinimumWidths.length !== 1) {
  throw new Error(
    "dist/stylex.css must contain exactly one shared physical min-width zero declaration for the Tag label, PressableCard, Toolbar, CheckboxField, and Form without lowering a structural surface's logical minimum",
  );
}
requireNoGallerySentinels(
  `${compiledJavaScript}\n${compiledCss}\n${legacyComponents}\n${orderedStylesheet}`,
);

requireMatch(
  compiledJavaScript,
  /from["']react\/jsx-runtime["']/u,
  "the production React JSX runtime",
);
requireMatch(
  compiledJavaScript,
  /from["']@stylexjs\/stylex["']/u,
  "the typed xstyle merge runtime",
);
requireMatch(
  compiledJavaScript,
  /hraness-quiet-site-page/u,
  "the quiet-site page semantic hook",
);
requireMatch(
  compiledJavaScript,
  /hraness-quiet-site-footer/u,
  "the quiet-site footer semantic hook",
);
requireMatch(
  compiledJavaScript,
  /hraness-viewport-frame/u,
  "the viewport-frame semantic hook",
);
requireMatch(
  compiledJavaScript,
  /hraness-wrapping-row/u,
  "the wrapping-row semantic hook",
);
requireMatch(
  compiledJavaScript,
  /hraness-themed-surface/u,
  "the themed-surface semantic hook",
);
requireMatch(
  compiledJavaScript,
  /hraness-avatar/u,
  "the avatar semantic hook",
);
requireMatch(
  compiledJavaScript,
  /hraness-avatar__image/u,
  "the avatar image semantic hook",
);
requireMatch(
  compiledJavaScript,
  /hraness-avatar__fallback/u,
  "the avatar fallback semantic hook",
);
for (const [pattern, description] of [
  [/hraness-badge/u, "the Badge semantic hook"],
  [/hraness-badge--/u, "the Badge tone alias hook"],
  [/hraness-tag/u, "the Tag semantic hook"],
  [/hraness-tag__icon/u, "the Tag icon semantic hook"],
  [/hraness-tag__label/u, "the Tag label semantic hook"],
  [/hraness-status-dot/u, "the StatusDot semantic hook"],
  [/hraness-card(?:["'])/u, "the Card semantic hook"],
  [/hraness-card__header/u, "the CardHeader semantic hook"],
  [/hraness-card__title/u, "the CardTitle semantic hook"],
  [/hraness-card__description/u, "the CardDescription semantic hook"],
  [/hraness-card__content/u, "the CardContent semantic hook"],
  [/hraness-card__footer/u, "the CardFooter semantic hook"],
  [/hraness-pressable-card/u, "the PressableCard semantic hook"],
  [/hraness-toolbar/u, "the Toolbar semantic hook"],
  [/hraness-key-hint/u, "the KeyHint semantic hook"],
  [/hraness-link/u, "the Link semantic hook"],
  [/hraness-skip-link/u, "the SkipLink semantic hook"],
  [/hraness-form/u, "the Form semantic hook"],
  [/hraness-visually-hidden/u, "the shared visually-hidden semantic hook"],
  [/hraness-checkbox-field/u, "the CheckboxField semantic hook"],
  [/hraness-checkbox-field__control/u, "the CheckboxField control semantic hook"],
  [/hraness-checkbox-field__indicator/u, "the CheckboxField indicator semantic hook"],
  [/hraness-checkbox-field__label/u, "the CheckboxField label semantic hook"],
] as const) {
  requireMatch(compiledJavaScript, pattern, description);
}
forbid(
  compiledJavaScript,
  /react\/jsx-dev-runtime/u,
  "the development React JSX runtime",
);
forbid(
  compiledJavaScript,
  /stylex\.create|stylexCreate|Unexpected ['"]stylex\.create/u,
  "an uncompiled StyleX authoring call",
);
forbid(
  compiledJavaScript,
  /stylex-inject|stylexInject|data-stylex|createElement\(["']style["']\)/u,
  "runtime CSS injection",
);

assert.throws(
  () =>
    requirePublicLayerContract(
      legacyComponents.replace(
        `@layer ${LEGACY_LAYER} {`,
        "@layer components {",
      ),
      orderedStylesheet,
      compiledCss,
    ),
  /bare direct components layer/u,
  "the layer guard must reject a legacy recipe restored to the direct parent",
);
assert.throws(
  () =>
    requirePublicLayerContract(
      legacyComponents,
      orderedStylesheet.replace(
        LAYER_PRELUDE,
        "@layer components.hraness-ui.priority4, components.hraness-ui.priority3, components.hraness-ui.priority2, components.hraness-ui.priority1, components.hraness-ui.legacy;",
      ),
      compiledCss,
    ),
  /exact base < components and legacy < priority1 < priority2 < priority3 < priority4 preludes/u,
  "the layer guard must reject a priority inversion",
);
assert.throws(
  () =>
    requirePublicLayerContract(
      legacyComponents,
      orderedStylesheet.replace(
        ", components.hraness-ui.priority4",
        "",
      ),
      compiledCss,
    ),
  /exact base < components and legacy < priority1 < priority2 < priority3 < priority4 preludes/u,
  "the layer guard must reject an omitted generated priority4 declaration",
);
assert.throws(
  () =>
    requirePublicLayerContract(
      legacyComponents,
      orderedStylesheet,
      compiledCss.replace(
        "components.hraness-ui.priority4",
        "components.hraness-ui.priority5",
      ),
    ),
  /top-level content outside its allowed named layers/u,
  "the layer guard must reject an undeclared generated priority layer",
);
assert.throws(
  () =>
    requirePublicLayerContract(
      legacyComponents,
      orderedStylesheet.replace(
        TOP_LEVEL_LAYER_PRELUDE,
        "@layer components, base;",
      ),
      compiledCss,
    ),
  /exact base < components and legacy < priority1 < priority2 < priority3 < priority4 preludes/u,
  "the layer guard must reject a top-level reset/component priority inversion",
);
assert.throws(
  () =>
    requirePublicLayerContract(
      `${legacyComponents}\n.hraness-unlayered-negative-control { display: block; }`,
      orderedStylesheet,
      compiledCss,
    ),
  /top-level content outside its allowed named layers/u,
  "the layer guard must reject an unlayered legacy recipe",
);
assert.throws(
  () =>
    requirePublicLayerContract(
      legacyComponents,
      orderedStylesheet,
      `${compiledCss}\n.x-unlayered-negative-control { display: block; }`,
    ),
  /top-level content outside its allowed named layers/u,
  "the layer guard must reject an unlayered generated recipe",
);
assert.throws(
  () =>
    requireViewportHeightFallbacks(
      compiledCss
        .replace("height: 100vh;", "height: __viewport-vh__;")
        .replace("height: 100dvh;", "height: 100vh;")
        .replace("height: __viewport-vh__;", "height: 100dvh;"),
    ),
  /100vh < 100svh < 100dvh viewport height fallback order/u,
  "the viewport fallback guard must reject a reversed dynamic-height preference",
);
assert.throws(
  () =>
    requireViewportHeightFallbacks(
      compiledCss.replace("height: 100svh;", "height: 100vh;"),
    ),
  /exactly one 100vh, 100svh, and 100dvh/u,
  "the viewport fallback guard must reject a missing small-viewport fallback",
);
assert.throws(
  () =>
    requireThemedSurfaceContract(
      `${legacyComponents}\n@layer ${LEGACY_LAYER} { .hraness-themed-surface { display: block; } }`,
      compiledCss,
    ),
  /legacy themed-surface recipe/u,
  "the themed-surface guard must reject a restored legacy selector",
);
assert.throws(
  () =>
    requireThemedSurfaceContract(
      legacyComponents,
      compiledCss.replace(
        "background-color: var(--ui-popover);",
        "background-color: var(--ui-card);",
      ),
    ),
  /popover surface background/u,
  "the themed-surface guard must reject a missing popover background",
);
assert.throws(
  () =>
    requireThemedSurfaceContract(
      legacyComponents,
      compiledCss.replace(
        "padding-block: var(--space-6);",
        "padding-top: var(--space-6);",
      ),
    ),
  /surface block padding/u,
  "the themed-surface guard must reject a physical padding regression",
);
assert.throws(
  () =>
    requireAvatarContract(
      `${legacyComponents}\n@layer ${LEGACY_LAYER} { .hraness-avatar { display: inline-grid; } }`,
      compiledCss,
    ),
  /legacy avatar recipe/u,
  "the avatar guard must reject a restored legacy selector",
);
assert.throws(
  () =>
    requireAvatarContract(
      legacyComponents,
      compiledCss.replace("height: 3.5rem;", "height: 2.5rem;"),
    ),
  /avatar large height/u,
  "the avatar guard must reject a missing large size",
);
assert.throws(
  () =>
    requireAvatarContract(
      legacyComponents,
      compiledCss.replace("object-fit: cover;", "object-fit: contain;"),
    ),
  /avatar image crop/u,
  "the avatar guard must reject a missing image crop",
);
assert.throws(
  () =>
    requireCardFamilyCallerFallbackSeam(
      cardSource.replace("!hasStylexPresentation(xstyle) && ", ""),
    ),
  /omit native PressableCard pseudo fallbacks exactly when caller xstyle contributes presentation/u,
  "the Card-family guard must reject unconditional native pseudo fallbacks",
);
assert.throws(
  () =>
    requireNoGallerySentinels(
      `${compiledJavaScript}\n${compiledCss}\n${legacyComponents}\n${orderedStylesheet}\n[data-gallery-avatar-layer-conflict] { display: block; }`,
    ),
  /gallery-only data-gallery-avatar-layer-conflict sentinel/u,
  "the avatar guard must reject gallery sentinel leakage",
);
assert.throws(
  () =>
    requireStatusFamilyContract(
      `${legacyComponents}\n@layer ${LEGACY_LAYER} { .hraness-badge--success { color: green; } }`,
      compiledCss,
    ),
  /legacy Badge, Badge tone alias, Tag, or StatusDot recipe/u,
  "the status-family guard must reject a restored legacy Badge alias",
);
assert.throws(
  () =>
    requireStatusFamilyContract(
      legacyComponents,
      compiledCss.replace(
        "border-color: var(--hraness-tag-accent, var(--ui-border));",
        "border-color: var(--ui-border);",
      ),
    ),
  /public Tag accent variable/u,
  "the status-family guard must reject a missing public Tag variable",
);
assert.throws(
  () =>
    requireStatusFamilyContract(
      legacyComponents,
      compiledCss.replaceAll("border-color: canvastext;", "border-color: currentcolor;"),
    ),
  /forced-colors status-pill border/u,
  "the status-family guard must reject a missing forced-colors border",
);
assert.throws(
  () =>
    requireStatusFamilyContract(
      legacyComponents,
      compiledCss.replace("height: .625rem;", "height: 1rem;"),
    ),
  /StatusDot height/u,
  "the status-family guard must reject missing StatusDot geometry",
);
assert.throws(
  () =>
    requireNoGallerySentinels(
      `${compiledJavaScript}\n${compiledCss}\n${legacyComponents}\n${orderedStylesheet}\n[data-gallery-status-family-layer-conflict] { display: block; }`,
    ),
  /gallery-only data-gallery-status-family-layer-conflict sentinel/u,
  "the status-family guard must reject gallery sentinel leakage",
);
assert.throws(
  () =>
    requireCardFamilyContract(
      `${legacyComponents}\n@layer ${LEGACY_LAYER} { .hraness-card { display: flex; } }`,
      compiledCss,
      compiledJavaScript,
    ),
  /legacy Card-family recipe beyond the compatibility bridge/u,
  "the Card-family guard must reject a restored legacy selector",
);
assert.throws(
  () =>
    requireCardFamilyContract(
      legacyComponents,
      compiledCss,
      compiledJavaScript.replace(
        "--_hraness-card-description",
        "--missing-card-description",
      ),
    ),
  /literal private Card description inline property/u,
  "the Card-family guard must reject a missing private description property",
);
assert.throws(
  () =>
    requireCardFamilyContract(
      legacyComponents.replace(CARD_DESCRIPTION_BRIDGE_PATTERN, ""),
      compiledCss,
      compiledJavaScript,
    ),
  /exactly one Card description compatibility bridge/u,
  "the Card-family guard must reject a missing compatibility bridge",
);
assert.throws(
  () =>
    requireCardFamilyContract(
      legacyComponents.replace(
        "--hraness-card-description: var(--_hraness-card-description);",
        "--hraness-card-description: var(--_hraness-card-description); color: red;",
      ),
      compiledCss,
      compiledJavaScript,
    ),
  /exactly one Card description compatibility bridge/u,
  "the Card-family guard must reject extra compatibility-bridge declarations",
);
assert.throws(
  () =>
    requireCardFamilyContract(
      legacyComponents,
      compiledCss.replace(
        "color: var(--hraness-card-description);",
        "--hraness-card-description: red; color: var(--hraness-card-description);",
      ),
      compiledJavaScript,
    ),
  /generated public Card description variable assignment/u,
  "the Card-family guard must reject a StyleX public-variable assignment",
);
assert.throws(
  () =>
    requireCardFamilyContract(
      legacyComponents,
      compiledCss.replace(":hover {", ":not(:hover) {"),
      compiledJavaScript,
    ),
  /native PressableCard hover fallback/u,
  "the Card-family guard must reject a missing native hover fallback",
);
assert.throws(
  () =>
    requireCardFamilyContract(
      legacyComponents,
      compiledCss.replace("forced-color-adjust: auto;", "forced-color-adjust: none;"),
      compiledJavaScript,
    ),
  /forced-colors Card adjustment/u,
  "the Card-family guard must reject a missing forced-colors adjustment",
);
assert.throws(
  () =>
    requireNoGallerySentinels(
      `${compiledJavaScript}\n${compiledCss}\n${legacyComponents}\n${orderedStylesheet}\n[data-gallery-card-family-layer-conflict] { display: block; }`,
    ),
  /gallery-only data-gallery-card-family-layer-conflict sentinel/u,
  "the Card-family guard must reject gallery sentinel leakage",
);
const changedToolbarOutlineOffset = replaceToolbarDeclaration(
  compiledJavaScript,
  compiledCss,
  "nativeFocusFallback",
  /outline-offset:\s*2px;/u,
  "outline-offset: 9px;",
  "Toolbar focus ring offset",
);
assert.throws(
  () =>
    requireToolbarContract(
      `${legacyComponents}\n@layer ${LEGACY_LAYER} { .hraness-toolbar { display: flex; } }`,
      compiledCss,
      compiledJavaScript,
    ),
  /legacy Toolbar recipe/u,
  "the Toolbar guard must reject a restored legacy selector",
);
assert.throws(
  () =>
    requireToolbarContract(
      legacyComponents,
      changedToolbarOutlineOffset,
      compiledJavaScript,
    ),
  /Toolbar focus ring offset/u,
  "the Toolbar guard must reject a changed focus-ring offset",
);
assert.throws(
  () =>
    requireToolbarContract(
      legacyComponents,
      compiledCss.replaceAll("flex-direction: column;", "flex-direction: row;"),
      compiledJavaScript,
    ),
  /vertical Toolbar direction/u,
  "the Toolbar guard must reject a missing vertical direction",
);
assert.throws(
  () =>
    requireToolbarCallerFallbackSeam(
      toolbarSource.replace("!hasStylexPresentation(xstyle) && ", ""),
    ),
  /omit the native Toolbar focus fallback exactly when caller xstyle contributes presentation/u,
  "the Toolbar guard must reject an unconditional native focus fallback",
);
assert.throws(
  () =>
    requireNoGallerySentinels(
      `${compiledJavaScript}\n${compiledCss}\n${legacyComponents}\n${orderedStylesheet}\n[data-gallery-toolbar-layer-conflict] { display: block; }`,
    ),
  /gallery-only data-gallery-toolbar-layer-conflict sentinel/u,
  "the Toolbar guard must reject gallery sentinel leakage",
);
assert.throws(
  () =>
    requireKeyHintContract(
      `${legacyComponents}\n@layer ${LEGACY_LAYER} { .hraness-key-hint { display: inline-flex; } }`,
      compiledCss,
    ),
  /legacy KeyHint recipe/u,
  "the KeyHint guard must reject a restored legacy selector",
);
assert.throws(
  () =>
    requireKeyHintContract(
      legacyComponents,
      compiledCss.replace(
        "border-block-end-width: 2px;",
        "border-block-end-width: 1px;",
      ),
    ),
  /KeyHint block-end depth/u,
  "the KeyHint guard must reject a missing block-end depth",
);
assert.throws(
  () =>
    requireKeyHintContract(
      legacyComponents,
      compiledCss.replace("min-inline-size: 1.5rem;", "min-inline-size: 2rem;"),
    ),
  /KeyHint minimum inline size/u,
  "the KeyHint guard must reject changed logical geometry",
);
assert.throws(
  () =>
    requireKeyHintSourceContract(
      `"use client";\n${contentSource}`,
    ),
  /client boundary on the server-compatible content module/u,
  "the KeyHint guard must reject a client-only content module",
);
assert.throws(
  () =>
    requireKeyHintSourceContract(
      contentSource.replace(
        "mergeStylexInlineStyles(presentation.style, style)",
        "mergeStylexInlineStyles(style, presentation.style)",
      ),
    ),
  /KeyHint StyleX-before-native inline merge/u,
  "the KeyHint guard must reject reversed native-style precedence",
);
assert.throws(
  () =>
    requireNoGallerySentinels(
      `${compiledJavaScript}\n${compiledCss}\n${legacyComponents}\n${orderedStylesheet}\n[data-gallery-key-hint-layer-conflict] { display: block; }`,
    ),
  /gallery-only data-gallery-key-hint-layer-conflict sentinel/u,
  "the KeyHint guard must reject gallery sentinel leakage",
);
const changedLinkUnderlineOffset = replaceLinkDeclaration(
  compiledJavaScript,
  compiledCss,
  "root",
  /text-underline-offset:\s*0?\.2em;/u,
  "text-underline-offset: 1em;",
  "Link underline offset",
);
const nativeLinkHoverRules = linkStyleRules(
  compiledJavaScript,
  compiledCss,
  "nativeInteractionFallbacks",
).filter((rule) => /:hover(?![A-Za-z0-9_-])/u.test(rule.header));
if (nativeLinkHoverRules.length !== 1) {
  throw new Error("the Link guard requires one exact native hover fallback rule");
}
const nativeLinkHoverRule = nativeLinkHoverRules[0]!;
const linkWithoutNativeHover = compiledCss.replace(
  nativeLinkHoverRule.source,
  nativeLinkHoverRule.source.replace(":hover", ":not(:hover)"),
);

assert.throws(
  () =>
    requireLinkContract(
      `${legacyComponents}\n@layer ${LEGACY_LAYER} { .hraness-link[data-restored] { color: red; } }`,
      compiledCss,
      compiledJavaScript,
    ),
  /legacy Link recipe/u,
  "the Link guard must reject a restored compound legacy selector",
);
assert.throws(
  () =>
    requireLinkContract(
      legacyComponents,
      changedLinkUnderlineOffset,
      compiledJavaScript,
    ),
  /Link underline offset/u,
  "the Link guard must reject a changed underline offset",
);
assert.throws(
  () =>
    requireLinkContract(
      legacyComponents,
      linkWithoutNativeHover,
      compiledJavaScript,
    ),
  /native Link hover fallback/u,
  "the Link guard must reject a missing native hover fallback",
);
assert.throws(
  () =>
    requireLinkSourceContract(
      actionsSource.replace("!hasStylexPresentation(xstyle) && ", ""),
    ),
  /conditional native Link interaction fallbacks/u,
  "the Link guard must reject unconditional native interaction fallbacks",
);
assert.throws(
  () =>
    requireLinkSourceContract(
      actionsSource.replace(
        "    state.isFocusVisible && linkStyles.focusVisible,\n    xstyle,",
        "    xstyle,\n    state.isFocusVisible && linkStyles.focusVisible,",
      ),
    ),
  /caller-last Link state and xstyle merge/u,
  "the Link guard must reject caller xstyle before a state recipe",
);
assert.throws(
  () =>
    requireLinkSourceContract(
      replaceExactlyOnceInBoundedSource(
        actionsSource,
        "export function Link({",
        "/** A semantic destination with action-control presentation. */",
        /mergeStylexInlineStyles\(presentation\.style,\s*callerStyle\)/u,
        () => "mergeStylexInlineStyles(callerStyle, presentation.style)",
        "Link native inline-style precedence",
      ),
    ),
  /Link StyleX-before-native inline merge/u,
  "the Link guard must reject reversed native-style precedence",
);
assert.throws(
  () =>
    requireNoGallerySentinels(
      `${compiledJavaScript}\n${compiledCss}\n${legacyComponents}\n${orderedStylesheet}\n[data-gallery-link-layer-conflict] { display: block; }`,
    ),
  /gallery-only data-gallery-link-layer-conflict sentinel/u,
  "the Link guard must reject gallery sentinel leakage",
);
const changedActionFont = replaceActionDeclaration(
  compiledJavaScript,
  compiledCss,
  "control",
  /font-family:\s*inherit;/u,
  "font-family: menu;",
  "action inherited font",
);
const relocatedActionCoarseTarget = relocateActionConditionalRule(
  compiledJavaScript,
  compiledCss,
  "iconControl",
  "@media(pointer:coarse)",
  /(?:^|;)\s*width:\s*var\(--interactive-target-min\);/u,
  "icon action coarse-pointer width",
);
const relocatedActionReducedMotion = relocateActionConditionalRule(
  compiledJavaScript,
  compiledCss,
  "spinner",
  "@media(prefers-reduced-motion:reduce)",
  /animation-name:\s*none;/u,
  "reduced-motion action spinner",
);
const relocatedActionForcedSurface = relocateActionConditionalRule(
  compiledJavaScript,
  compiledCss,
  "control",
  "@media(forced-colors:active)",
  /border-color:\s*canvastext;/u,
  "forced-color action border",
);
const changedActionSpinner = replaceActionDeclaration(
  compiledJavaScript,
  compiledCss,
  "spinner",
  /animation-name:\s*hraness-spin;/u,
  "animation-name: none;",
  "default action spinner",
);
const reorderedActionStyleMap = reverseActionRecipeOrder(
  compiledJavaScript,
  "action recipe order",
);
const swappedActionControlOwnership = swapActionRecipeValues(
  compiledJavaScript,
  "control",
  "root",
  "action recipe ownership",
);
const unconditionalNativeInteractionSource = replaceExactlyOnceInBoundedSource(
  actionsSource,
  "function actionControlPresentation(",
  "function inlineIconControlPresentation(",
  /!hasControlPresentation\s*&&\s*(?=actionStyles\.nativeInteractionFallbacks)/u,
  () => "",
  "native action interaction fallback",
);
const unconditionalNativeHoverSource = replaceExactlyOnceInBoundedSource(
  actionsSource,
  "function actionControlPresentation(",
  "function inlineIconControlPresentation(",
  /!hasControlPresentation\s*&&\s*(?=\(options\.labeled\s*\?\s*actionNativeLabeledHoverStyles\[variant\])/u,
  () => "",
  "native action hover fallback",
);
const unconditionalNativeInlineSource = replaceExactlyOnceInBoundedSource(
  actionsSource,
  "function inlineIconControlPresentation(",
  "function PendingIndicator(",
  /!hasStylexPresentation\(controlXstyle\)\s*&&\s*(?=actionStyles\.nativeInlineInteractionFallbacks)/u,
  () => "",
  "native inline IconLink interaction fallback",
);
const actionStyleAfterCallerSource = replaceExactlyOnceInBoundedSource(
  actionsSource,
  "function actionControlPresentation(",
  "function inlineIconControlPresentation(",
  /\n\s*controlXstyle,\n\s*\);/u,
  () => "controlXstyle,\n    actionStyles.control,\n  );",
  "action caller class precedence",
);
const actionRootStyleAfterCallerSource = replaceExactlyOnceInBoundedSource(
  actionsSource,
  "function actionRootPresentation(",
  "function actionControlPresentation(",
  /stylex\.props\(\s*actionStyles\.root,\s*xstyle,?\s*\)/u,
  () => "stylex.props(xstyle, actionStyles.root)",
  "action wrapper caller precedence",
);
assert.throws(
  () =>
    requireActionFamilyContract(
      `${legacyComponents}\n@layer ${LEGACY_LAYER} { .hraness-button { display: inline-flex; } }`,
      compiledCss,
      compiledJavaScript,
      actionsSource,
    ),
  /legacy action-family recipe/u,
  "the action-family guard must reject a restored legacy selector",
);
assert.throws(
  () =>
    requireActionFamilyContract(
      legacyComponents,
      changedActionFont,
      compiledJavaScript,
      actionsSource,
    ),
  /inherited action font family/u,
  "the action-family guard must reject a changed inherited font",
);
assert.throws(
  () =>
    requireActionFamilyContract(
      legacyComponents,
      changedActionSpinner,
      compiledJavaScript,
      actionsSource,
    ),
  /action spinner animation/u,
  "the action-family guard must reject a changed default spinner animation",
);
assert.throws(
  () =>
    requireActionFamilyContract(
      legacyComponents,
      compiledCss,
      swappedActionControlOwnership,
      actionsSource,
    ),
  /inherited action font family/u,
  "the action-family guard must reject declarations owned by the wrong action recipe",
);
assert.doesNotThrow(
  () =>
    requireActionFamilyContract(
      legacyComponents,
      compiledCss,
      reorderedActionStyleMap,
      actionsSource,
    ),
  "the action-family guard must accept semantics-preserving compiled recipe reordering",
);
for (const [mutatedCss, pattern, description] of [
  [
    relocatedActionCoarseTarget,
    /icon action coarse-pointer width must remain directly inside/u,
    "a relocated coarse-pointer icon width",
  ],
  [
    relocatedActionReducedMotion,
    /reduced-motion action spinner must remain directly inside/u,
    "a relocated reduced-motion spinner override",
  ],
  [
    relocatedActionForcedSurface,
    /forced-color action border must remain directly inside/u,
    "a relocated forced-color border",
  ],
] as const) {
  assert.throws(
    () =>
      requireActionFamilyContract(
        legacyComponents,
        mutatedCss,
        compiledJavaScript,
        actionsSource,
      ),
    pattern,
    `the action-family guard must reject ${description}`,
  );
}
assert.throws(
  () =>
    requireActionFamilyContract(
      legacyComponents,
      compiledCss,
      compiledJavaScript,
      unconditionalNativeInteractionSource,
    ),
  /conditional native action interaction fallbacks/u,
  "the action-family guard must reject unconditional native interaction fallbacks",
);
assert.throws(
  () =>
    requireActionFamilyContract(
      legacyComponents,
      compiledCss,
      compiledJavaScript,
      unconditionalNativeHoverSource,
    ),
  /conditional native action hover fallbacks/u,
  "the action-family guard must reject unconditional native hover fallbacks",
);
assert.throws(
  () =>
    requireActionFamilyContract(
      legacyComponents,
      compiledCss,
      compiledJavaScript,
      unconditionalNativeInlineSource,
    ),
  /conditional native inline IconLink interaction fallbacks/u,
  "the action-family guard must reject unconditional inline IconLink fallbacks",
);
assert.throws(
  () =>
    requireActionFamilyContract(
      legacyComponents,
      compiledCss,
      compiledJavaScript,
      actionStyleAfterCallerSource,
    ),
  /action state, selection, and caller precedence/u,
  "the action-family guard must reject a control style after caller controlXstyle",
);
assert.throws(
  () =>
    requireActionFamilyContract(
      legacyComponents,
      compiledCss,
      compiledJavaScript,
      actionRootStyleAfterCallerSource,
    ),
  /action wrapper caller precedence/u,
  "the action-family guard must reject a root style after caller xstyle",
);
assert.throws(
  () =>
    requireNoGallerySentinels(
      `${compiledJavaScript}\n${compiledCss}\n${legacyComponents}\n${orderedStylesheet}\n[data-gallery-action-family-layer-conflict] { display: block; }`,
    ),
  /gallery-only data-gallery-action-family-layer-conflict sentinel/u,
  "the action-family guard must reject gallery sentinel leakage",
);
for (const {
  component,
  endMarker,
  presentation,
  startMarker,
} of ACTION_NATIVE_STYLE_SITES) {
  const reversedNativeStyleSource = replaceExactlyOnceInBoundedSource(
    actionsSource,
    startMarker,
    endMarker,
    new RegExp(
      `mergeStylexInlineStyles\\(\\s*${presentation}\\.style,\\s*callerStyle,?\\s*\\)`,
      "u",
    ),
    () => `mergeStylexInlineStyles(callerStyle, ${presentation}.style)`,
    `${component} native inline-style precedence`,
  );
  assert.throws(
    () =>
      requireActionFamilyContract(
        legacyComponents,
        compiledCss,
        compiledJavaScript,
        reversedNativeStyleSource,
      ),
    new RegExp(`${component} StyleX-before-native inline merge`, "u"),
    `the action-family guard must reject reversed ${component} native inline-style precedence`,
  );
}
assert.throws(
  () =>
    requireSkipLinkContract(
      `${legacyComponents}\n@layer ${LEGACY_LAYER} { .hraness-skip-link { position: fixed; } }`,
      compiledCss,
      skipLinkSource,
    ),
  /legacy SkipLink recipe/u,
  "the SkipLink guard must reject a restored legacy selector",
);
assert.throws(
  () =>
    requireSkipLinkContract(
      legacyComponents,
      compiledCss.replace(
        /background-image:\s*none;/gu,
        "background-image: linear-gradient(red, blue);",
      ),
      skipLinkSource,
    ),
  /SkipLink background image reset/u,
  "the SkipLink guard must reject lost background-shorthand reset semantics",
);
assert.throws(
  () =>
    requireSkipLinkContract(
      legacyComponents,
      compiledCss.replace(
        /translateY\(calc\(-100%\s*-\s*var\(--space-6\)\)\)/u,
        "translateY(-1px)",
      ),
      skipLinkSource,
    ),
  /offscreen SkipLink transform/u,
  "the SkipLink guard must reject changed offscreen geometry",
);
assert.throws(
  () =>
    requireSkipLinkContract(
      legacyComponents,
      compiledCss.replace(
        /transform:\s*translateY\(0\);/u,
        "transform: translateY(1px);",
      ),
      skipLinkSource,
    ),
  /native SkipLink focus reveal/u,
  "the SkipLink guard must reject a changed native focus reveal",
);
assert.throws(
  () =>
    requireSkipLinkContract(
      legacyComponents,
      compiledCss,
      skipLinkSource.replace(
        "mergeStylexInlineStyles(presentation.style, style)",
        "mergeStylexInlineStyles(style, presentation.style)",
      ),
    ),
  /StyleX-before-native inline merge/u,
  "the SkipLink guard must reject reversed native-style precedence",
);
assert.throws(
  () =>
    requireNoGallerySentinels(
      `${compiledJavaScript}\n${compiledCss}\n${legacyComponents}\n${orderedStylesheet}\n[data-gallery-skip-link-layer-conflict] { display: block; }`,
    ),
  /gallery-only data-gallery-skip-link-layer-conflict sentinel/u,
  "the SkipLink guard must reject gallery sentinel leakage",
);
assert.throws(
  () =>
    requireFormContract(
      `${legacyComponents}\n@layer ${LEGACY_LAYER} { .hraness-form { display: grid; } }`,
      compiledCss,
      compiledJavaScript,
      formSource,
      formStyleSource,
    ),
  /legacy Form recipe/u,
  "the Form guard must reject a restored legacy selector",
);
const changedFormGap = replaceFormDeclaration(
  compiledJavaScript,
  compiledCss,
  /gap:\s*var\(--space-6\);/u,
  "gap: var(--space-5);",
  "Form gap",
);
assert.throws(
  () =>
    requireFormContract(
      legacyComponents,
      changedFormGap,
      compiledJavaScript,
      formSource,
      formStyleSource,
    ),
  /compiled formStyles class map/u,
  "the Form guard must reject a changed spacing recipe",
);
const changedFormMinimumWidth = replaceFormDeclaration(
  compiledJavaScript,
  compiledCss,
  /min-width:\s*0;/u,
  "min-width: 2rem;",
  "Form minimum width",
);
assert.throws(
  () =>
    requireFormContract(
      legacyComponents,
      changedFormMinimumWidth,
      compiledJavaScript,
      formSource,
      formStyleSource,
    ),
  /compiled formStyles class map/u,
  "the Form guard must reject changed physical shrink behavior",
);
const conditionalFormDisplay = wrapFormDeclarationInCondition(
  compiledJavaScript,
  compiledCss,
  /display:\s*grid;/u,
  "@media (min-width: 1px)",
  "Form display",
);
assert.throws(
  () =>
    requireFormContract(
      legacyComponents,
      conditionalFormDisplay,
      compiledJavaScript,
      formSource,
      formStyleSource,
    ),
  /remain unconditional/u,
  "the Form guard must reject a conditionally emitted base atom",
);
const disconnectedFormJavaScript = disconnectFormCompiledBinding(
  compiledJavaScript,
  compiledCss,
);
assert.throws(
  () =>
    requireFormContract(
      legacyComponents,
      compiledCss,
      disconnectedFormJavaScript,
      formSource,
      formStyleSource,
    ),
  /compiled formStyles map must be bound/u,
  "the Form guard must reject an unconsumed compiled recipe map",
);
assert.throws(
  () =>
    requireFormContract(
      legacyComponents,
      compiledCss,
      compiledJavaScript,
      formSource.replace(
        'from "./form.stylex.js"',
        'from "./unrelated.stylex.js"',
      ),
      formStyleSource,
    ),
  /formStyles source import/u,
  "the Form guard must reject a changed source recipe binding",
);
assert.throws(
  () =>
    requireFormContract(
      legacyComponents,
      compiledCss,
      compiledJavaScript,
      formSource,
      formStyleSource.replace(
        'gap: "var(--space-6)"',
        'gap: "var(--space-5)"',
      ),
    ),
  /exact formStyles source recipe/u,
  "the Form guard must reject source recipe drift before compilation",
);
assert.throws(
  () =>
    requireFormContract(
      legacyComponents,
      compiledCss,
      compiledJavaScript,
      formSource.replace(
        "render ?? inheritedRender",
        "inheritedRender ?? render",
      ),
      formStyleSource,
    ),
  /caller-before-context Form renderer precedence/u,
  "the Form guard must reject context rendering before the caller override",
);
assert.throws(
  () =>
    requireFormContract(
      legacyComponents,
      compiledCss,
      compiledJavaScript,
      formSource.replace(
        "resolvedRender(composedProps, undefined)",
        "render?.(composedProps, undefined)",
      ),
      formStyleSource,
    ),
  /resolved Form custom renderer/u,
  "the Form guard must reject bypassing the inherited renderer",
);
assert.throws(
  () =>
    requireFormContract(
      legacyComponents,
      compiledCss,
      compiledJavaScript,
      formSource.replace(
        "stylex.props(formStyles.root, xstyle)",
        "stylex.props(xstyle, formStyles.root)",
      ),
      formStyleSource,
    ),
  /base-before-caller StyleX order/u,
  "the Form guard must reject a package recipe after caller xstyle",
);
assert.throws(
  () =>
    requireFormContract(
      legacyComponents,
      compiledCss,
      compiledJavaScript,
      formSource.replace(
        "presentation.style,\n            domProps.style",
        "domProps.style,\n            presentation.style",
      ),
      formStyleSource,
    ),
  /StyleX-before-native inline merge/u,
  "the Form guard must reject reversed native-style precedence",
);
assert.throws(
  () =>
    requireFormContract(
      legacyComponents,
      compiledCss,
      compiledJavaScript,
      formSource.replace(
        "domProps.className,\n            presentation.className",
        "presentation.className,\n            domProps.className",
      ),
      formStyleSource,
    ),
  /stable, generated, and caller class order/u,
  "the Form guard must reject generated classes before its stable hook",
);
assert.throws(
  () =>
    requireNoGallerySentinels(
      `${compiledJavaScript}\n${compiledCss}\n${legacyComponents}\n${orderedStylesheet}\n[data-gallery-form-layer-conflict] { display: block; }`,
    ),
  /gallery-only data-gallery-form-layer-conflict sentinel/u,
  "the Form guard must reject gallery sentinel leakage",
);
const changedVisuallyHiddenWidth = replaceVisuallyHiddenDeclaration(
  compiledJavaScript,
  compiledCss,
  /width:\s*1px\s*!important;/u,
  "width: 2px !important;",
  "visually-hidden width",
);
const changedVisuallyHiddenClip = replaceVisuallyHiddenDeclaration(
  compiledJavaScript,
  compiledCss,
  /clip:\s*rect\(0,?\s*0,?\s*0,?\s*0\)\s*!important;/u,
  "clip: auto !important;",
  "visually-hidden clip",
);
const changedVisuallyHiddenBorderImage = replaceVisuallyHiddenDeclaration(
  compiledJavaScript,
  compiledCss,
  /border-image-source:\s*none\s*!important;/u,
  "border-image-source: linear-gradient(red, blue) !important;",
  "visually-hidden border-image source",
);
const nonImportantVisuallyHiddenOverflow = replaceVisuallyHiddenDeclaration(
  compiledJavaScript,
  compiledCss,
  /overflow:\s*hidden\s*!important;/u,
  "overflow: hidden;",
  "visually-hidden important overflow",
);
for (const [mutatedCss, description] of [
  [changedVisuallyHiddenWidth, "one-pixel width"],
  [changedVisuallyHiddenClip, "clipping rectangle"],
  [changedVisuallyHiddenBorderImage, "border-image reset"],
  [nonImportantVisuallyHiddenOverflow, "important overflow"],
] as const) {
  assert.throws(
    () =>
      requireVisuallyHiddenContract(
        legacyComponents,
        mutatedCss,
        compiledJavaScript,
        visuallyHiddenSources,
      ),
    /exact important declaration set/u,
    `the visually-hidden guard must reject a changed ${description}`,
  );
}
assert.throws(
  () =>
    requireVisuallyHiddenContract(
      `${legacyComponents}\n@layer ${LEGACY_LAYER} { .hraness-visually-hidden { position: absolute !important; } }`,
      compiledCss,
      compiledJavaScript,
      visuallyHiddenSources,
    ),
  /legacy visually-hidden recipe/u,
  "the visually-hidden guard must reject a restored legacy selector",
);
assert.throws(
  () =>
    requireVisuallyHiddenContract(
      legacyComponents,
      compiledCss,
      compiledJavaScript,
      {
        ...visuallyHiddenSources,
        helper: visuallyHiddenSource.replace("hidden && ", ""),
      },
    ),
  /default-on conditional visually-hidden helper/u,
  "the visually-hidden guard must reject an unconditional helper",
);
assert.throws(
  () =>
    requireVisuallyHiddenContract(
      legacyComponents,
      compiledCss,
      compiledJavaScript,
      {
        ...visuallyHiddenSources,
        feedback: feedbackSource.replace("visuallyHiddenClassName(),", ""),
      },
    ),
  /Spinner visually-hidden helper call/u,
  "the visually-hidden guard must reject a consumer that drops the helper",
);
const reorderedFieldVisuallyHiddenSource = fieldsSource.replace(
  /!showLabel\s*&&\s*["']hraness-visually-hidden["'],\s*(visuallyHiddenClassName\(\s*!showLabel\s*\),)/u,
  "$1\n          !showLabel && \"hraness-visually-hidden\",",
);
assert.notEqual(
  reorderedFieldVisuallyHiddenSource,
  fieldsSource,
  "the visually-hidden caller-order mutation must change one field",
);
assert.throws(
  () =>
    requireVisuallyHiddenContract(
      legacyComponents,
      compiledCss,
      compiledJavaScript,
      {
        ...visuallyHiddenSources,
        fields: reorderedFieldVisuallyHiddenSource,
      },
    ),
  /field stable-before-generated order/u,
  "the visually-hidden guard must reject generated classes before the stable hook",
);
assert.throws(
  () =>
    requireNoGallerySentinels(
      `${compiledJavaScript}\n${compiledCss}\n${legacyComponents}\n${orderedStylesheet}\n[data-gallery-visually-hidden-layer-conflict] { display: block; }`,
    ),
  /gallery-only data-gallery-visually-hidden-layer-conflict sentinel/u,
  "the visually-hidden guard must reject gallery sentinel leakage",
);
const changedCheckboxDefaultTarget = replaceCheckboxDeclaration(
  compiledJavaScript,
  compiledCss,
  /min-height:\s*var\(--interactive-target-compact\);/u,
  "min-height: 2rem;",
  "CheckboxField default target",
);
const relocatedCheckboxCoarseTarget = relocateCheckboxConditionalRule(
  compiledJavaScript,
  compiledCss,
  "@media(pointer:coarse)",
  /min-height:\s*var\(--interactive-target-min\);/u,
  "CheckboxField coarse-pointer target",
);
const relocatedCheckboxForcedBorder = relocateCheckboxConditionalRule(
  compiledJavaScript,
  compiledCss,
  "@media(forced-colors:active)",
  /border-color:\s*canvastext;/u,
  "CheckboxField forced-colors border",
);
const relocatedCheckboxForcedAdjustment = relocateCheckboxConditionalRule(
  compiledJavaScript,
  compiledCss,
  "@media(forced-colors:active)",
  /forced-color-adjust:\s*auto;/u,
  "CheckboxField forced-colors adjustment",
);
const indicatorAlignmentRules = checkboxStyleRules(
  compiledJavaScript,
  compiledCss,
  "indicator",
).filter((rule) => /align-items:\s*center;/u.test(rule.body));
if (indicatorAlignmentRules.length !== 1) {
  throw new Error("the CheckboxField indicator alignment mutation expected one rule");
}
const indicatorAlignmentClassNames = [...checkboxStyleClassNames(
  compiledJavaScript,
  "indicator",
)].filter((className) =>
  new RegExp(`\\.${className}(?![A-Za-z0-9_-])`, "u")
    .test(indicatorAlignmentRules[0]!.header)
);
if (indicatorAlignmentClassNames.length !== 1) {
  throw new Error("the CheckboxField indicator alignment mutation expected one class");
}
const missingCheckboxIndicatorAlignment = replaceCheckboxStyleClassName(
  compiledJavaScript,
  "indicator",
  indicatorAlignmentClassNames[0]!,
  "xcheckboxindicatoralignmentmissing",
);
assert.throws(
  () =>
    requireCheckboxFieldContract(
      `${legacyComponents}\n@layer ${LEGACY_LAYER} { .hraness-checkbox-field__control { display: grid; } }`,
      compiledCss,
      compiledJavaScript,
    ),
  /legacy CheckboxField recipe/u,
  "the CheckboxField guard must reject a restored legacy selector",
);
assert.throws(
  () =>
    requireCheckboxFieldContract(
      legacyComponents,
      compiledCss,
      missingCheckboxIndicatorAlignment,
    ),
  /CheckboxField indicator block-axis alignment/u,
  "the CheckboxField guard must reject indicator alignment owned only by the control",
);
assert.throws(
  () =>
    requireCheckboxFieldContract(
      legacyComponents,
      changedCheckboxDefaultTarget,
      compiledJavaScript,
    ),
  /CheckboxField default target/u,
  "the CheckboxField guard must reject changed default target geometry",
);
assert.throws(
  () =>
    requireCheckboxFieldContract(
      legacyComponents,
      relocatedCheckboxCoarseTarget,
      compiledJavaScript,
    ),
  /coarse-pointer target must remain directly inside @media\(pointer:coarse\)/u,
  "the CheckboxField guard must reject a coarse-pointer target relocated outside its exact media block",
);
assert.throws(
  () =>
    requireCheckboxFieldContract(
      legacyComponents,
      relocatedCheckboxForcedBorder,
      compiledJavaScript,
    ),
  /forced-colors border must remain directly inside @media\(forced-colors:active\)/u,
  "the CheckboxField guard must reject a forced-colors border relocated outside its exact media block",
);
assert.throws(
  () =>
    requireCheckboxFieldContract(
      legacyComponents,
      relocatedCheckboxForcedAdjustment,
      compiledJavaScript,
    ),
  /forced-colors adjustment must remain directly inside @media\(forced-colors:active\)/u,
  "the CheckboxField guard must reject a forced-colors adjustment relocated outside its exact media block",
);
assert.throws(
  () =>
    requireCheckboxFieldSourceContract(
      replaceCheckboxFieldSourceOnce(
        fieldsSource,
        "showLabel = true",
        "showLabel = false",
      ),
    ),
  /visible-by-default CheckboxField label/u,
  "the CheckboxField guard must reject hidden-by-default labels",
);
assert.throws(
  () =>
    requireCheckboxFieldSourceContract(
      fieldsSource.replace(
        "mergeStylexInlineStyles(presentation.style, domProps.style)",
        "mergeStylexInlineStyles(domProps.style, presentation.style)",
      ),
    ),
  /StyleX-before-native root style merge/u,
  "the CheckboxField guard must reject reversed native-style precedence",
);
assert.throws(
  () =>
    requireNoGallerySentinels(
      `${compiledJavaScript}\n${compiledCss}\n${legacyComponents}\n${orderedStylesheet}\n[data-gallery-checkbox-field-layer-conflict] { display: block; }`,
    ),
  /gallery-only data-gallery-checkbox-field-layer-conflict sentinel/u,
  "the CheckboxField guard must reject gallery sentinel leakage",
);

console.log("StyleX package artifacts match the compiler contract");
