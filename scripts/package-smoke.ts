import assert from "node:assert/strict";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

type ReactRelease = Readonly<{
  label: string;
  reactTypes: string;
  reactDomTypes: string;
  version: string;
}>;

const reactReleases: readonly ReactRelease[] = [
  {
    label: "react-18",
    reactTypes: "^18.3.0",
    reactDomTypes: "^18.3.0",
    version: "18.3.1",
  },
  {
    label: "react-19",
    reactTypes: "^19.2.0",
    reactDomTypes: "^19.2.0",
    version: "19.2.3",
  },
];

async function run(command: string[], cwd: string): Promise<void> {
  const process = Bun.spawn(command, {
    cwd,
    env: environment,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) throw new Error(`Command failed (${String(exitCode)}): ${command.join(" ")}`);
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
const LINK_STYLE_KEYS = [
  "focusVisible",
  "hovered",
  "nativeInteractionFallbacks",
  "root",
] as const;
type LinkStyleKey = (typeof LINK_STYLE_KEYS)[number];

function balancedBlock(source: string, open: number, description: string): string {
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
      assert.notEqual(end, -1, `${description} contains an unterminated comment`);
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
  throw new Error(`${description} contains an unterminated block`);
}

interface CheckboxPrecedenceProbe {
  readonly controlBaseClasses: readonly string[];
  readonly controlProperty: string;
  readonly rootBaseClasses: readonly string[];
  readonly rootProperty: string;
}

interface PackageCheckboxStyleMap extends CheckboxPrecedenceProbe {
  readonly classNames: ReadonlySet<string>;
}

interface LinkPrecedenceProbe {
  readonly baseClasses: readonly string[];
  readonly property: string;
}

interface PackageLinkStyleMap extends LinkPrecedenceProbe {
  readonly classNames: ReadonlySet<string>;
  readonly classNamesByKey: Readonly<Record<LinkStyleKey, ReadonlySet<string>>>;
}

interface FormPrecedenceProbe {
  readonly baseClasses: readonly string[];
  readonly property: string;
}

interface PackageFormStyleMap extends FormPrecedenceProbe {
  readonly classNames: ReadonlySet<string>;
}

interface PackageVisuallyHiddenStyleMap {
  readonly classNames: ReadonlySet<string>;
}

function packageCheckboxStyleMap(javaScript: string): PackageCheckboxStyleMap {
  const candidates: string[] = [];
  for (const match of javaScript.matchAll(
    /(?:\b(?:const|let|var)\s+|,)([A-Za-z_$][\w$]*)\s*=\s*\{\s*control\s*:\s*\{/gu,
  )) {
    const open = (match.index ?? 0) + match[0].indexOf("{");
    const object = balancedBlock(javaScript, open, "packed CheckboxField JavaScript");
    if (CHECKBOX_STYLE_KEYS.every(
      (key) => new RegExp(`(?:^|,)\\s*${key}\\s*:\\s*\\{`, "u")
        .test(object.slice(1, -1)),
    )) {
      candidates.push(object);
    }
  }
  assert.equal(
    candidates.length,
    1,
    "packed JavaScript must contain exactly one compiled checkboxFieldStyles class map",
  );
  const classNames = new Set<string>();
  for (const match of candidates[0]!.matchAll(
    /["']((?:x[A-Za-z0-9_-]+)(?:\s+x[A-Za-z0-9_-]+)*)["']/gu,
  )) {
    for (const className of match[1]!.split(/\s+/u)) classNames.add(className);
  }
  assert.notEqual(classNames.size, 0, "packed checkboxFieldStyles map must not be empty");
  const entry = (key: "control" | "root") => {
    const objectBody = candidates[0]!.slice(1, -1);
    const match = new RegExp(
      `(?:^|,)\\s*${key}\\s*:\\s*\\{`,
      "u",
    ).exec(objectBody);
    assert.ok(match !== null, `packed checkboxFieldStyles must include ${key}`);
    const open = (match.index ?? 0) + match[0].lastIndexOf("{");
    return balancedBlock(objectBody, open, `packed checkboxFieldStyles.${key}`);
  };
  const propertyProbe = (key: "control" | "root") => {
    const declaration = [...entry(key).matchAll(
      /([A-Za-z_$][\w$]*)\s*:\s*["']((?:x[A-Za-z0-9_-]+)(?:\s+x[A-Za-z0-9_-]+)*)["']/gu,
    )][0];
    assert.ok(declaration !== undefined, `packed checkboxFieldStyles.${key} has no class property`);
    return {
      baseClasses: declaration[2]!.split(/\s+/u),
      property: declaration[1]!,
    };
  };
  const control = propertyProbe("control");
  const root = propertyProbe("root");
  return {
    classNames,
    controlBaseClasses: control.baseClasses,
    controlProperty: control.property,
    rootBaseClasses: root.baseClasses,
    rootProperty: root.property,
  };
}

function packageLinkStyleMap(javaScript: string): PackageLinkStyleMap {
  const candidates: string[] = [];
  for (const match of javaScript.matchAll(
    /(?:\b(?:const|let|var)\s+|,)([A-Za-z_$][\w$]*)\s*=\s*\{\s*focusVisible\s*:\s*\{/gu,
  )) {
    const open = (match.index ?? 0) + match[0].indexOf("{");
    const object = balancedBlock(javaScript, open, "packed Link JavaScript");
    if (LINK_STYLE_KEYS.every(
      (key) => new RegExp(`(?:^|,)\\s*${key}\\s*:\\s*\\{`, "u")
        .test(object.slice(1, -1)),
    )) {
      candidates.push(object);
    }
  }
  assert.equal(
    candidates.length,
    1,
    "packed JavaScript must contain exactly one compiled linkStyles class map",
  );
  const classNames = new Set<string>();
  for (const match of candidates[0]!.matchAll(
    /["']((?:x[A-Za-z0-9_-]+)(?:\s+x[A-Za-z0-9_-]+)*)["']/gu,
  )) {
    for (const className of match[1]!.split(/\s+/u)) classNames.add(className);
  }
  assert.notEqual(classNames.size, 0, "packed linkStyles map must not be empty");
  const objectBody = candidates[0]!.slice(1, -1);
  const entry = (key: LinkStyleKey) => {
    const matches = [...objectBody.matchAll(
      new RegExp(`(?:^|,)\\s*${key}\\s*:\\s*\\{`, "gu"),
    )];
    assert.equal(
      matches.length,
      1,
      `packed linkStyles must include exactly one ${key}`,
    );
    const match = matches[0]!;
    const open = (match.index ?? 0) + match[0].lastIndexOf("{");
    return balancedBlock(objectBody, open, `packed linkStyles.${key}`);
  };
  const classNamesFor = (key: LinkStyleKey): ReadonlySet<string> => {
    const names = new Set<string>();
    for (const match of entry(key).matchAll(
      /["']((?:x[A-Za-z0-9_-]+)(?:\s+x[A-Za-z0-9_-]+)*)["']/gu,
    )) {
      for (const className of match[1]!.split(/\s+/u)) names.add(className);
    }
    assert.notEqual(
      names.size,
      0,
      `packed linkStyles.${key} must not be empty`,
    );
    return names;
  };
  const classNamesByKey = Object.fromEntries(
    LINK_STYLE_KEYS.map((key) => [key, classNamesFor(key)]),
  ) as Record<LinkStyleKey, ReadonlySet<string>>;
  const root = entry("root");
  const declaration = [...root.matchAll(
    /([A-Za-z_$][\w$]*)\s*:\s*["']((?:x[A-Za-z0-9_-]+)(?:\s+x[A-Za-z0-9_-]+)*)["']/gu,
  )][0];
  assert.ok(declaration !== undefined, "packed linkStyles.root has no class property");
  return {
    baseClasses: declaration[2]!.split(/\s+/u),
    classNames,
    classNamesByKey,
    property: declaration[1]!,
  };
}

function packageCheckboxRuleBodies(
  css: string,
  classNames: ReadonlySet<string>,
): string[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
    .filter((match) => [...classNames].some((className) =>
      new RegExp(`\\.${className}(?![A-Za-z0-9_-])`, "u").test(match[1]!)
    ))
    .map((match) => match[2]!);
}

function packageFormStyleMap(
  javaScript: string,
  css: string,
): PackageFormStyleMap {
  const expectedDeclarations = new Set([
    "display:grid;",
    "gap:var(--space-6);",
    "min-width:0;",
  ]);
  const candidates: Array<Readonly<{ classNames: ReadonlySet<string>; root: string }>> = [];
  for (const match of javaScript.matchAll(
    /(?:\b(?:const|let|var)\s+|,)([A-Za-z_$][\w$]*)\s*=\s*\{\s*root\s*:\s*\{/gu,
  )) {
    const open = (match.index ?? 0) + match[0].indexOf("{");
    const object = balancedBlock(javaScript, open, "packed Form JavaScript");
    const objectBody = object.slice(1, -1);
    const rootMatch = /(?:^|,)\s*root\s*:\s*\{/u.exec(objectBody);
    if (rootMatch === null) continue;
    const rootOpen = (rootMatch.index ?? 0) + rootMatch[0].lastIndexOf("{");
    const root = balancedBlock(objectBody, rootOpen, "packed formStyles.root");
    const rootEnd = rootOpen + root.length;
    if (objectBody.slice(rootEnd).replace(/^\s*,?\s*/u, "").length !== 0) {
      continue;
    }
    const classNames = new Set<string>();
    for (const classMatch of root.matchAll(
      /["']((?:x[A-Za-z0-9_-]+)(?:\s+x[A-Za-z0-9_-]+)*)["']/gu,
    )) {
      for (const className of classMatch[1]!.split(/\s+/u)) {
        classNames.add(className);
      }
    }
    if (classNames.size !== 3) continue;
    const declarations = new Set(
      packageCheckboxRuleBodies(css, classNames)
        .map((body) => normalizedAtomicDeclaration(body)),
    );
    if (
      declarations.size === expectedDeclarations.size
      && [...expectedDeclarations].every((value) => declarations.has(value))
    ) {
      candidates.push({ classNames, root });
    }
  }
  assert.equal(
    candidates.length,
    1,
    "packed JavaScript must contain exactly one compiled formStyles class map",
  );
  const candidate = candidates[0]!;
  const displayEntries = [...candidate.root.slice(1, -1).matchAll(
    /(?:^|,)\s*([A-Za-z_$][\w$]*)\s*:\s*["']((?:x[A-Za-z0-9_-]+)(?:\s+x[A-Za-z0-9_-]+)*)["']/gu,
  )].filter((entry) => {
    const entryClasses = new Set(entry[2]!.split(/\s+/u));
    return packageCheckboxRuleBodies(css, entryClasses)
      .map((body) => normalizedAtomicDeclaration(body))
      .includes("display:grid;");
  });
  assert.equal(
    displayEntries.length,
    1,
    "packed formStyles.root must bind exactly one compiled key to display:grid",
  );
  const display = displayEntries[0]!;
  return {
    baseClasses: display[2]!.split(/\s+/u),
    classNames: candidate.classNames,
    property: display[1]!,
  };
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

const VISUALLY_HIDDEN_DECLARATIONS = new Set([
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

function packageVisuallyHiddenStyleMap(
  javaScript: string,
  css: string,
): PackageVisuallyHiddenStyleMap {
  const candidates: PackageVisuallyHiddenStyleMap[] = [];
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
    const declarations = new Set(
      packageCheckboxRuleBodies(css, classNames)
        .map((body) => normalizedAtomicDeclaration(body)),
    );
    const key = [...classNames].sort().join(" ");
    if (
      [...declarations].filter((value) => fingerprints.has(value)).length >= 4
      && !candidateKeys.has(key)
    ) {
      candidateKeys.add(key);
      candidates.push({ classNames });
    }
  };
  for (const match of javaScript.matchAll(
    /(?:\b(?:const|let|var)\s+|,)([A-Za-z_$][\w$]*)\s*=\s*\{\s*root\s*:\s*\{/gu,
  )) {
    const open = (match.index ?? 0) + match[0].indexOf("{");
    const object = balancedBlock(
      javaScript,
      open,
      "packed visuallyHiddenStyles JavaScript",
    );
    const objectBody = object.slice(1, -1);
    const rootMatch = /(?:^|,)\s*root\s*:\s*\{/u.exec(objectBody);
    if (rootMatch === null) continue;
    const rootOpen = (rootMatch.index ?? 0) + rootMatch[0].lastIndexOf("{");
    const root = balancedBlock(
      objectBody,
      rootOpen,
      "packed visuallyHiddenStyles.root",
    );
    const rootEnd = rootOpen + root.length;
    if (objectBody.slice(rootEnd).replace(/^\s*,?\s*/u, "").length !== 0) {
      continue;
    }
    const classNames = new Set<string>();
    for (const classMatch of root.matchAll(
      /["']((?:x[A-Za-z0-9_-]+)(?:\s+x[A-Za-z0-9_-]+)*)["']/gu,
    )) {
      for (const className of classMatch[1]!.split(/\s+/u)) {
        classNames.add(className);
      }
    }
    if (classNames.size === 0) continue;
    addCandidate(classNames);
  }
  for (const match of javaScript.matchAll(
    /["']((?:x[A-Za-z0-9_-]+)(?:\s+x[A-Za-z0-9_-]+){3,})["']/gu,
  )) {
    const classNames = new Set(match[1]!.split(/\s+/u));
    addCandidate(classNames);
  }
  if (candidates.length === 0) {
    const classNames = new Set<string>();
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
      if (!VISUALLY_HIDDEN_DECLARATIONS.has(
        normalizedAtomicDeclaration(match[2] ?? ""),
      )) continue;
      const className = match[1]?.trim().match(
        /^\.((?:x[A-Za-z0-9_-]+))$/u,
      )?.[1];
      if (className !== undefined) classNames.add(className);
    }
    if (
      classNames.size === VISUALLY_HIDDEN_DECLARATIONS.size
      && [...classNames].every((className) => javaScript.includes(className))
    ) {
      candidates.push({ classNames });
    }
  }
  assert.equal(
    candidates.length,
    1,
    "packed JavaScript must contain exactly one compiled visuallyHiddenStyles class set",
  );
  return candidates[0]!;
}

interface PackageStyleRule {
  readonly body: string;
  readonly header: string;
  readonly source: string;
}

function packageSelectorList(header: string): readonly string[] {
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

function packageStyleRules(
  css: string,
  classNames: ReadonlySet<string>,
): PackageStyleRule[] {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)]
    .filter((match) => [...classNames].some((className) =>
      new RegExp(`\\.${className}(?![A-Za-z0-9_-])`, "u").test(match[1]!)
    ))
    .map((match) => ({
      body: match[2]!,
      header: match[1]!.trim(),
      source: match[0],
    }));
}

function packageDeclarationSelectors(
  rules: readonly PackageStyleRule[],
  classNames: ReadonlySet<string>,
  declaration: RegExp,
  description: string,
): readonly string[] {
  const selectors = rules
    .filter((rule) => declaration.test(rule.body))
    .flatMap((rule) => packageSelectorList(rule.header))
    .filter((selector) => [...classNames].some((className) =>
      new RegExp(`\\.${className}(?![A-Za-z0-9_-])`, "u").test(selector)
    ));
  assert.notEqual(
    selectors.length,
    0,
    `${description} must have a class-owned selector`,
  );
  return selectors;
}

function requirePackagePositivePseudoSelector(
  selector: string,
  pseudo: "focus-visible" | "hover",
  description: string,
): void {
  assert.doesNotMatch(
    selector,
    new RegExp(`:not\\([^)]*:${pseudo}(?![A-Za-z0-9_-])[^)]*\\)`, "u"),
    `${description} must not negate :${pseudo}`,
  );
  assert.match(
    selector,
    new RegExp(`:${pseudo}(?![A-Za-z0-9_-])`, "u"),
    description,
  );
}

function packageExactConditionalCss(css: string, condition: string): string {
  const bodies: string[] = [];
  for (const match of css.matchAll(/@media\s*\([^{}]+\)\s*\{/gu)) {
    const open = (match.index ?? 0) + match[0].lastIndexOf("{");
    const header = css.slice(match.index, open).replace(/\s+/gu, "")
      .toLowerCase();
    if (header === condition) {
      const block = balancedBlock(css, open, `packed ${condition} CSS`);
      bodies.push(block.slice(1, -1));
    }
  }
  assert.notEqual(bodies.length, 0, `packed CSS must contain an exact ${condition} block`);
  return bodies.join("\n");
}

function requirePackageCheckboxStyles(javaScript: string, css: string): void {
  const { classNames } = packageCheckboxStyleMap(javaScript);
  const familyCss = packageCheckboxRuleBodies(css, classNames).join("\n");
  assert.match(
    familyCss,
    /min-height:\s*var\(--interactive-target-compact\)/u,
    "checkboxFieldStyles must own the packed default target",
  );
  assert.match(
    familyCss,
    /transition-property:\s*background-color,\s*border-color/u,
    "checkboxFieldStyles must own the packed indicator transitions",
  );
  const coarseCss = packageCheckboxRuleBodies(
    packageExactConditionalCss(css, "@media(pointer:coarse)"),
    classNames,
  ).join("\n");
  assert.match(
    coarseCss,
    /min-height:\s*var\(--interactive-target-min\)/u,
    "checkboxFieldStyles must own the coarse target inside the exact conditional block",
  );
  const forcedColorsCss = packageCheckboxRuleBodies(
    packageExactConditionalCss(css, "@media(forced-colors:active)"),
    classNames,
  ).join("\n");
  assert.match(
    forcedColorsCss,
    /border-color:\s*canvastext/u,
    "checkboxFieldStyles must own the forced-color border inside the exact conditional block",
  );
  assert.match(
    forcedColorsCss,
    /forced-color-adjust:\s*auto/u,
    "checkboxFieldStyles must own the forced-color adjustment inside the exact conditional block",
  );
}

function requirePackageFormStyles(javaScript: string, css: string): void {
  const { classNames } = packageFormStyleMap(javaScript, css);
  assert.equal(
    classNames.size,
    3,
    "formStyles.root must preserve exactly three packed atomic classes",
  );
  const declarations = new Set(
    packageCheckboxRuleBodies(css, classNames)
      .map((body) => normalizedAtomicDeclaration(body)),
  );
  assert.deepEqual(
    [...declarations].sort(),
    ["display:grid;", "gap:var(--space-6);", "min-width:0;"],
    "formStyles.root must preserve the exact packed declaration set",
  );
}
function requirePackageVisuallyHiddenStyles(
  javaScript: string,
  css: string,
): readonly string[] {
  const { classNames } = packageVisuallyHiddenStyleMap(javaScript, css);
  assert.equal(
    classNames.size,
    15,
    "visuallyHiddenStyles.root must preserve exactly 15 packed atomic classes",
  );
  const actualDeclarations = new Set<string>();
  for (const className of classNames) {
    const escapedClassName = className.replace(
      /[.*+?^${}()|[\]\\]/gu,
      "\\$&",
    );
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].filter(
      (match) => new RegExp(
        `\\.${escapedClassName}(?![A-Za-z0-9_-])`,
        "u",
      ).test(match[1]!),
    );
    assert.equal(
      rules.length,
      1,
      `packed CSS must contain one rule for visually-hidden class ${className}`,
    );
    assert.doesNotMatch(
      rules[0]?.[1] ?? "",
      /:/u,
      `packed visually-hidden class ${className} must remain unconditional`,
    );
    actualDeclarations.add(normalizedAtomicDeclaration(rules[0]?.[2] ?? ""));
  }
  assert.deepEqual(
    [...actualDeclarations].sort(),
    [...VISUALLY_HIDDEN_DECLARATIONS].sort(),
    "packed visuallyHiddenStyles.root must preserve the exact important declaration set",
  );
  return [...classNames];
}

function requirePackageLinkStyles(javaScript: string, css: string): void {
  const { classNamesByKey } = packageLinkStyleMap(javaScript);
  const recipeRules = (key: LinkStyleKey) => packageStyleRules(
    css,
    classNamesByKey[key],
  );
  const rootRules = recipeRules("root");
  const hoveredRules = recipeRules("hovered");
  const focusVisibleRules = recipeRules("focusVisible");
  const nativeFallbackRules = recipeRules("nativeInteractionFallbacks");
  const cssFor = (rules: readonly PackageStyleRule[]) =>
    rules.map((rule) => rule.source).join("\n");
  const rootCss = cssFor(rootRules);
  const hoveredCss = cssFor(hoveredRules);
  const focusVisibleCss = cssFor(focusVisibleRules);
  const nativeFallbackCss = cssFor(nativeFallbackRules);
  for (const [pattern, description] of [
    [/color:\s*var\(--ui-primary\)/u, "Link color"],
    [/text-decoration-thickness:\s*1px/u, "base underline thickness"],
    [/text-underline-offset:\s*0?\.2em/u, "underline offset"],
  ] as const) {
    assert.match(
      rootCss,
      pattern,
      `linkStyles.root must own the packed ${description}`,
    );
    for (const selector of packageDeclarationSelectors(
      rootRules,
      classNamesByKey.root,
      pattern,
      `linkStyles.root ${description}`,
    )) {
      assert.doesNotMatch(
        selector,
        /:(?:focus-visible|hover)(?![A-Za-z0-9_-])/u,
        `linkStyles.root ${description} must remain unconditional`,
      );
    }
  }
  const hoveredDeclaration = /text-decoration-thickness:\s*2px/u;
  assert.match(
    hoveredCss,
    hoveredDeclaration,
    "linkStyles.hovered must own the packed hovered underline thickness",
  );
  for (const selector of packageDeclarationSelectors(
    hoveredRules,
    classNamesByKey.hovered,
    hoveredDeclaration,
    "linkStyles.hovered underline thickness",
  )) {
    assert.doesNotMatch(
      selector,
      /:hover(?![A-Za-z0-9_-])/u,
      "linkStyles.hovered must remain an unconditional explicit state recipe",
    );
  }
  const focusDeclarations = [
    [/outline-color:\s*var\(--ui-ring\)/u, "focus-ring color"],
    [/outline-offset:\s*2px/u, "focus-ring offset"],
    [/outline-style:\s*solid/u, "focus-ring style"],
    [/outline-width:\s*2px/u, "focus-ring width"],
  ] as const;
  for (const [pattern, description] of focusDeclarations) {
    assert.match(
      focusVisibleCss,
      pattern,
      `linkStyles.focusVisible must own the packed ${description}`,
    );
    assert.match(
      nativeFallbackCss,
      pattern,
      `linkStyles.nativeInteractionFallbacks must own the packed ${description}`,
    );
    for (const selector of packageDeclarationSelectors(
      focusVisibleRules,
      classNamesByKey.focusVisible,
      pattern,
      `linkStyles.focusVisible ${description}`,
    )) {
      assert.doesNotMatch(
        selector,
        /:focus-visible(?![A-Za-z0-9_-])/u,
        `linkStyles.focusVisible ${description} must remain unconditional`,
      );
    }
    for (const selector of packageDeclarationSelectors(
      nativeFallbackRules,
      classNamesByKey.nativeInteractionFallbacks,
      pattern,
      `linkStyles.nativeInteractionFallbacks ${description}`,
    )) {
      requirePackagePositivePseudoSelector(
        selector,
        "focus-visible",
        `linkStyles.nativeInteractionFallbacks ${description} must keep its native focus selector`,
      );
    }
  }
  assert.match(
    nativeFallbackCss,
    hoveredDeclaration,
    "linkStyles.nativeInteractionFallbacks must own the packed hover thickness",
  );
  for (const selector of packageDeclarationSelectors(
    nativeFallbackRules,
    classNamesByKey.nativeInteractionFallbacks,
    hoveredDeclaration,
    "linkStyles.nativeInteractionFallbacks hover thickness",
  )) {
    requirePackagePositivePseudoSelector(
      selector,
      "hover",
      "linkStyles.nativeInteractionFallbacks must keep its native hover selector",
    );
  }
}

function resolveGenuineNodeExecutable(): string {
  const executableName = process.platform === "win32" ? "node.exe" : "node";
  const identityProbe = [
    "if (typeof Bun !== 'undefined'",
    "|| process.versions.bun !== undefined",
    "|| !process.versions.node?.startsWith('24.')) process.exit(1)",
  ].join(" ");
  const candidates = [...new Set(
    (process.env.PATH ?? "")
      .split(delimiter)
      .filter((directory) => directory.length > 0)
      .map((directory) => resolve(directory, executableName)),
  )];
  for (const executable of candidates) {
    try {
      const probe = Bun.spawnSync([
        executable,
        "--input-type=commonjs",
        "-e",
        identityProbe,
      ], {
        env: environment,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      if (probe.exitCode === 0) return executable;
    } catch {
      // Continue past absent, inaccessible, or incompatible PATH candidates.
    }
  }
  throw new Error("package smoke requires a genuine Node 24 executable on PATH");
}

function ssrProbe(
  release: ReactRelease,
  checkboxProbe: CheckboxPrecedenceProbe,
  formProbe: FormPrecedenceProbe,
  linkProbe: LinkPrecedenceProbe,
  visuallyHiddenClasses: readonly string[],
): string {
  return String.raw`import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

import { Search01Icon } from "@hugeicons/core-free-icons";
import {
  AppearanceIcon,
  AskAiAboutThis,
  Avatar,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  CheckboxField,
  Form,
  Icon,
  KeyHint,
  Link,
  PressableCard,
  QuietSiteFooter,
  QuietSitePage,
  SocialIcon,
  StatusDot,
  Tag,
  ThemedSurface,
  Toolbar,
  ViewportFrame,
  WrappingRow,
  buildAskAiProviderLinks,
} from "@hraness/ui";
import { FormContext } from "react-aria-components";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

assert.equal(React.version, ${JSON.stringify(release.version)});

const checkboxRootXstyle = {
  ${JSON.stringify(checkboxProbe.rootProperty)}: "package-checkbox-root-xstyle",
  $$css: true,
};
const checkboxControlXstyle = {
  ${JSON.stringify(checkboxProbe.controlProperty)}: "package-checkbox-control-xstyle",
  $$css: true,
};
const checkboxRootBaseClasses = ${JSON.stringify(checkboxProbe.rootBaseClasses)};
const checkboxControlBaseClasses = ${JSON.stringify(checkboxProbe.controlBaseClasses)};
const formXstyle = {
  ${JSON.stringify(formProbe.property)}: "package-form-xstyle",
  $$css: true,
};
const formBaseClasses = ${JSON.stringify(formProbe.baseClasses)};
const linkXstyle = {
  ${JSON.stringify(linkProbe.property)}: "package-link-xstyle",
  $$css: true,
};
const linkBaseClasses = ${JSON.stringify(linkProbe.baseClasses)};
const visuallyHiddenClasses = ${JSON.stringify(visuallyHiddenClasses)};

const reactDomPackageUrl = import.meta.resolve("react-dom/package.json");
const reactDomPackage = JSON.parse(await readFile(new URL(reactDomPackageUrl), "utf8"));
assert.equal(reactDomPackage.version, ${JSON.stringify(release.version)});

const stylexCssUrl = import.meta.resolve("@hraness/ui/stylex.css");
assert.equal(new URL(stylexCssUrl).protocol, "file:");
const stylexCss = await readFile(new URL(stylexCssUrl), "utf8");
assert.ok(stylexCss.trim().length > 0, "@hraness/ui/stylex.css must not be empty");
assert.match(stylexCss, /@layer components\.hraness-ui\.priority3/u);
assert.match(stylexCss, /@layer components\.hraness-ui\.priority4/u);
assert.match(stylexCss, /max-inline-size:\s*var\(--hraness-quiet-site-measure,\s*34rem\)/u);
assert.doesNotMatch(stylexCss, /max-width:\s*var\(--hraness-quiet-site-measure,\s*34rem\)/u);
assert.match(stylexCss, /gap:\s*var\(--space-3\)/u);
assert.match(stylexCss, /inline-size:\s*100%/u);
assert.match(stylexCss, /min-inline-size:\s*0/u);
assert.match(stylexCss, /overflow:\s*hidden/u);
assert.match(stylexCss, /background-color:\s*var\(--ui-card\)/u);
assert.match(stylexCss, /background-color:\s*var\(--ui-popover\)/u);
assert.match(stylexCss, /border-radius:\s*var\(--radius-sharp\)/u);
assert.match(stylexCss, /box-shadow:\s*var\(--elevation-raised\)/u);
assert.match(stylexCss, /padding-block:\s*var\(--space-6\)/u);
assert.match(stylexCss, /padding-inline:\s*var\(--space-6\)/u);
assert.match(stylexCss, /background-color:\s*var\(--ui-muted\)/u);
assert.match(stylexCss, /border-radius:\s*var\(--radius-round\)/u);
assert.match(stylexCss, /height:\s*3\.5rem/u);
assert.match(stylexCss, /object-fit:\s*cover/u);
assert.match(stylexCss, /width:\s*3\.5rem/u);
assert.match(stylexCss, /border-color:\s*var\(--hraness-tag-accent,\s*var\(--ui-border\)\)/u);
assert.match(stylexCss, /border-color:\s*canvastext/u);
assert.match(stylexCss, /forced-color-adjust:\s*auto/u);
assert.match(stylexCss, /height:\s*\.625rem/u);
assert.match(stylexCss, /min-height:\s*1\.5rem/u);
assert.match(stylexCss, /width:\s*\.625rem/u);
assert.match(stylexCss, /width:\s*fit-content/u);
assert.match(stylexCss, /background-color:\s*var\(--ui-accent\)/u);
assert.match(stylexCss, /border-color:\s*color-mix\(in oklch,var\(--ui-primary\) 35%,var\(--ui-border\)\)/u);
assert.match(stylexCss, /box-shadow:\s*var\(--elevation-low\)/u);
assert.match(stylexCss, /color:\s*var\(--hraness-card-description\)/u);
assert.doesNotMatch(stylexCss, /--hraness-card-description\s*:/u);
assert.doesNotMatch(stylexCss, /--_hraness-card-description/u);
assert.match(stylexCss, /gap:\s*var\(--space-6\)/u);
assert.match(stylexCss, /outline-color:\s*var\(--ui-ring\)/u);
assert.match(stylexCss, /transform:\s*translateY\(1px\)/u);
assert.match(stylexCss, /:hover\s*\{/u);
assert.match(stylexCss, /:active\s*\{/u);
assert.match(stylexCss, /:focus-visible\s*\{/u);
assert.match(stylexCss, /outline-offset:\s*2px/u);
assert.match(stylexCss, /padding-block:\s*var\(--space-1\)/u);
assert.match(stylexCss, /padding-inline:\s*var\(--space-1\)/u);
assert.match(stylexCss, /border-block-end-width:\s*2px/u);
assert.match(stylexCss, /font-family:\s*var\(--ui-font-mono\)/u);
assert.match(stylexCss, /min-height:\s*1\.875rem/u);
assert.match(stylexCss, /min-height:\s*var\(--interactive-target-min,\s*3rem\)/u);
assert.match(stylexCss, /min-block-size:\s*1\.5rem/u);
assert.match(stylexCss, /min-inline-size:\s*1\.5rem/u);
assert.match(stylexCss, /text-decoration-thickness:\s*1px/u);
assert.match(stylexCss, /text-decoration-thickness:\s*2px/u);
assert.match(stylexCss, /text-underline-offset:\s*0?\.2em/u);
assert.match(stylexCss, /background-color:\s*var\(--ui-destructive\)/u);
assert.match(stylexCss, /min-height:\s*var\(--interactive-target-min\)/u);
assert.match(stylexCss, /min-height:\s*var\(--control-height-primary\)/u);
assert.match(stylexCss, /min-height:\s*var\(--control-height-transport\)/u);
assert.match(stylexCss, /font-family:\s*inherit/u);
assert.match(stylexCss, /font-stretch:\s*inherit/u);
assert.match(stylexCss, /font-style:\s*inherit/u);
assert.match(stylexCss, /font-variant:\s*inherit/u);
assert.match(stylexCss, /animation-name:\s*hraness-spin/u);
assert.match(stylexCss, /background-color:\s*buttonface/u);
assert.match(stylexCss, /color:\s*buttontext/u);
assert.match(stylexCss, /@media\s*\(pointer:\s*coarse\)/u);
assert.match(stylexCss, /position:\s*fixed/u);
assert.match(stylexCss, /background-attachment:\s*scroll/u);
assert.match(stylexCss, /background-clip:\s*border-box/u);
assert.match(stylexCss, /background-color:\s*var\(--ui-foreground\)/u);
assert.match(stylexCss, /background-image:\s*none/u);
assert.match(stylexCss, /background-origin:\s*padding-box/u);
assert.match(stylexCss, /background-position:\s*0 0/u);
assert.match(stylexCss, /background-repeat:\s*repeat/u);
assert.match(stylexCss, /background-size:\s*auto/u);
assert.match(stylexCss, /z-index:\s*var\(--z-skip-link\)/u);
assert.match(
  stylexCss,
  /transform:\s*translateY\(calc\(-100%\s*-\s*var\(--space-6\)\)\)/u,
);
assert.match(
  stylexCss,
  /:focus\s*\{[^{}]*transform:\s*translateY\(0\)/u,
);
const viewportHeightFallbacks = ["height: 100vh;", "height: 100svh;", "height: 100dvh;"];
const viewportHeightPositions = viewportHeightFallbacks.map((fallback) => stylexCss.indexOf(fallback));
assert.ok(viewportHeightPositions.every((position) => position >= 0));
assert.ok(
  viewportHeightPositions[0] < viewportHeightPositions[1]
  && viewportHeightPositions[1] < viewportHeightPositions[2],
  "the packed StyleX CSS must preserve the vh, svh, then dvh fallback order",
);
assert.equal(
  stylexCss.match(/(?:^|[\s{;])width:\s*100%/gu)?.length,
  1,
  "the packed CSS must contain exactly one shared physical 100% width declaration for Avatar children and PressableCard",
);
assert.equal(
  stylexCss.match(/(?:^|[\s{;])min-width:\s*0/gu)?.length,
  1,
  "the packed CSS must contain exactly one shared physical zero min-width declaration for the Tag label, PressableCard, Toolbar, CheckboxField, and Form",
);

const componentsCssUrl = import.meta.resolve("@hraness/ui/components.css");
const componentsCss = await readFile(new URL(componentsCssUrl), "utf8");
await access(new URL("./skip-link.stylex.ts", componentsCssUrl));
await access(new URL("./visually-hidden.stylex.ts", componentsCssUrl));
await access(new URL("./form.stylex.ts", componentsCssUrl));
assert.doesNotMatch(componentsCss, /\.hraness-form(?![A-Za-z0-9_-])/u);
assert.doesNotMatch(componentsCss, /\.hraness-quiet-site-(?:footer|page)(?![A-Za-z0-9_-])/u);
assert.doesNotMatch(componentsCss, /\.hraness-(?:viewport-frame|wrapping-row)(?![A-Za-z0-9_-])/u);
assert.doesNotMatch(componentsCss, /\.hraness-themed-surface(?![A-Za-z0-9_-])/u);
assert.doesNotMatch(componentsCss, /\.hraness-avatar(?:__image|__fallback)?(?![A-Za-z0-9_-])/u);
assert.doesNotMatch(
  componentsCss,
  /\.hraness-(?:badge(?:--[A-Za-z0-9_-]+)?|status-dot|tag(?:__(?:icon|label))?)(?![A-Za-z0-9_-])/u,
);
assert.doesNotMatch(
  componentsCss.replace(
    /:where\(\s*\.hraness-card\s*,\s*\.hraness-pressable-card\s*\)\s*\{\s*--hraness-card-description\s*:\s*var\(--_hraness-card-description\)\s*;?\s*\}/gu,
    "",
  ),
  /\.hraness-(?:card(?:__(?:header|title|description|content|footer))?|pressable-card)(?![A-Za-z0-9_-])/u,
);
assert.doesNotMatch(componentsCss, /\.hraness-toolbar(?![A-Za-z0-9_-])/u);
assert.doesNotMatch(componentsCss, /\.hraness-key-hint(?![A-Za-z0-9_-])/u);
assert.doesNotMatch(componentsCss, /\.hraness-link(?![A-Za-z0-9_-])/u);
assert.doesNotMatch(
  componentsCss,
  /\.hraness-(?:action__spinner|(?:button|copy-button|icon-button|icon-link|inline-icon-link|link-button|toggle-button)(?:__[A-Za-z0-9_-]+)?)(?![A-Za-z0-9_-])/u,
);
assert.doesNotMatch(
  componentsCss,
  /\.hraness-skip-link(?![A-Za-z0-9_-])/u,
);
assert.doesNotMatch(
  componentsCss,
  /\.hraness-visually-hidden(?![A-Za-z0-9_-])/u,
);
assert.match(
  componentsCss,
  /--hraness-action-coarse-min:\s*var\(--interactive-target-min\)/u,
);
assert.doesNotMatch(
  componentsCss,
  /\.hraness-checkbox-field(?:__(?:control|indicator|label))?(?![A-Za-z0-9_-])/u,
);
assert.equal(
  componentsCss.match(
    /:where\(\s*\.hraness-card\s*,\s*\.hraness-pressable-card\s*\)\s*\{\s*--hraness-card-description\s*:\s*var\(--_hraness-card-description\)\s*;?\s*\}/gu,
  )?.length,
  1,
  "components.css must contain the single Card description compatibility bridge",
);

const stylesCssUrl = import.meta.resolve("@hraness/ui/styles.css");
const stylesCss = await readFile(new URL(stylesCssUrl), "utf8");
assert.equal(
  stylesCss.match(/@import "\.\.\/dist\/stylex\.css";/gu)?.length,
  1,
  "the complete stylesheet must deliver generated StyleX CSS exactly once",
);
assert.match(
  stylesCss,
  /@layer components\.hraness-ui\.legacy, components\.hraness-ui\.priority1, components\.hraness-ui\.priority2, components\.hraness-ui\.priority3, components\.hraness-ui\.priority4;/u,
);

const markup = renderToStaticMarkup(React.createElement(Icon, {
  className: "consumer-icon",
  icon: Search01Icon,
}));
assert.match(markup, /<svg/u);
assert.match(markup, /aria-hidden="true"/u);
assert.match(markup, /class="[^"]*hraness-icon[^"]*consumer-icon[^"]*"/u);
assert.match(markup, /data-slot="icon"/u);

const askAiUrl = "https://hraness.com/stripe";
const askAiLinks = buildAskAiProviderLinks(askAiUrl);
assert.equal(askAiLinks.length, 4);
for (const link of askAiLinks) {
  const destination = new URL(link.href);
  const parameter = destination.hostname === "x.com" ? "text" : "q";
  assert.equal(destination.searchParams.get(parameter), "Tell me about " + askAiUrl);
}
const askAiMarkup = renderToStaticMarkup(React.createElement(AskAiAboutThis, {
  className: "consumer-ask-ai",
  url: askAiUrl,
}));
assert.match(askAiMarkup, /^<nav/u);
assert.match(askAiMarkup, /aria-label="Ask AI about this"/u);
assert.match(askAiMarkup, /class="[^"]*hraness-ask-ai-about-this[^"]*consumer-ask-ai[^"]*"/u);
assert.equal(askAiMarkup.match(/data-slot="ask-ai-about-this-link"/gu)?.length, 4);
assert.equal(askAiMarkup.match(/target="_blank"/gu)?.length, 4);

const socialMarkup = renderToStaticMarkup(React.createElement(SocialIcon, {
  className: "consumer-social-icon",
  name: "github",
}));
assert.match(socialMarkup, /<span/u);
assert.match(socialMarkup, /aria-hidden="true"/u);
assert.match(socialMarkup, /class="hraness-social-icon [^"]+ consumer-social-icon"/u);
assert.match(socialMarkup, /data-slot="social-icon"/u);
assert.match(socialMarkup, /data-social-icon="github"/u);
assert.match(socialMarkup, /width="16"/u);

const substackMarkup = renderToStaticMarkup(React.createElement(SocialIcon, {
  name: "substack",
  size: 21,
}));
assert.match(substackMarkup, /fill="currentColor"/u);
assert.match(substackMarkup, /height="21"/u);
assert.match(substackMarkup, /M22\.539 8\.242H1\.46V5\.406/u);

const appearanceMarkup = renderToStaticMarkup(React.createElement(AppearanceIcon, {
  className: "consumer-appearance-icon",
  name: "system",
}));
assert.match(appearanceMarkup, /<span/u);
assert.match(appearanceMarkup, /aria-hidden="true"/u);
assert.match(appearanceMarkup, /class="hraness-appearance-icon [^"]+ consumer-appearance-icon"/u);
assert.match(appearanceMarkup, /data-appearance-icon="system"/u);
assert.match(appearanceMarkup, /data-slot="appearance-icon"/u);
assert.match(appearanceMarkup, /width="18"/u);

const avatarMarkup = renderToStaticMarkup(React.createElement(Avatar, {
  alt: "Ada Lovelace avatar",
  className: "consumer-avatar",
  name: "Ada Lovelace",
  size: "large",
  style: { height: "4rem", width: "4rem" },
}));
assert.match(avatarMarkup, /^<span/u);
assert.match(avatarMarkup, /aria-label="Ada Lovelace avatar"/u);
assert.match(avatarMarkup, /class="hraness-avatar [^"]+ consumer-avatar"/u);
assert.match(avatarMarkup, /data-size="large"/u);
assert.match(avatarMarkup, /data-slot="avatar"/u);
assert.match(avatarMarkup, /role="img"/u);
assert.match(avatarMarkup, /style="height:4rem;width:4rem"/u);
assert.match(avatarMarkup, /title="Ada Lovelace"/u);
assert.match(avatarMarkup, /class="hraness-avatar__fallback [^"]+"/u);
assert.match(avatarMarkup, /data-slot="avatar-fallback"/u);
assert.match(avatarMarkup, />AL<\/span>/u);

const avatarImageMarkup = renderToStaticMarkup(React.createElement(Avatar, {
  "aria-label": "Grace profile",
  alt: "Grace Hopper",
  name: "Grace Hopper",
  src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
}));
assert.match(avatarImageMarkup, /aria-label="Grace profile"/u);
assert.doesNotMatch(avatarImageMarkup, /role="img"/u);
assert.match(avatarImageMarkup, /class="hraness-avatar__image [^"]+"/u);
assert.match(avatarImageMarkup, /data-slot="avatar-image"/u);
assert.match(avatarImageMarkup, /alt="Grace Hopper"/u);
assert.match(avatarImageMarkup, /src="data:image\/svg\+xml/u);

const badgeMarkup = renderToStaticMarkup(React.createElement(Badge, {
  className: "consumer-badge",
  isLive: true,
  style: { minHeight: "2rem" },
  tone: "success",
}, "Ready"));
assert.match(badgeMarkup, /^<span/u);
assert.match(badgeMarkup, /aria-live="polite"/u);
assert.match(badgeMarkup, /class="hraness-badge hraness-badge--success [^"]+ consumer-badge"/u);
assert.match(badgeMarkup, /data-slot="badge"/u);
assert.match(badgeMarkup, /data-tone="success"/u);
assert.match(badgeMarkup, /role="status"/u);
assert.match(badgeMarkup, /style="min-height:2rem"/u);
assert.match(badgeMarkup, />Ready<\/span>/u);

const tagMarkup = renderToStaticMarkup(React.createElement(Tag, {
  accentColor: "#D97706",
  className: "consumer-tag",
  icon: "◆",
  style: { marginInlineStart: "1rem" },
  variant: "outline",
}, "Project"));
assert.match(tagMarkup, /^<span/u);
assert.match(tagMarkup, /class="hraness-tag [^"]+ consumer-tag"/u);
assert.match(tagMarkup, /data-slot="tag"/u);
assert.match(tagMarkup, /data-variant="outline"/u);
assert.match(tagMarkup, /--hraness-tag-accent:#D97706/u);
assert.match(tagMarkup, /margin-inline-start:1rem/u);
assert.match(tagMarkup, /class="hraness-tag__icon [^"]+"/u);
assert.match(tagMarkup, /data-slot="tag-icon"/u);
assert.match(tagMarkup, /class="hraness-tag__label [^"]+"/u);
assert.match(tagMarkup, /data-slot="tag-label"/u);

const dotMarkup = renderToStaticMarkup(React.createElement(StatusDot, {
  className: "consumer-dot",
  style: { height: "1rem", width: "1rem" },
  tone: "danger",
}));
assert.match(dotMarkup, /^<span/u);
assert.match(dotMarkup, /aria-hidden="true"/u);
assert.match(dotMarkup, /class="hraness-status-dot [^"]+ consumer-dot"/u);
assert.match(dotMarkup, /data-slot="status-dot"/u);
assert.match(dotMarkup, /data-tone="danger"/u);
assert.match(dotMarkup, /style="height:1rem;width:1rem"/u);

const cardMarkup = renderToStaticMarkup(React.createElement(Card, {
  "aria-label": "Package card",
  className: "consumer-card",
  id: "package-card",
  shape: "rectangular",
  style: { borderRadius: "5px" },
  tone: "accent",
}, React.createElement(CardHeader, null,
  React.createElement(CardTitle, null, "Project"),
  React.createElement(CardDescription, null, "Compiled card"),
), React.createElement(CardContent, null, "Ready"),
React.createElement(CardFooter, null, "Footer")));
assert.match(cardMarkup, /^<div/u);
assert.match(cardMarkup, /aria-label="Package card"/u);
assert.match(cardMarkup, /class="hraness-card [^"]+ consumer-card"/u);
assert.match(cardMarkup, /data-shape="rectangular"/u);
assert.match(cardMarkup, /data-slot="card"/u);
assert.match(cardMarkup, /data-tone="accent"/u);
assert.match(cardMarkup, /id="package-card"/u);
assert.match(cardMarkup, /--_hraness-card-description:/u);
assert.doesNotMatch(cardMarkup, /--hraness-card-description:/u);
assert.match(cardMarkup, /border-radius:5px/u);
for (const slot of [
  "card-header",
  "card-title",
  "card-description",
  "card-content",
  "card-footer",
]) assert.match(cardMarkup, new RegExp('data-slot="' + slot + '"', "u"));

const pressableMarkup = renderToStaticMarkup(React.createElement(PressableCard, {
  "aria-label": "Open project",
  className: "consumer-pressable",
  isPending: true,
  shape: "rounded",
  style: (state) => ({
    opacity: state.isPending ? 0.75 : 1,
    width: "8rem",
  }),
  tone: "inverse",
}, "Open"));
assert.match(pressableMarkup, /^<button/u);
assert.match(pressableMarkup, /aria-label="Open project"/u);
assert.match(pressableMarkup, /aria-disabled="true"/u);
assert.match(pressableMarkup, /class="hraness-pressable-card [^"]+ consumer-pressable"/u);
assert.match(pressableMarkup, /data-pending="true"/u);
assert.match(pressableMarkup, /data-slot="pressable-card"/u);
assert.match(pressableMarkup, /--_hraness-card-description:/u);
assert.doesNotMatch(pressableMarkup, /--hraness-card-description:/u);
assert.match(pressableMarkup, /opacity:0\.75/u);
assert.match(pressableMarkup, /width:8rem/u);

const toolbarMarkup = renderToStaticMarkup(React.createElement(Toolbar, {
  "aria-label": "Package editor actions",
  className: "consumer-toolbar",
  orientation: "vertical",
  style: (state) => ({
    backgroundColor: state.orientation === "vertical" ? "rgb(1, 2, 3)" : undefined,
    width: "8rem",
  }),
}, React.createElement("button", { type: "button" }, "Save")));
assert.match(toolbarMarkup, /^<div/u);
assert.match(toolbarMarkup, /role="toolbar"/u);
assert.match(toolbarMarkup, /aria-label="Package editor actions"/u);
assert.match(toolbarMarkup, /aria-orientation="vertical"/u);
assert.match(toolbarMarkup, /class="hraness-toolbar [^"]+ consumer-toolbar"/u);
assert.match(toolbarMarkup, /data-orientation="vertical"/u);
assert.match(toolbarMarkup, /data-slot="toolbar"/u);
assert.match(toolbarMarkup, /background-color:rgb\(1, 2, 3\)/u);
assert.match(toolbarMarkup, /width:8rem/u);

const keyHintMarkup = renderToStaticMarkup(React.createElement(KeyHint, {
  "aria-label": "Command K",
  className: "consumer-key-hint",
  style: { width: "2rem" },
  title: "Open command menu",
}, "⌘K"));
assert.match(keyHintMarkup, /^<kbd/u);
assert.match(keyHintMarkup, /aria-label="Command K"/u);
assert.match(keyHintMarkup, /class="hraness-key-hint [^"]+ consumer-key-hint"/u);
assert.match(keyHintMarkup, /data-slot="key-hint"/u);
assert.match(keyHintMarkup, /style="width:2rem"/u);
assert.match(keyHintMarkup, /title="Open command menu"/u);
assert.match(keyHintMarkup, />⌘K<\/kbd>/u);

const linkMarkup = renderToStaticMarkup(React.createElement(Link, {
  className: "consumer-link",
  href: "/reference",
  style: ({ isHovered }) => ({ color: isHovered ? "red" : "blue" }),
  xstyle: linkXstyle,
}, "Reference"));
const linkTag = linkMarkup.match(/^<a[^>]*>/u)?.[0] ?? "";
assert.match(linkTag, /href="\/reference"/u);
assert.match(linkTag, /class="hraness-link [^"]*package-link-xstyle consumer-link"/u);
assert.match(linkTag, /data-slot="link"/u);
assert.match(linkTag, /style="color:blue"/u);
for (const baseClass of linkBaseClasses) {
  assert.ok(
    !linkTag.split(/[\s"]/u).includes(baseClass),
    "Link xstyle must replace its package property class",
  );
}

const formSubmit = () => undefined;
const formMarkup = renderToStaticMarkup(React.createElement(Form, {
  acceptCharset: "utf-8",
  action: "/preferences",
  className: "consumer-form",
  method: "post",
  onSubmit: formSubmit,
  render: (props, state) => {
    assert.equal(state, undefined);
    assert.equal(props.action, "/preferences");
    assert.equal(props.method, "post");
    assert.equal(props.onSubmit, formSubmit);
    return React.createElement("form", { ...props, "data-package-render": "true" });
  },
  style: { display: "block", width: "15rem" },
  validationBehavior: "aria",
  xstyle: formXstyle,
}, React.createElement("button", { type: "button" }, "Save locally")));
const formTag = formMarkup.match(/^<form[^>]*>/u)?.[0] ?? "";
assert.match(formTag, /accept-charset="utf-8"/u);
assert.match(formTag, /action="\/preferences"/u);
assert.match(formTag, /class="hraness-form [^"]*package-form-xstyle consumer-form"/u);
assert.match(formTag, /data-package-render="true"/u);
assert.match(formTag, /data-slot="form"/u);
assert.match(formTag, /method="post"/u);
assert.match(formTag, /novalidate=""/u);
assert.match(formTag, /style="display:block;width:15rem"/u);
for (const baseClass of formBaseClasses) {
  assert.ok(!formTag.split(/[\s"]/u).includes(baseClass), "Form xstyle must replace its package property class");
}
assert.match(formMarkup, /<button type="button">Save locally<\/button>/u);
const inheritedFormMarkup = renderToStaticMarkup(
  React.createElement(FormContext.Provider, {
    value: {
      className: "package-context-form",
      render: (props) => React.createElement("form", {
        ...props,
        "data-package-context-render": "true",
      }),
    },
  }, React.createElement(Form, {
    className: "consumer-context-form",
  }, React.createElement("button", { type: "button" }, "Save from context"))),
);
const inheritedFormTag = inheritedFormMarkup.match(/^<form[^>]*>/u)?.[0] ?? "";
assert.match(inheritedFormTag, /data-package-context-render="true"/u);
assert.match(
  inheritedFormTag,
  /class="package-context-form hraness-form [^"]+ consumer-context-form"/u,
);
assert.match(inheritedFormMarkup, /<button type="button">Save from context<\/button>/u);
const checkboxMarkup = renderToStaticMarkup(React.createElement(CheckboxField, {
  className: "consumer-checkbox",
  controlClassName: "consumer-checkbox-control",
  controlXstyle: checkboxControlXstyle,
  defaultSelected: true,
  description: "Package checkbox description",
  isInvalid: true,
  label: "Package checkbox",
  name: "package-checkbox",
  showLabel: false,
  style: { width: "15rem" },
  xstyle: checkboxRootXstyle,
}));
assert.match(checkboxMarkup, /^<div/u);
assert.match(checkboxMarkup, /class="hraness-checkbox-field [^"]+ consumer-checkbox"/u);
assert.match(checkboxMarkup, /data-slot="checkbox-field"/u);
assert.match(checkboxMarkup, /data-selected="true"/u);
assert.match(checkboxMarkup, /data-invalid="true"/u);
assert.match(checkboxMarkup, /<label[^>]*class="hraness-checkbox-field__control [^"]+ consumer-checkbox-control"/u);
const checkboxInputTags = [...checkboxMarkup.matchAll(/<input\b[^>]*>/gu)];
assert.equal(
  checkboxInputTags.length,
  1,
  "packed CheckboxField markup must contain exactly one input",
);
const checkboxInputTag = checkboxInputTags[0]?.[0] ?? "";
assert.match(checkboxInputTag, /(?:^|\s)type="checkbox"(?:\s|\/?>)/u);
assert.match(checkboxInputTag, /(?:^|\s)name="package-checkbox"(?:\s|\/?>)/u);
assert.match(checkboxMarkup, /hraness-checkbox-field__indicator/u);
assert.match(checkboxMarkup, /hraness-checkbox-field__label [^"]+ hraness-visually-hidden/u);
assert.match(checkboxMarkup, />Package checkbox<\/span>/u);
assert.match(checkboxMarkup, /Package checkbox description/u);
assert.match(checkboxMarkup, /style="width:15rem"/u);
const checkboxLabelTag = checkboxMarkup.match(/<span[^>]*data-slot="checkbox-label"[^>]*>/u)?.[0] ?? "";
const checkboxLabelClasses = checkboxLabelTag.match(/class="([^"]+)"/u)?.[1]?.split(" ") ?? [];
const checkboxHiddenIndex = checkboxLabelClasses.indexOf("hraness-visually-hidden");
assert.equal(checkboxLabelClasses[0], "hraness-checkbox-field__label");
assert.ok(checkboxHiddenIndex > 0, "packed CheckboxField must retain its stable hidden hook");
assert.ok(
  visuallyHiddenClasses.every(
    (className) => checkboxLabelClasses.indexOf(className) > checkboxHiddenIndex,
  ),
  "packed CheckboxField must retain every generated visually-hidden atom after the stable hook",
);
assert.doesNotMatch(checkboxLabelTag, /style=/u);
const checkboxRootTag = checkboxMarkup.match(/^<div[^>]*>/u)?.[0] ?? "";
const checkboxControlTag = checkboxMarkup.match(/<label[^>]*data-slot="checkbox-control"[^>]*>/u)?.[0] ?? "";
assert.match(
  checkboxRootTag,
  /class="hraness-checkbox-field [^"]*package-checkbox-root-xstyle consumer-checkbox"/u,
  "packed CheckboxField root xstyle must win before the caller class",
);
assert.match(
  checkboxControlTag,
  /class="hraness-checkbox-field__control [^"]*package-checkbox-control-xstyle consumer-checkbox-control"/u,
  "packed CheckboxField controlXstyle must win before the caller class",
);
for (const baseClass of checkboxRootBaseClasses) {
  assert.ok(!checkboxRootTag.split(/[\s"]/u).includes(baseClass), "root xstyle must replace its package property class");
}
for (const baseClass of checkboxControlBaseClasses) {
  assert.ok(!checkboxControlTag.split(/[\s"]/u).includes(baseClass), "controlXstyle must replace its package property class");
}

const pageMarkup = renderToStaticMarkup(React.createElement(QuietSitePage, {
  "aria-label": "Package page",
  className: "consumer-page",
  id: "package-page",
  style: { backgroundColor: "rgb(1, 2, 3)" },
}, "Page"));
assert.match(pageMarkup, /^<main/u);
assert.match(pageMarkup, /aria-label="Package page"/u);
assert.match(pageMarkup, /class="hraness-quiet-site-page [^"]+ consumer-page"/u);
assert.match(pageMarkup, /data-slot="quiet-site-page"/u);
assert.match(pageMarkup, /id="package-page"/u);
assert.match(pageMarkup, /style="background-color:rgb\(1, 2, 3\)"/u);

const footerMarkup = renderToStaticMarkup(React.createElement(QuietSiteFooter, {
  "aria-label": "Package footer",
  className: "consumer-footer",
  id: "package-footer",
  style: { paddingTop: "3rem" },
}, "Footer"));
assert.match(footerMarkup, /^<footer/u);
assert.match(footerMarkup, /aria-label="Package footer"/u);
assert.match(footerMarkup, /class="hraness-quiet-site-footer [^"]+ consumer-footer"/u);
assert.match(footerMarkup, /data-slot="quiet-site-footer"/u);
assert.match(footerMarkup, /id="package-footer"/u);
assert.match(footerMarkup, /style="padding-top:3rem"/u);

const frameMarkup = renderToStaticMarkup(React.createElement(ViewportFrame, {
  "aria-label": "Package viewport",
  as: "main",
  className: "consumer-frame",
  id: "package-frame",
  style: { backgroundColor: "rgb(4, 5, 6)" },
}, React.createElement("p", null, "Frame")));
assert.match(frameMarkup, /^<main/u);
assert.match(frameMarkup, /aria-label="Package viewport"/u);
assert.match(frameMarkup, /class="hraness-viewport-frame [^"]+ consumer-frame"/u);
assert.match(frameMarkup, /data-slot="viewport-frame"/u);
assert.match(frameMarkup, /id="package-frame"/u);
assert.match(frameMarkup, /style="background-color:rgb\(4, 5, 6\)"/u);
assert.match(frameMarkup, />Frame</u);

const rowMarkup = renderToStaticMarkup(React.createElement(WrappingRow, {
  "aria-label": "Package actions",
  as: "nav",
  className: "consumer-row",
  id: "package-row",
  style: { color: "rgb(7, 8, 9)" },
}, React.createElement("span", null, "Row")));
assert.match(rowMarkup, /^<nav/u);
assert.match(rowMarkup, /aria-label="Package actions"/u);
assert.match(rowMarkup, /class="hraness-wrapping-row [^"]+ consumer-row"/u);
assert.match(rowMarkup, /data-slot="wrapping-row"/u);
assert.match(rowMarkup, /id="package-row"/u);
assert.match(rowMarkup, /style="color:rgb\(7, 8, 9\)"/u);
assert.match(rowMarkup, />Row</u);

const surfaceMarkup = renderToStaticMarkup(React.createElement(ThemedSurface, {
  "aria-label": "Package preview",
  as: "article",
  className: "consumer-surface",
  id: "package-surface",
  shape: "rectangular",
  style: { backgroundPosition: "2px 3px" },
  tone: "inverse",
}, "Surface"));
assert.match(surfaceMarkup, /^<article/u);
assert.match(surfaceMarkup, /aria-label="Package preview"/u);
assert.match(surfaceMarkup, /class="hraness-themed-surface [^"]+ consumer-surface"/u);
assert.match(surfaceMarkup, /data-shape="rectangular"/u);
assert.match(surfaceMarkup, /data-slot="themed-surface"/u);
assert.match(surfaceMarkup, /data-tone="inverse"/u);
assert.match(surfaceMarkup, /id="package-surface"/u);
assert.match(surfaceMarkup, /style="background-position:2px 3px"/u);
assert.match(surfaceMarkup, />Surface</u);
`;
}

const typeScriptProbe = `import { Search01Icon } from "@hugeicons/core-free-icons";
import * as stylex from "@stylexjs/stylex";
import {
  AppearanceIcon,
  AskAiAboutThis,
  Avatar,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  CheckboxField,
  Form,
  Icon,
  KeyHint,
  Link,
  PressableCard,
  QuietSiteFooter,
  QuietSitePage,
  SocialIcon,
  StatusDot,
  Tag,
  ThemedSurface,
  Toolbar,
  ViewportFrame,
  WrappingRow,
  buildAskAiProviderLinks,
} from "@hraness/ui";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const styles = stylex.create({
  avatar: {
    backgroundColor: "var(--ui-accent)",
    borderRadius: "var(--radius-sm)",
    height: "3rem",
    width: "3rem",
  },
  avatarDynamic: (size: string) => ({ height: size, width: size }),
  card: {
    backgroundColor: "var(--ui-primary)",
    borderColor: "var(--ui-destructive)",
    borderRadius: "var(--radius-sm)",
    color: "var(--ui-primary-foreground)",
  },
  cardPart: {
    paddingInline: "var(--space-2)",
  },
  checkbox: {
    color: "var(--ui-primary)",
    display: "flex",
    gap: "var(--space-5)",
  },
  checkboxControl: {
    backgroundColor: "var(--ui-secondary)",
    gap: "var(--space-4)",
  },
  checkboxDynamic: (width: string) => ({ width }),
  checkboxControlDynamic: (height: string) => ({ minHeight: height }),
  form: {
    display: "flex",
    gap: "var(--space-2)",
    minWidth: "7rem",
  },
  formDynamic: (width: string) => ({ width }),
  camelInlineSize: { inlineSize: "100%" },
  camelMaxInlineSize: { maxInlineSize: "40rem" },
  camelMinInlineSize: { minInlineSize: 0 },
  icon: { display: "block" },
  keyHint: {
    backgroundColor: "var(--ui-secondary)",
    borderColor: "var(--ui-primary)",
    color: "var(--ui-secondary-foreground)",
    paddingInline: "var(--space-2)",
  },
  keyHintDynamic: (width: string) => ({ width }),
  link: {
    color: "var(--ui-secondary-foreground)",
    ":focus-visible": {
      outlineColor: "var(--ui-warning)",
      outlineWidth: "3px",
    },
    ":hover": {
      textDecorationThickness: "4px",
    },
  },
  dynamicPage: (inlineSize: string) => ({ "inline-size": inlineSize }),
  logicalPage: {
    "inline-size": "100%",
    "max-inline-size": "40rem",
    "min-inline-size": 0,
  },
  physicalPage: { maxWidth: "40rem", minWidth: 0, width: "100%" },
  statusDot: {
    backgroundColor: "var(--ui-primary)",
    height: "1rem",
    width: "1rem",
  },
  statusPill: {
    backgroundColor: "var(--ui-accent)",
    borderColor: "var(--ui-primary)",
    minHeight: "2rem",
  },
  surfaceTexture: {
    backgroundColor: "var(--ui-secondary)",
    backgroundImage: "repeating-linear-gradient(135deg, transparent 0 2px, currentColor 2px 3px)",
    backgroundPosition: "0 0",
    backgroundRepeat: "repeat",
    backgroundSize: "4px 4px",
    borderRadius: "var(--radius-sm)",
    color: "var(--ui-secondary-foreground)",
    paddingInline: "var(--space-2)",
  },
  toolbar: {
    backgroundColor: "var(--ui-secondary)",
    borderColor: "var(--ui-primary)",
    ":focus-visible": {
      outlineColor: "var(--ui-warning)",
      outlineOffset: "7px",
      outlineStyle: "dashed",
      outlineWidth: "4px",
    },
  },
  toolbarDynamic: (width: string) => ({ width }),
  wrapper: { display: "grid" },
});
const markup: string = renderToStaticMarkup(createElement(Icon, {
  className: "consumer-icon",
  icon: Search01Icon,
  size: 24,
  strokeWidth: 2,
  xstyle: styles.icon,
}));
const askAiLinks = buildAskAiProviderLinks("https://hraness.com/stripe");
const askAiRef = createRef<HTMLElement>();
const askAiMarkup: string = renderToStaticMarkup(createElement(AskAiAboutThis, {
  className: "consumer-ask-ai",
  ref: askAiRef,
  style: { marginTop: "1rem" },
  url: "https://hraness.com/stripe",
  xstyle: styles.wrapper,
}));
const socialMarkup: string = renderToStaticMarkup(createElement(SocialIcon, {
  className: "consumer-social-icon",
  name: "github",
  size: 24,
  xstyle: styles.wrapper,
}));
const appearanceMarkup: string = renderToStaticMarkup(createElement(AppearanceIcon, {
  className: "consumer-appearance-icon",
  name: "system",
  size: 26,
  xstyle: styles.wrapper,
}));
const avatarRef = createRef<HTMLSpanElement>();
const avatarMarkup: string = renderToStaticMarkup(createElement(Avatar, {
  alt: "Ada Lovelace avatar",
  className: "consumer-avatar",
  name: "Ada Lovelace",
  ref: avatarRef,
  size: "large",
  style: { height: "4rem", width: "4rem" },
  xstyle: [styles.avatar, styles.avatarDynamic("3.25rem")],
}));
const badgeRef = createRef<HTMLSpanElement>();
const badgeMarkup: string = renderToStaticMarkup(createElement(Badge, {
  children: "Ready",
  className: "consumer-badge",
  isLive: true,
  ref: badgeRef,
  style: { minHeight: "2.5rem" },
  tone: "success",
  xstyle: styles.statusPill,
}));
const tagRef = createRef<HTMLSpanElement>();
const tagMarkup: string = renderToStaticMarkup(createElement(Tag, {
  accentColor: "#D97706",
  children: "Project",
  className: "consumer-tag",
  icon: "◆",
  ref: tagRef,
  style: { minHeight: "2.5rem" },
  variant: "outline",
  xstyle: styles.statusPill,
}));
const dotRef = createRef<HTMLSpanElement>();
const dotMarkup: string = renderToStaticMarkup(createElement(StatusDot, {
  className: "consumer-dot",
  ref: dotRef,
  style: { height: "1.25rem", width: "1.25rem" },
  tone: "danger",
  xstyle: styles.statusDot,
}));
const cardRef = createRef<HTMLDivElement>();
const cardMarkup: string = renderToStaticMarkup(createElement(Card, {
  children: createElement(CardHeader, {
    children: [
      createElement(CardTitle, {
        children: "Project",
        key: "title",
        xstyle: styles.cardPart,
      }),
      createElement(CardDescription, {
        children: "Compiled card",
        key: "description",
        xstyle: styles.cardPart,
      }),
      createElement(CardContent, {
        children: "Ready",
        key: "content",
        xstyle: styles.cardPart,
      }),
      createElement(CardFooter, {
        children: "Footer",
        key: "footer",
        xstyle: styles.cardPart,
      }),
    ],
    xstyle: styles.cardPart,
  }),
  className: "consumer-card",
  ref: cardRef,
  shape: "rectangular",
  style: { borderRadius: "5px" },
  tone: "accent",
  xstyle: styles.card,
}));
const pressableRef = createRef<HTMLButtonElement>();
const pressableMarkup: string = renderToStaticMarkup(createElement(PressableCard, {
  buttonRef: pressableRef,
  children: ({ isPending }) => isPending ? "Pending" : "Open",
  className: "consumer-pressable",
  isPending: true,
  onPress: () => undefined,
  shape: "rounded",
  style: ({ isFocusVisible }) => ({
    outlineColor: isFocusVisible ? "red" : undefined,
    width: "8rem",
  }),
  tone: "inverse",
  xstyle: styles.card,
}));
const toolbarRef = createRef<HTMLDivElement>();
const toolbarMarkup: string = renderToStaticMarkup(createElement(Toolbar, {
  "aria-label": "Package editor actions",
  children: createElement("button", { type: "button" }, "Save"),
  className: "consumer-toolbar",
  orientation: "vertical",
  ref: toolbarRef,
  style: ({ orientation }) => ({ width: orientation === "vertical" ? "15rem" : "13rem" }),
  xstyle: [styles.toolbar, styles.toolbarDynamic("14rem")],
}));
const keyHintRef = createRef<HTMLElement>();
const keyHintMarkup: string = renderToStaticMarkup(createElement(KeyHint, {
  "aria-label": "Command K",
  children: "⌘K",
  className: "consumer-key-hint",
  ref: keyHintRef,
  style: { width: "3rem" },
  title: "Open command menu",
  xstyle: [styles.keyHint, styles.keyHintDynamic("2rem")],
}));
const linkRef = createRef<HTMLAnchorElement>();
const linkMarkup: string = renderToStaticMarkup(createElement(Link, {
  children: ({ isHovered }) => isHovered ? "Hovered reference" : "Reference",
  className: "consumer-link",
  href: "/reference",
  linkRef,
  style: ({ isFocusVisible }) => ({
    outlineOffset: isFocusVisible ? "5px" : "3px",
  }),
  xstyle: styles.link,
}));
const checkboxRef = createRef<HTMLDivElement>();
const checkboxMarkup: string = renderToStaticMarkup(createElement(CheckboxField, {
  className: "consumer-checkbox",
  controlClassName: "consumer-checkbox-control",
  controlXstyle: [styles.checkboxControl, styles.checkboxControlDynamic("3rem")],
  fieldRef: checkboxRef,
  label: "Package checkbox",
  name: "package-checkbox",
  showLabel: false,
  style: ({ isSelected }) => ({ width: isSelected ? "15rem" : "13rem" }),
  xstyle: [styles.checkbox, styles.checkboxDynamic("14rem")],
}));
const formRef = createRef<HTMLFormElement>();
const formMarkup: string = renderToStaticMarkup(createElement(Form, {
  acceptCharset: "utf-8",
  action: "/preferences",
  children: createElement("button", { type: "button" }, "Save locally"),
  className: "consumer-form",
  method: "post",
  onSubmit: (event) => event.preventDefault(),
  ref: formRef,
  render: (props, state) => createElement("form", {
    ...props,
    "data-custom-render": state === undefined ? "true" : "false",
  }),
  style: { display: "block", width: "15rem" },
  validationBehavior: "aria",
  xstyle: [styles.form, styles.formDynamic("14rem")],
}));
const pageRef = createRef<HTMLElement>();
const pageMarkup: string = renderToStaticMarkup(createElement(QuietSitePage, {
  "aria-label": "Package page",
  className: "consumer-page",
  children: "Page",
  id: "package-page",
  ref: pageRef,
  style: { inlineSize: "38rem" },
  xstyle: [styles.logicalPage, styles.dynamicPage("40rem")],
}));
const footerRef = createRef<HTMLElement>();
const footerMarkup: string = renderToStaticMarkup(createElement(QuietSiteFooter, {
  "aria-label": "Package footer",
  className: "consumer-footer",
  children: "Footer",
  id: "package-footer",
  ref: footerRef,
  style: { display: "block" },
  xstyle: [styles.wrapper, styles.physicalPage],
}));
const frameRef = createRef<HTMLElement>();
const frameMarkup: string = renderToStaticMarkup(createElement(ViewportFrame, {
  "aria-label": "Package viewport",
  as: "section",
  children: "Frame",
  className: "consumer-frame",
  ref: frameRef,
  style: { inlineSize: "38rem" },
  xstyle: [styles.logicalPage, styles.dynamicPage("40rem")],
}));
const rowRef = createRef<HTMLElement>();
const rowMarkup: string = renderToStaticMarkup(createElement(WrappingRow, {
  "aria-label": "Package actions",
  as: "nav",
  children: "Row",
  className: "consumer-row",
  ref: rowRef,
  style: { display: "block" },
  xstyle: [styles.wrapper, styles.physicalPage],
}));
const surfaceRef = createRef<HTMLElement>();
const surfaceMarkup: string = renderToStaticMarkup(createElement(ThemedSurface, {
  "aria-label": "Package preview",
  as: "article",
  children: "Surface",
  className: "consumer-surface",
  ref: surfaceRef,
  shape: "rectangular",
  style: { backgroundPosition: "2px 3px" },
  tone: "accent",
  xstyle: [styles.logicalPage, styles.surfaceTexture],
}));

// @ts-expect-error QuietSite rejects StyleX 0.19's physical inlineSize alias.
const camelInlineSizeMarkup = renderToStaticMarkup(createElement(QuietSitePage, { children: "Page", xstyle: styles.camelInlineSize }));
// @ts-expect-error QuietSite rejects StyleX 0.19's physical maxInlineSize alias.
const camelMaxInlineSizeMarkup = renderToStaticMarkup(createElement(QuietSitePage, { children: "Page", xstyle: styles.camelMaxInlineSize }));
// @ts-expect-error QuietSite rejects StyleX 0.19's physical minInlineSize alias.
const camelMinInlineSizeMarkup = renderToStaticMarkup(createElement(QuietSitePage, { children: "Page", xstyle: styles.camelMinInlineSize }));
// @ts-expect-error ViewportFrame rejects StyleX 0.19's physical inlineSize alias.
const frameCamelInlineSizeMarkup = renderToStaticMarkup(createElement(ViewportFrame, { xstyle: styles.camelInlineSize }));
// @ts-expect-error WrappingRow rejects StyleX 0.19's physical maxInlineSize alias.
const rowCamelMaxInlineSizeMarkup = renderToStaticMarkup(createElement(WrappingRow, { xstyle: styles.camelMaxInlineSize }));
// @ts-expect-error WrappingRow rejects StyleX 0.19's physical minInlineSize alias.
const rowCamelMinInlineSizeMarkup = renderToStaticMarkup(createElement(WrappingRow, { xstyle: styles.camelMinInlineSize }));
// @ts-expect-error ThemedSurface rejects StyleX 0.19's physical inlineSize alias.
const surfaceCamelInlineSizeMarkup = renderToStaticMarkup(createElement(ThemedSurface, { xstyle: styles.camelInlineSize }));
// @ts-expect-error ViewportFrame keeps its polymorphic elements finite.
const invalidFrameElementMarkup = renderToStaticMarkup(createElement(ViewportFrame, { as: "article" }));
// @ts-expect-error WrappingRow keeps its polymorphic elements finite.
const invalidRowElementMarkup = renderToStaticMarkup(createElement(WrappingRow, { as: "article" }));
// @ts-expect-error ThemedSurface keeps its polymorphic elements finite.
const invalidSurfaceElementMarkup = renderToStaticMarkup(createElement(ThemedSurface, { as: "main" }));
// @ts-expect-error ThemedSurface keeps its tone set finite.
const invalidSurfaceToneMarkup = renderToStaticMarkup(createElement(ThemedSurface, { tone: "warning" }));
// @ts-expect-error ThemedSurface keeps its shape set finite.
const invalidSurfaceShapeMarkup = renderToStaticMarkup(createElement(ThemedSurface, { shape: "pill" }));
// @ts-expect-error Avatar keeps its size set finite.
const invalidAvatarSizeMarkup = renderToStaticMarkup(createElement(Avatar, { name: "Ada", size: "medium" }));
// @ts-expect-error Badge keeps its tone set finite.
const invalidBadgeToneMarkup = renderToStaticMarkup(createElement(Badge, { children: "Badge", tone: "primary" }));
// @ts-expect-error StatusDot keeps its tone set finite.
const invalidDotToneMarkup = renderToStaticMarkup(createElement(StatusDot, { tone: "primary" }));
// @ts-expect-error Tag keeps its variant set finite.
const invalidTagVariantMarkup = renderToStaticMarkup(createElement(Tag, { children: "Tag", variant: "primary" }));
// @ts-expect-error accentColor is available only for outline Tags.
const invalidTagAccentMarkup = renderToStaticMarkup(createElement(Tag, { accentColor: "red", children: "Tag", variant: "muted" }));
// @ts-expect-error Card keeps its tone set finite.
const invalidCardToneMarkup = renderToStaticMarkup(createElement(Card, { tone: "popover" }));
// @ts-expect-error Card keeps its shape set finite.
const invalidCardShapeMarkup = renderToStaticMarkup(createElement(Card, { shape: "pill" }));
// @ts-expect-error PressableCard keeps className static for stable semantic composition.
const invalidPressableClassMarkup = renderToStaticMarkup(createElement(PressableCard, { children: "Open", className: () => "dynamic" }));
// @ts-expect-error Toolbar requires exactly one accessible naming method.
const unnamedToolbarMarkup = renderToStaticMarkup(createElement(Toolbar, { children: "Commands" }));
// @ts-expect-error Toolbar rejects competing accessible naming methods.
const multiplyNamedToolbarMarkup = renderToStaticMarkup(createElement(Toolbar, { "aria-label": "Commands", "aria-labelledby": "commands", children: "Commands" }));
// @ts-expect-error Toolbar keeps className static for stable semantic composition.
const invalidToolbarClassMarkup = renderToStaticMarkup(createElement(Toolbar, { "aria-label": "Commands", className: () => "dynamic" }));
// @ts-expect-error Link requires an explicit href.
const missingLinkHrefMarkup = renderToStaticMarkup(createElement(Link, { children: "Reference" }));
// @ts-expect-error Link keeps className static for stable semantic composition.
const invalidLinkClassMarkup = renderToStaticMarkup(createElement(Link, { children: "Reference", className: () => "dynamic", href: "/reference" }));
// @ts-expect-error Link accepts compiled StyleX values rather than raw style objects.
const invalidLinkXstyleMarkup = renderToStaticMarkup(createElement(Link, { children: "Reference", href: "/reference", xstyle: { color: "red" } }));
// @ts-expect-error AskAiAboutThis requires one explicit canonical HTTPS URL.
const missingAskAiUrlMarkup = renderToStaticMarkup(createElement(AskAiAboutThis, {}));
// @ts-expect-error CheckboxField requires a label even when visible copy is hidden.
const unnamedCheckboxMarkup = renderToStaticMarkup(createElement(CheckboxField, { showLabel: false }));
// @ts-expect-error CheckboxField has one stable target size and no compact API.
const compactCheckboxMarkup = renderToStaticMarkup(createElement(CheckboxField, { compact: true, label: "Compact" }));
// @ts-expect-error Form accepts compiled StyleX recipes rather than raw CSS objects.
const invalidFormXstyleMarkup = renderToStaticMarkup(createElement(Form, { xstyle: { display: "flex" } }));

void markup;
void askAiLinks;
void askAiMarkup;
void socialMarkup;
void appearanceMarkup;
void avatarMarkup;
void badgeMarkup;
void tagMarkup;
void dotMarkup;
void cardMarkup;
void pressableMarkup;
void toolbarMarkup;
void keyHintMarkup;
void linkMarkup;
void checkboxMarkup;
void formMarkup;
void pageMarkup;
void footerMarkup;
void frameMarkup;
void rowMarkup;
void surfaceMarkup;
void camelInlineSizeMarkup;
void camelMaxInlineSizeMarkup;
void camelMinInlineSizeMarkup;
void frameCamelInlineSizeMarkup;
void rowCamelMaxInlineSizeMarkup;
void rowCamelMinInlineSizeMarkup;
void surfaceCamelInlineSizeMarkup;
void invalidFrameElementMarkup;
void invalidRowElementMarkup;
void invalidSurfaceElementMarkup;
void invalidSurfaceToneMarkup;
void invalidSurfaceShapeMarkup;
void invalidAvatarSizeMarkup;
void invalidBadgeToneMarkup;
void invalidDotToneMarkup;
void invalidTagVariantMarkup;
void invalidTagAccentMarkup;
void invalidCardToneMarkup;
void invalidCardShapeMarkup;
void invalidPressableClassMarkup;
void unnamedToolbarMarkup;
void multiplyNamedToolbarMarkup;
void invalidToolbarClassMarkup;
void missingLinkHrefMarkup;
void invalidLinkClassMarkup;
void invalidLinkXstyleMarkup;
void missingAskAiUrlMarkup;
void unnamedCheckboxMarkup;
void compactCheckboxMarkup;
void invalidFormXstyleMarkup;
`;

const viteClient = `import "@hraness/ui/styles.css";
import { AskAiAboutThis, Card, CardDescription, CheckboxField, Form, KeyHint, Link, PressableCard, Toolbar } from "@hraness/ui";
import * as React from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (root === null) throw new Error("Vite package smoke root is missing");
createRoot(root).render(React.createElement(React.Fragment, null,
  React.createElement(Card, { tone: "accent" },
    React.createElement(CardDescription, null, "Vite card"),
  ),
  React.createElement(PressableCard, {
    onPress: () => undefined,
    tone: "inverse",
  }, "Vite pressable card"),
  React.createElement(Toolbar, {
    "aria-label": "Vite editor actions",
    orientation: "vertical",
  }, React.createElement("button", { type: "button" }, "Save")),
  React.createElement(KeyHint, null, "⌘K"),
  React.createElement(AskAiAboutThis, { url: "https://hraness.com/stripe" }),
  React.createElement(Link, { href: "/reference" }, "Reference"),
  React.createElement(CheckboxField, {
    label: "Vite checkbox",
    name: "vite-checkbox",
    showLabel: false,
  }),
  React.createElement(Form, {
    action: "/preferences",
    method: "post",
    onSubmit: (event) => event.preventDefault(),
  }, React.createElement("button", { type: "button" }, "Save locally")),
));
`;

function viteSsrProbe(
  checkboxProbe: CheckboxPrecedenceProbe,
  formProbe: FormPrecedenceProbe,
  linkProbe: LinkPrecedenceProbe,
  visuallyHiddenClasses: readonly string[],
): string {
  return `import assert from "node:assert/strict";
import { CheckboxField, Form, Link } from "@hraness/ui";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const rootXstyle = {
  ${JSON.stringify(checkboxProbe.rootProperty)}: "vite-checkbox-root-xstyle",
  $$css: true,
};
const controlXstyle = {
  ${JSON.stringify(checkboxProbe.controlProperty)}: "vite-checkbox-control-xstyle",
  $$css: true,
};
const formXstyle = {
  ${JSON.stringify(formProbe.property)}: "vite-form-xstyle",
  $$css: true,
};
const linkXstyle = {
  ${JSON.stringify(linkProbe.property)}: "vite-link-xstyle",
  $$css: true,
};
const markup = renderToStaticMarkup(React.createElement(CheckboxField, {
  className: "vite-checkbox-root-class",
  controlClassName: "vite-checkbox-control-class",
  controlXstyle,
  label: "Vite runtime checkbox",
  name: "vite-runtime-checkbox",
  showLabel: false,
  xstyle: rootXstyle,
}));
const rootTag = markup.match(/^<div[^>]*>/u)?.[0] ?? "";
const controlTag = markup.match(/<label[^>]*data-slot="checkbox-control"[^>]*>/u)?.[0] ?? "";
const labelTag = markup.match(/<span[^>]*data-slot="checkbox-label"[^>]*>/u)?.[0] ?? "";
const labelClasses = labelTag.match(/class="([^"]+)"/u)?.[1]?.split(" ") ?? [];
const hiddenIndex = labelClasses.indexOf("hraness-visually-hidden");
assert.equal(labelClasses[0], "hraness-checkbox-field__label");
assert.ok(hiddenIndex > 0);
assert.ok(${JSON.stringify(visuallyHiddenClasses)}.every(
  (className) => labelClasses.indexOf(className) > hiddenIndex,
));
assert.doesNotMatch(labelTag, /style=/u);
assert.match(rootTag, /class="hraness-checkbox-field [^"]*vite-checkbox-root-xstyle vite-checkbox-root-class"/u);
assert.match(controlTag, /class="hraness-checkbox-field__control [^"]*vite-checkbox-control-xstyle vite-checkbox-control-class"/u);
for (const baseClass of ${JSON.stringify(checkboxProbe.rootBaseClasses)}) {
  assert.ok(!rootTag.split(/[\\s"]/u).includes(baseClass));
}
for (const baseClass of ${JSON.stringify(checkboxProbe.controlBaseClasses)}) {
  assert.ok(!controlTag.split(/[\\s"]/u).includes(baseClass));
}
const formMarkup = renderToStaticMarkup(React.createElement(Form, {
  action: "/preferences",
  className: "vite-form-class",
  method: "post",
  style: { display: "block" },
  validationBehavior: "aria",
  xstyle: formXstyle,
}, React.createElement("button", { type: "button" }, "Save locally")));
const formTag = formMarkup.match(/^<form[^>]*>/u)?.[0] ?? "";
assert.match(formTag, /action="\\/preferences"/u);
assert.match(formTag, /class="hraness-form [^"]*vite-form-xstyle vite-form-class"/u);
assert.match(formTag, /data-slot="form"/u);
assert.match(formTag, /method="post"/u);
assert.match(formTag, /novalidate=""/u);
assert.match(formTag, /style="display:block"/u);
for (const baseClass of ${JSON.stringify(formProbe.baseClasses)}) {
  assert.ok(!formTag.split(/[\\s"]/u).includes(baseClass));
}
const linkMarkup = renderToStaticMarkup(React.createElement(Link, {
  className: "vite-link-class",
  href: "/reference",
  xstyle: linkXstyle,
}, "Reference"));
const linkTag = linkMarkup.match(/^<a[^>]*>/u)?.[0] ?? "";
assert.match(linkTag, /class="hraness-link [^"]*vite-link-xstyle vite-link-class"/u);
for (const baseClass of ${JSON.stringify(linkProbe.baseClasses)}) {
  assert.ok(!linkTag.split(/[\\s"]/u).includes(baseClass));
}
console.log("Vite CheckboxField, Form, and Link xstyle runtime passed");
`;
}

const viteHtml = `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8"><title>Vite package smoke</title></head>
  <body><div id="root"></div><script type="module" src="/vite-client.ts"></script></body>
</html>
`;

const viteConfig = `import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: "vite-dist",
  },
  ssr: {
    noExternal: ["@hraness/ui", "@stylexjs/stylex"],
  },
});
`;

function typeScriptConfig(moduleResolution: "Bundler" | "NodeNext") {
  return {
    compilerOptions: {
      target: "ES2023",
      lib: ["ES2023", "DOM", "DOM.Iterable"],
      jsx: "react-jsx",
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      module: moduleResolution === "Bundler" ? "Preserve" : "NodeNext",
      moduleResolution,
    },
    include: ["index.ts"],
  };
}

async function verifyConsumer(
  archive: string,
  consumer: string,
  nodeExecutable: string,
  release: ReactRelease,
): Promise<void> {
  await mkdir(consumer);
  await writeFile(join(consumer, "package.json"), `${JSON.stringify({
    name: `hraness-package-smoke-${release.label}`,
    private: true,
    type: "module",
  }, null, 2)}\n`);
  await run([
    process.execPath,
    "add",
    archive,
    "@hugeicons/core-free-icons@^4.2.2",
    "@stylexjs/stylex@0.19.0",
    `@types/react@${release.reactTypes}`,
    `@types/react-dom@${release.reactDomTypes}`,
    `react@${release.version}`,
    `react-dom@${release.version}`,
    "typescript@^6.0.3",
    "vite@^7.0.0",
    "--ignore-scripts",
  ], consumer);
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "quiet-site.stylex.ts"),
  );
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "avatar.stylex.ts"),
  );
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "card.stylex.ts"),
  );
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "status.stylex.ts"),
  );
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "surfaces.stylex.ts"),
  );
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "toolbar.stylex.ts"),
  );
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "key-hint.stylex.ts"),
  );
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "checkbox-field.stylex.ts"),
  );
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "visually-hidden.stylex.ts"),
  );
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "actions.stylex.ts"),
  );
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "form.stylex.ts"),
  );
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "lib", "stylex.ts"),
  );
  const installedPackageRoot = join(
    consumer,
    "node_modules",
    "@hraness",
    "ui",
  );
  const [installedJavaScript, installedStylexCss] = await Promise.all([
    readFile(join(installedPackageRoot, "dist", "index.js"), "utf8"),
    readFile(join(installedPackageRoot, "dist", "stylex.css"), "utf8"),
  ]);
  const checkboxProbe = packageCheckboxStyleMap(installedJavaScript);
  const formProbe = packageFormStyleMap(installedJavaScript, installedStylexCss);
  const linkProbe = packageLinkStyleMap(installedJavaScript);
  requirePackageCheckboxStyles(installedJavaScript, installedStylexCss);
  requirePackageLinkStyles(installedJavaScript, installedStylexCss);
  const visuallyHiddenClasses = requirePackageVisuallyHiddenStyles(
    installedJavaScript,
    installedStylexCss,
  );
  requirePackageFormStyles(installedJavaScript, installedStylexCss);

  // A restored package-manager cache can retain this valid duplicate topology.
  // Public source types must remain portable when React Aria resolves through it.
  const nestedReactAriaModules = join(
    consumer,
    "node_modules",
    "react-aria",
    "node_modules",
  );
  await mkdir(nestedReactAriaModules, { recursive: true });
  await cp(
    join(consumer, "node_modules", "react-stately"),
    join(nestedReactAriaModules, "react-stately"),
    { recursive: true },
  );

  await writeFile(
    join(consumer, "ssr.mjs"),
    ssrProbe(
      release,
      checkboxProbe,
      formProbe,
      linkProbe,
      visuallyHiddenClasses,
    ),
  );
  await run([nodeExecutable, "./ssr.mjs"], consumer);

  await writeFile(join(consumer, "index.ts"), typeScriptProbe);
  for (const moduleResolution of ["Bundler", "NodeNext"] as const) {
    const configName = `tsconfig.${moduleResolution.toLowerCase()}.json`;
    await writeFile(
      join(consumer, configName),
      `${JSON.stringify(typeScriptConfig(moduleResolution), null, 2)}\n`,
    );
    await run([process.execPath, "x", "tsc", "-p", `./${configName}`], consumer);
  }

  await Promise.all([
    writeFile(join(consumer, "index.html"), viteHtml),
    writeFile(join(consumer, "vite-client.ts"), viteClient),
    writeFile(
      join(consumer, "vite-ssr.ts"),
      viteSsrProbe(
        checkboxProbe,
        formProbe,
        linkProbe,
        visuallyHiddenClasses,
      ),
    ),
    writeFile(join(consumer, "vite.config.ts"), viteConfig),
  ]);
  await run([
    process.execPath,
    "x",
    "vite",
    "build",
    "--config",
    "./vite.config.ts",
  ], consumer);
  const viteAssets = await readdir(join(consumer, "vite-dist", "assets"));
  const viteJavaScriptPath = viteAssets.find((file) => file.endsWith(".js"));
  const viteCssPath = viteAssets.find((file) => file.endsWith(".css"));
  assert.ok(viteJavaScriptPath !== undefined, "Vite must emit package JavaScript");
  assert.ok(viteCssPath !== undefined, "Vite must emit the package stylesheet");
  const [viteJavaScript, viteCss] = await Promise.all([
    readFile(join(consumer, "vite-dist", "assets", viteJavaScriptPath), "utf8"),
    readFile(join(consumer, "vite-dist", "assets", viteCssPath), "utf8"),
  ]);
  requirePackageCheckboxStyles(viteJavaScript, viteCss);
  requirePackageLinkStyles(viteJavaScript, viteCss);
  requirePackageFormStyles(viteJavaScript, viteCss);
  requirePackageVisuallyHiddenStyles(viteJavaScript, viteCss);
  assert.match(viteJavaScript, /hraness-pressable-card/u);
  assert.match(viteJavaScript, /hraness-toolbar/u);
  assert.match(viteJavaScript, /hraness-key-hint/u);
  assert.match(viteJavaScript, /hraness-link/u);
  assert.match(viteJavaScript, /hraness-form/u);
  assert.match(viteJavaScript, /--_hraness-card-description/u);
  assert.match(viteCss, /color:var\(--hraness-card-description\)/u);
  assert.match(viteCss, /:hover\{/u);
  assert.match(viteCss, /outline-offset:2px/u);
  assert.match(viteCss, /border-block-end-width:2px/u);
  assert.match(viteCss, /min-block-size:1\.5rem/u);
  assert.match(viteCss, /min-inline-size:1\.5rem/u);
  const viteCssWithoutCardBridge = viteCss.replace(
    /:where\(\s*\.hraness-card\s*,\s*\.hraness-pressable-card\s*\)\s*\{\s*--hraness-card-description\s*:\s*var\(--_hraness-card-description\)\s*;?\s*\}/gu,
    "",
  );
  assert.equal(
    viteCss.match(
      /:where\(\s*\.hraness-card\s*,\s*\.hraness-pressable-card\s*\)\s*\{\s*--hraness-card-description\s*:\s*var\(--_hraness-card-description\)\s*;?\s*\}/gu,
    )?.length,
    1,
    "Vite must preserve the single Card description compatibility bridge",
  );
  assert.doesNotMatch(
    viteCssWithoutCardBridge,
    /\.hraness-(?:card(?:__(?:header|title|description|content|footer))?|pressable-card)(?![A-Za-z0-9_-])/u,
  );
  assert.doesNotMatch(viteCss, /\.hraness-toolbar(?![A-Za-z0-9_-])/u);
  assert.doesNotMatch(viteCss, /\.hraness-key-hint(?![A-Za-z0-9_-])/u);
  assert.doesNotMatch(viteCss, /\.hraness-link(?![A-Za-z0-9_-])/u);
  assert.doesNotMatch(viteCss, /\.hraness-visually-hidden(?![A-Za-z0-9_-])/u);
  assert.doesNotMatch(viteCss, /\.hraness-form(?![A-Za-z0-9_-])/u);

  await run([
    process.execPath,
    "x",
    "vite",
    "build",
    "--config",
    "./vite.config.ts",
    "--outDir",
    "vite-ssr-dist",
    "--ssr",
    "./vite-ssr.ts",
  ], consumer);
  const viteSsrFiles = await readdir(join(consumer, "vite-ssr-dist"));
  const viteSsrJavaScript = viteSsrFiles.find(
    (file) => file.endsWith(".js") || file.endsWith(".mjs"),
  );
  assert.ok(viteSsrJavaScript !== undefined, "Vite SSR must emit package JavaScript");
  const viteSsrBundle = await readFile(
    join(consumer, "vite-ssr-dist", viteSsrJavaScript),
    "utf8",
  );
  assert.match(
    viteSsrBundle,
    /hraness-checkbox-field/u,
    "Vite SSR must bundle the CheckboxField implementation",
  );
  assert.match(
    viteSsrBundle,
    /vite-checkbox-root-xstyle/u,
    "Vite SSR must bundle the caller root xstyle probe",
  );
  assert.match(
    viteSsrBundle,
    /vite-checkbox-control-xstyle/u,
    "Vite SSR must bundle the caller controlXstyle probe",
  );
  assert.match(
    viteSsrBundle,
    /hraness-link/u,
    "Vite SSR must bundle the Link implementation",
  );
  assert.match(
    viteSsrBundle,
    /vite-link-xstyle/u,
    "Vite SSR must bundle the caller Link xstyle probe",
  );
  assert.match(
    viteSsrBundle,
    /hraness-form/u,
    "Vite SSR must bundle the Form implementation",
  );
  assert.match(
    viteSsrBundle,
    /vite-form-xstyle/u,
    "Vite SSR must bundle the caller Form xstyle probe",
  );
  assert.doesNotMatch(
    viteSsrBundle,
    /from\s*["']@hraness\/ui["']/u,
    "Vite SSR must not leave @hraness/ui external",
  );
  await run([
    nodeExecutable,
    join(consumer, "vite-ssr-dist", viteSsrJavaScript),
  ], consumer);
}

const repository = process.cwd();
const work = await mkdtemp(join(tmpdir(), "hraness-package-smoke-"));
const temporary = join(work, "tmp");
const environment = {
  ...process.env,
  BUN_TMPDIR: temporary,
  TMPDIR: temporary,
};
try {
  const archive = join(work, "package.tgz");
  await mkdir(temporary, { mode: 0o700 });
  const nodeExecutable = resolveGenuineNodeExecutable();
  await run([
    process.execPath,
    "pm",
    "pack",
    "--filename",
    archive,
    "--ignore-scripts",
    "--quiet",
  ], repository);

  for (const release of reactReleases) {
    await verifyConsumer(
      archive,
      join(work, release.label),
      nodeExecutable,
      release,
    );
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
