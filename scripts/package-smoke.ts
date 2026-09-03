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
const PACKAGE_DATA_TABLE_STYLE_KEYS = [
  "alignCenter",
  "alignEnd",
  "alignStart",
  "caption",
  "cell",
  "empty",
  "header",
  "table",
  "wrapper",
] as const;
type PackageDataTableStyleKey = (typeof PACKAGE_DATA_TABLE_STYLE_KEYS)[number];
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

interface PackageFieldSelectProbe {
  readonly fieldControlBaseClasses: readonly string[];
  readonly fieldControlProperty: string;
  readonly fieldOptionsBaseClasses: readonly string[];
  readonly fieldOptionsProperty: string;
  readonly fieldRootBaseClasses: readonly string[];
  readonly fieldRootProperty: string;
  readonly fieldTextAreaBaseClasses: readonly string[];
  readonly fieldTextAreaProperty: string;
  readonly radioSwitchNativeFocusClasses: readonly string[];
  readonly selectNativeInteractionClasses: readonly string[];
  readonly selectTriggerBaseClasses: readonly string[];
  readonly selectTriggerProperty: string;
}

interface PackageIndicatorKnobProbe {
  readonly indicatorRootBaseClasses: readonly string[];
  readonly indicatorRootProperty: string;
  readonly knobControlBaseClasses: readonly string[];
  readonly knobControlNativeFocusClasses: readonly string[];
  readonly knobControlProperty: string;
  readonly knobRootBaseClasses: readonly string[];
  readonly knobRootProperty: string;
}

interface ContentPrecedenceProbe {
  readonly rootBaseClasses: readonly string[];
  readonly rootProperty: string;
}

interface PackageDataTableProbe {
  readonly classNamesByKey: Readonly<
    Record<PackageDataTableStyleKey, readonly string[]>
  >;
  readonly tableBaseClasses: readonly string[];
  readonly tableProperty: string;
  readonly wrapperBaseClasses: readonly string[];
  readonly wrapperProperty: string;
}

interface PackageNamedStyleMap {
  readonly classNames: ReadonlySet<string>;
  readonly entries: ReadonlyMap<string, string>;
  readonly object: string;
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

function packageNamedStyleMap(
  javaScript: string,
  requiredKeys: readonly string[],
  description: string,
): PackageNamedStyleMap {
  const candidates: PackageNamedStyleMap[] = [];
  for (const match of javaScript.matchAll(
    /(?:\b(?:const|let|var)\s+|[;,])([A-Za-z_$][\w$]*)\s*=\s*\{/gu,
  )) {
    const open = (match.index ?? 0) + match[0].lastIndexOf("{");
    const object = balancedBlock(javaScript, open, `packed ${description}`);
    const body = object.slice(1, -1);
    const entries = new Map<string, string>();
    for (const key of requiredKeys) {
      const keyMatch = new RegExp(
        `(?:^|,)\\s*${key}\\s*:\\s*\\{`,
        "u",
      ).exec(body);
      if (keyMatch === null) break;
      const keyOpen = (keyMatch.index ?? 0) + keyMatch[0].lastIndexOf("{");
      entries.set(key, balancedBlock(body, keyOpen, `packed ${description}.${key}`));
    }
    if (entries.size !== requiredKeys.length) continue;
    const classNames = new Set<string>();
    for (const classMatch of object.matchAll(
      /["']((?:x[A-Za-z0-9_-]+)(?:\s+x[A-Za-z0-9_-]+)*)["']/gu,
    )) {
      for (const className of classMatch[1]!.split(/\s+/u)) classNames.add(className);
    }
    if (classNames.size === 0) continue;
    candidates.push({ classNames, entries, object });
  }
  assert.equal(
    candidates.length,
    1,
    `packed JavaScript must contain exactly one compiled ${description}`,
  );
  return candidates[0]!;
}

function packageTopLevelStyleKeys(
  object: string,
  description: string,
): readonly string[] {
  const keys: string[] = [];
  let index = 1;
  while (index < object.length - 1) {
    while (/[,\s]/u.test(object[index] ?? "")) index += 1;
    if (index >= object.length - 1) break;
    const key = /^[A-Za-z_$][\w$]*/u.exec(object.slice(index))?.[0];
    assert.ok(key !== undefined, `${description} contains a non-identifier key`);
    index += key.length;
    while (/\s/u.test(object[index] ?? "")) index += 1;
    assert.equal(object[index], ":", `${description}.${key} is missing its colon`);
    index += 1;
    while (/\s/u.test(object[index] ?? "")) index += 1;
    assert.equal(object[index], "{", `${description}.${key} must remain an object entry`);
    const entry = balancedBlock(object, index, `${description}.${key}`);
    keys.push(key);
    index += entry.length;
  }
  return keys;
}

function packageEntryProbe(entry: string, description: string): Readonly<{
  baseClasses: readonly string[];
  property: string;
}> {
  const declaration = [...entry.matchAll(
    /([A-Za-z_$][\w$]*)\s*:\s*["']((?:x[A-Za-z0-9_-]+)(?:\s+x[A-Za-z0-9_-]+)*)["']/gu,
  )][0];
  assert.ok(declaration !== undefined, `${description} has no compiled class property`);
  return {
    baseClasses: declaration[2]!.split(/\s+/u),
    property: declaration[1]!,
  };
}

const PACKAGE_FIELD_STYLE_KEYS = [
  "control",
  "controlCompact",
  "controlDefault",
  "controlFocusWithinFallback",
  "controlInvalid",
  "controlLarge",
  "inputCompact",
  "inputDefault",
  "inputLarge",
  "nativeSelect",
  "numberControl",
  "numberControlCompact",
  "numberControlDefault",
  "numberControlLarge",
  "numberStepFocusVisible",
  "numberStepNativeInteractions",
  "radioDot",
  "radioIndicator",
  "radioIndicatorInvalid",
  "radioIndicatorSelected",
  "radioSwitchControl",
  "radioSwitchFocusVisible",
  "radioSwitchNativeFocus",
  "root",
  "searchClearCompact",
  "searchClearDefault",
  "searchClearLarge",
  "searchClearFocusVisible",
  "searchClearNativeInteractions",
  "switchThumb",
  "switchThumbSelected",
  "switchTrack",
  "switchTrackInvalid",
  "switchTrackSelected",
] as const;
const PACKAGE_SELECT_STYLE_KEYS = [
  "option",
  "optionFocused",
  "optionNativeInteraction",
  "popoverEntering",
  "popoverExiting",
  "trigger",
  "triggerCompact",
  "triggerDefault",
  "triggerFocusVisible",
  "triggerHovered",
  "triggerInvalid",
  "triggerLarge",
  "triggerNativeInteractions",
] as const;
const PACKAGE_INDICATOR_STYLE_KEYS = [
  "fill",
  "indeterminateFill",
  "label",
  "labelRow",
  "meterDanger",
  "meterSuccess",
  "meterWarning",
  "root",
  "sliderFill",
  "sliderRootVertical",
  "sliderThumb",
  "sliderThumbFocusVisible",
  "sliderThumbIndicator",
  "sliderThumbHorizontal",
  "sliderThumbNativeFocusFallback",
  "sliderThumbVertical",
  "sliderTrack",
  "sliderTrackVertical",
  "track",
  "value",
] as const;
const PACKAGE_KNOB_STYLE_KEYS = [
  "arc",
  "arcTrack",
  "arcValue",
  "control",
  "controlDisabled",
  "controlDragging",
  "controlHorizontalTouchPan",
  "controlNativeFocus",
  "dial",
  "dialCompact",
  "face",
  "gesture",
  "gestureDisabled",
  "gestureHorizontalTouchPan",
  "indicator",
  "label",
  "labelValue",
  "root",
  "thumb",
  "value",
] as const;
const PACKAGE_CONTENT_STYLE_KEYS = [
  "actions",
  "emptyStateDescription",
  "emptyStateIcon",
  "emptyStateRoot",
  "emptyStateTitle",
  "inlineAlertBody",
  "inlineAlertContent",
  "inlineAlertDanger",
  "inlineAlertIcon",
  "inlineAlertInfo",
  "inlineAlertRoot",
  "inlineAlertSuccess",
  "inlineAlertTitle",
  "inlineAlertWarning",
  "pageIntroCopy",
  "pageIntroDescription",
  "pageIntroEyebrow",
  "pageIntroRoot",
  "pageIntroTitle",
  "settingsCardBody",
  "settingsCardDescription",
  "settingsCardHeader",
  "settingsCardRectangular",
  "settingsCardRoot",
  "settingsCardTitle",
] as const;

const PACKAGE_DATA_TABLE_DECLARATIONS: Readonly<
  Record<
    PackageDataTableStyleKey,
    readonly Readonly<{ declaration: RegExp; description: string }>[]
  >
> = {
  alignCenter: [
    { declaration: /text-align:\s*center;/u, description: "center alignment" },
  ],
  alignEnd: [
    { declaration: /text-align:\s*end;/u, description: "logical end alignment" },
  ],
  alignStart: [
    { declaration: /text-align:\s*start;/u, description: "logical start alignment" },
  ],
  caption: [
    {
      declaration: /color:\s*var\(--ui-muted-foreground\);/u,
      description: "caption foreground",
    },
    {
      declaration: /padding-block:\s*var\(--space-3\);/u,
      description: "caption block padding",
    },
    {
      declaration: /padding-inline:\s*var\(--space-4\);/u,
      description: "caption inline padding",
    },
    { declaration: /text-align:\s*start;/u, description: "caption alignment" },
  ],
  cell: [
    {
      declaration: /border-block-end-color:\s*var\(--ui-border\);/u,
      description: "logical cell divider color",
    },
    {
      declaration: /border-block-end-style:\s*solid;/u,
      description: "logical cell divider style",
    },
    {
      declaration: /border-block-end-width:\s*1px;/u,
      description: "logical cell divider width",
    },
    {
      declaration: /padding-block:\s*var\(--space-3\);/u,
      description: "cell block padding",
    },
    {
      declaration: /padding-inline:\s*var\(--space-4\);/u,
      description: "cell inline padding",
    },
    { declaration: /vertical-align:\s*top;/u, description: "cell vertical alignment" },
  ],
  empty: [
    {
      declaration: /color:\s*var\(--ui-muted-foreground\);/u,
      description: "empty-state foreground",
    },
    { declaration: /height:\s*6rem;/u, description: "empty-state height" },
    {
      declaration: /text-align:\s*center\s*!important;/u,
      description: "important empty-state centering",
    },
  ],
  header: [
    {
      declaration: /background-attachment:\s*scroll;/u,
      description: "header background attachment reset",
    },
    {
      declaration: /background-clip:\s*border-box;/u,
      description: "header background clip reset",
    },
    {
      declaration: /background-color:\s*var\(--ui-muted\);/u,
      description: "header background color reset",
    },
    {
      declaration: /background-image:\s*none;/u,
      description: "header background image reset",
    },
    {
      declaration: /background-origin:\s*padding-box;/u,
      description: "header background origin reset",
    },
    {
      declaration: /background-position:\s*0(?:%?)\s+0(?:%?);/u,
      description: "header background position reset",
    },
    {
      declaration: /background-repeat:\s*repeat;/u,
      description: "header background repeat reset",
    },
    {
      declaration: /background-size:\s*auto(?:\s+auto)?;/u,
      description: "header background size reset",
    },
    {
      declaration: /color:\s*var\(--ui-muted-foreground\);/u,
      description: "header foreground",
    },
    {
      declaration: /font-weight:\s*var\(--font-weight-medium\);/u,
      description: "header weight",
    },
  ],
  table: [
    { declaration: /border-collapse:\s*collapse;/u, description: "table border collapse" },
    {
      declaration: /color:\s*var\(--ui-foreground\);/u,
      description: "table foreground",
    },
    {
      declaration: /font-size:\s*var\(--text-label\);/u,
      description: "table type size",
    },
    { declaration: /width:\s*100%;/u, description: "table width" },
  ],
  wrapper: [
    {
      declaration: /border-color:\s*var\(--ui-border\);/u,
      description: "wrapper border color",
    },
    {
      declaration: /border-image-outset:\s*0;/u,
      description: "wrapper border-image outset reset",
    },
    {
      declaration: /border-image-repeat:\s*stretch;/u,
      description: "wrapper border-image repeat reset",
    },
    {
      declaration: /border-image-slice:\s*100%;/u,
      description: "wrapper border-image slice reset",
    },
    {
      declaration: /border-image-source:\s*none;/u,
      description: "wrapper border-image source reset",
    },
    {
      declaration: /border-image-width:\s*1;/u,
      description: "wrapper border-image width reset",
    },
    {
      declaration: /border-radius:\s*var\(--radius-lg\);/u,
      description: "wrapper radius",
    },
    { declaration: /border-style:\s*solid;/u, description: "wrapper border style" },
    { declaration: /border-width:\s*1px;/u, description: "wrapper border width" },
    { declaration: /max-width:\s*100%;/u, description: "wrapper maximum width" },
    { declaration: /overflow-x:\s*auto;/u, description: "wrapper overflow" },
  ],
};

function packageDataTableStyleMap(javaScript: string): PackageNamedStyleMap {
  return packageNamedStyleMap(
    javaScript,
    PACKAGE_DATA_TABLE_STYLE_KEYS,
    "dataTableStyles class map",
  );
}

function packageDataTableDeclarationProbe(
  map: PackageNamedStyleMap,
  key: PackageDataTableStyleKey,
  css: string,
  declaration: RegExp,
  description: string,
): Readonly<{ baseClasses: readonly string[]; property: string }> {
  const candidates = [...packageNamedStyleEntry(map, key).matchAll(
    /(?:^|[,{])\s*([A-Za-z_$][\w$]*)\s*:\s*["']((?:x[A-Za-z0-9_-]+)(?:\s+x[A-Za-z0-9_-]+)*)["']/gu,
  )].filter((binding) => {
    const classNames = new Set(binding[2]!.split(/\s+/u));
    return packageStyleRules(css, classNames).some((rule) =>
      rule.conditions.length === 0 && declaration.test(rule.body)
    );
  });
  assert.equal(
    candidates.length,
    1,
    `packed dataTableStyles.${key} must bind exactly one ${description} property`,
  );
  return {
    baseClasses: candidates[0]![2]!.split(/\s+/u),
    property: candidates[0]![1]!,
  };
}

function packageDataTableProbe(
  javaScript: string,
  css: string,
): PackageDataTableProbe {
  const map = packageDataTableStyleMap(javaScript);
  const table = packageDataTableDeclarationProbe(
    map,
    "table",
    css,
    /width:\s*100%;/u,
    "width",
  );
  const wrapper = packageDataTableDeclarationProbe(
    map,
    "wrapper",
    css,
    /max-width:\s*100%;/u,
    "max-width",
  );
  return {
    classNamesByKey: Object.fromEntries(
      PACKAGE_DATA_TABLE_STYLE_KEYS.map((key) => [
        key,
        [...packageEntryClassNames(map, key)],
      ]),
    ) as Record<PackageDataTableStyleKey, readonly string[]>,
    tableBaseClasses: table.baseClasses,
    tableProperty: table.property,
    wrapperBaseClasses: wrapper.baseClasses,
    wrapperProperty: wrapper.property,
  };
}

function requirePackageDataTableStyles(
  javaScript: string,
  css: string,
): void {
  const map = packageDataTableStyleMap(javaScript);
  assert.deepEqual(
    packageTopLevelStyleKeys(map.object, "packed dataTableStyles class map"),
    PACKAGE_DATA_TABLE_STYLE_KEYS,
    "packed dataTableStyles must retain its exact finite recipe keys and order",
  );
  const familyRules: PackageStyleRule[] = [];
  for (const key of PACKAGE_DATA_TABLE_STYLE_KEYS) {
    const entry = packageNamedStyleEntry(map, key);
    const bindings = [...entry.matchAll(
      /(?:^|[,{])\s*([A-Za-z_$][\w$]*)\s*:\s*["']((?:x[A-Za-z0-9_-]+)(?:\s+x[A-Za-z0-9_-]+)*)["']/gu,
    )];
    const expectedDeclarations = PACKAGE_DATA_TABLE_DECLARATIONS[key];
    assert.equal(
      bindings.length,
      expectedDeclarations.length,
      `packed dataTableStyles.${key} must retain its exact declaration binding count`,
    );
    const classNames = packageEntryClassNames(map, key);
    const rules = packageStyleRules(css, classNames);
    familyRules.push(...rules);
    assert.ok(
      rules.every((rule) => rule.conditions.length === 0),
      `packed dataTableStyles.${key} declarations must remain unconditional`,
    );
    assert.equal(
      new Set(rules.map((rule) => normalizedAtomicDeclaration(rule.body))).size,
      expectedDeclarations.length,
      `packed dataTableStyles.${key} must retain only its exact declaration set`,
    );
    for (const className of classNames) {
      assert.ok(
        rules.some((rule) =>
          new RegExp(`\\.${className}(?![A-Za-z0-9_-])`, "u").test(rule.header)
        ),
        `packed dataTableStyles.${key} class ${className} must own CSS`,
      );
    }
    for (const { declaration, description } of expectedDeclarations) {
      requirePackageExactBaseDeclaration(
        css,
        classNames,
        declaration,
        `packed DataTable ${description}`,
      );
    }
  }
  const familyCss = [...new Set(familyRules.map((rule) => rule.source))].join("\n");
  assert.doesNotMatch(
    familyCss,
    /border-bottom(?:-[a-z-]+)?\s*:/u,
    "packed dataTableStyles must not lower its logical divider to border-bottom",
  );
  assert.doesNotMatch(
    css,
    /\.hraness-data-table(?:__[A-Za-z0-9_-]+)?(?![A-Za-z0-9_-])/u,
    "packed StyleX CSS must contain no DataTable semantic selectors",
  );
}

function packageContentPrecedenceProbe(
  javaScript: string,
  css: string,
): ContentPrecedenceProbe {
  const content = packageNamedStyleMap(
    javaScript,
    PACKAGE_CONTENT_STYLE_KEYS,
    "contentStyles class map",
  );
  const root = packageNamedStyleEntry(content, "pageIntroRoot");
  const displayDeclarations = [...root.matchAll(
    /(?:^|,)\s*([A-Za-z_$][\w$]*)\s*:\s*["']((?:x[A-Za-z0-9_-]+)(?:\s+x[A-Za-z0-9_-]+)*)["']/gu,
  )].filter((entry) => {
    const entryClasses = new Set(entry[2]!.split(/\s+/u));
    return packageCheckboxRuleBodies(css, entryClasses)
      .map((body) => normalizedAtomicDeclaration(body))
      .includes("display:grid;");
  });
  assert.equal(
    displayDeclarations.length,
    1,
    "packed contentStyles.pageIntroRoot must bind exactly one compiled display property",
  );
  const display = displayDeclarations[0]!;
  return {
    rootBaseClasses: display[2]!.split(/\s+/u),
    rootProperty: display[1]!,
  };
}

function packageFieldSelectProbe(javaScript: string): PackageFieldSelectProbe {
  const field = packageNamedStyleMap(
    javaScript,
    PACKAGE_FIELD_STYLE_KEYS,
    "fieldStyles class map",
  );
  const select = packageNamedStyleMap(
    javaScript,
    PACKAGE_SELECT_STYLE_KEYS,
    "selectFieldStyles class map",
  );
  const fieldRoot = packageEntryProbe(field.entries.get("root")!, "fieldStyles.root");
  const fieldControl = packageEntryProbe(
    field.entries.get("control")!,
    "fieldStyles.control",
  );
  const fieldOptions = packageEntryProbe(
    packageNamedStyleEntry(field, "options"),
    "fieldStyles.options",
  );
  const fieldTextArea = packageEntryProbe(
    packageNamedStyleEntry(field, "textAreaResizeVertical"),
    "fieldStyles.textAreaResizeVertical",
  );
  const selectTrigger = packageEntryProbe(
    select.entries.get("trigger")!,
    "selectFieldStyles.trigger",
  );
  return {
    fieldControlBaseClasses: fieldControl.baseClasses,
    fieldControlProperty: fieldControl.property,
    fieldOptionsBaseClasses: fieldOptions.baseClasses,
    fieldOptionsProperty: fieldOptions.property,
    fieldRootBaseClasses: fieldRoot.baseClasses,
    fieldRootProperty: fieldRoot.property,
    fieldTextAreaBaseClasses: fieldTextArea.baseClasses,
    fieldTextAreaProperty: fieldTextArea.property,
    radioSwitchNativeFocusClasses: [
      ...packageEntryClassNames(field, "radioSwitchNativeFocus"),
    ],
    selectNativeInteractionClasses: [
      ...packageEntryClassNames(select, "triggerNativeInteractions"),
    ],
    selectTriggerBaseClasses: selectTrigger.baseClasses,
    selectTriggerProperty: selectTrigger.property,
  };
}

function packageIndicatorKnobProbe(
  javaScript: string,
): PackageIndicatorKnobProbe {
  const indicators = packageNamedStyleMap(
    javaScript,
    PACKAGE_INDICATOR_STYLE_KEYS,
    "indicatorStyles class map",
  );
  const knob = packageNamedStyleMap(
    javaScript,
    PACKAGE_KNOB_STYLE_KEYS,
    "knobStyles class map",
  );
  const indicatorRoot = packageEntryProbe(
    indicators.entries.get("root")!,
    "indicatorStyles.root",
  );
  const knobRoot = packageEntryProbe(
    knob.entries.get("root")!,
    "knobStyles.root",
  );
  const knobControl = packageEntryProbe(
    knob.entries.get("control")!,
    "knobStyles.control",
  );
  return {
    indicatorRootBaseClasses: indicatorRoot.baseClasses,
    indicatorRootProperty: indicatorRoot.property,
    knobControlBaseClasses: knobControl.baseClasses,
    knobControlNativeFocusClasses: [
      ...packageEntryClassNames(knob, "controlNativeFocus"),
    ],
    knobControlProperty: knobControl.property,
    knobRootBaseClasses: knobRoot.baseClasses,
    knobRootProperty: knobRoot.property,
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
  readonly conditions: readonly string[];
  readonly header: string;
  readonly source: string;
}

function normalizedPackageCondition(header: string): string {
  const normalized = header.replace(/\s+/gu, "").toLowerCase();
  if (
    normalized === "@media(max-width:40rem)"
    || normalized === "@media(width<=40rem)"
  ) {
    return "@media(width<=40rem)";
  }
  return normalized;
}

function packageCssRules(
  css: string,
  conditions: readonly string[] = [],
): PackageStyleRule[] {
  const rules: PackageStyleRule[] = [];
  let statementStart = 0;
  let index = 0;
  while (index < css.length) {
    const character = css[index];
    const nextCharacter = css[index + 1];
    if (character === "/" && nextCharacter === "*") {
      const end = css.indexOf("*/", index + 2);
      assert.notEqual(end, -1, "packed CSS contains an unterminated comment");
      index = end + 2;
      continue;
    }
    if (character === "\"" || character === "'") {
      const quote = character;
      index += 1;
      let escaped = false;
      while (index < css.length) {
        const quotedCharacter = css[index];
        if (escaped) escaped = false;
        else if (quotedCharacter === "\\") escaped = true;
        else if (quotedCharacter === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (character === ";") {
      statementStart = index + 1;
      index += 1;
      continue;
    }
    if (character !== "{") {
      index += 1;
      continue;
    }

    const rawHeader = css.slice(statementStart, index);
    const header = rawHeader.replace(/\/\*[\s\S]*?\*\//gu, " ").trim();
    const block = balancedBlock(css, index, `packed CSS block ${header}`);
    const body = block.slice(1, -1);
    if (header.startsWith("@")) {
      const nestedConditions = /^@layer(?:\s|$)/iu.test(header)
        ? conditions
        : [...conditions, normalizedPackageCondition(header)];
      rules.push(...packageCssRules(body, nestedConditions));
    } else if (header.length > 0) {
      rules.push({
        body,
        conditions,
        header,
        source: `${header}{${body}}`,
      });
    }
    index += block.length;
    statementStart = index;
  }
  return rules;
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
  return packageCssRules(css).filter((rule) => [...classNames].some(
    (className) => new RegExp(
      `\\.${className}(?![A-Za-z0-9_-])`,
      "u",
    ).test(rule.header),
  ));
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

function requirePackageExactClassPseudoSelector(
  selector: string,
  classNames: ReadonlySet<string>,
  pseudo:
    | "focus-visible"
    | "focus-within"
    | "has(input:focus-visible)"
    | "hover",
  description: string,
): void {
  const owners = [...classNames].filter((className) =>
    new RegExp(`\\.${className}(?![A-Za-z0-9_-])`, "u").test(selector)
  );
  assert.equal(
    owners.length,
    1,
    `${description} must have exactly one owning generated class`,
  );
  const owner = owners[0]!;
  assert.match(owner, /^[A-Za-z0-9_-]+$/u);
  const ownerSelector = `.${owner}`;
  const suffix = `:${pseudo}`;
  const ownerPrefix = selector.endsWith(suffix)
    ? selector.slice(0, -suffix.length)
    : "";
  assert.ok(
    ownerPrefix.length > 0
      && ownerPrefix.replaceAll(ownerSelector, "") === "",
    `${description} must use only the owning generated class and :${pseudo}`,
  );
}

function requirePackageExactBaseDeclaration(
  css: string,
  classNames: ReadonlySet<string>,
  declaration: RegExp,
  description: string,
): void {
  const selectors = packageDeclarationSelectors(
    packageStyleRules(css, classNames).filter(
      (rule) => rule.conditions.length === 0,
    ),
    classNames,
    declaration,
    description,
  );
  const exactSelectors = selectors.filter((selector) => {
    const owners = [...classNames].filter((className) =>
      new RegExp(`\\.${className}(?![A-Za-z0-9_-])`, "u").test(selector)
    );
    return owners.length === 1
      && selector.replaceAll(`.${owners[0]!}`, "") === "";
  });
  assert.notEqual(
    exactSelectors.length,
    0,
    `${description} must have an exact owner-only base selector`,
  );
}

function packageExactConditionalCss(css: string, condition: string): string {
  const normalizedCondition = normalizedPackageCondition(condition);
  const rules = packageCssRules(css).filter((rule) => (
    rule.conditions.length === 1
    && rule.conditions[0] === normalizedCondition
  ));
  assert.notEqual(
    rules.length,
    0,
    `packed CSS must contain rules in an exact ${condition} block`,
  );
  return rules.map((rule) => rule.source).join("\n");
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

function requirePackageIndicatorKnobStyles(
  javaScript: string,
  css: string,
): void {
  const indicators = packageNamedStyleMap(
    javaScript,
    PACKAGE_INDICATOR_STYLE_KEYS,
    "indicatorStyles class map",
  );
  const knob = packageNamedStyleMap(
    javaScript,
    PACKAGE_KNOB_STYLE_KEYS,
    "knobStyles class map",
  );
  assert.deepEqual(
    packageTopLevelStyleKeys(indicators.object, "packed indicatorStyles class map"),
    PACKAGE_INDICATOR_STYLE_KEYS,
    "packed indicatorStyles must retain its exact finite recipe keys and order",
  );
  assert.deepEqual(
    packageTopLevelStyleKeys(knob.object, "packed knobStyles class map"),
    PACKAGE_KNOB_STYLE_KEYS,
    "packed knobStyles must retain its exact finite recipe keys and order",
  );
  const entryCss = (
    map: PackageNamedStyleMap,
    key: string,
    source = css,
  ) => packageStyleRules(
    source,
    packageEntryClassNames(map, key),
  ).map((rule) => rule.source).join("\n");

  for (const [map, key, declaration, description] of [
    [indicators, "root", /display:\s*grid/u, "indicator grid root"],
    [indicators, "root", /gap:\s*var\(--space-2\)/u, "indicator root gap"],
    [indicators, "track", /overflow:\s*hidden/u, "indicator track clipping"],
    [indicators, "fill", /background-color:\s*var\(--ui-primary\)/u, "indicator primary fill"],
    [indicators, "fill", /display:\s*block/u, "indicator fill box generation"],
    [indicators, "sliderRootVertical", /min-height:\s*12rem/u, "vertical Slider root geometry"],
    [indicators, "sliderTrackVertical", /height:\s*10rem/u, "vertical Slider track geometry"],
    [indicators, "sliderThumb", /max\(1\.25rem,\s*var\(--hraness-slider-coarse-min,\s*0px\)\)/u, "synthetic coarse Slider target"],
    [indicators, "sliderThumbIndicator", /height:\s*1\.25rem/u, "Slider visible thumb height"],
    [indicators, "sliderThumbIndicator", /width:\s*1\.25rem/u, "Slider visible thumb width"],
    [indicators, "indeterminateFill", /animation-name:\s*hraness-progress-indeterminate/u, "indeterminate animation name"],
    [indicators, "indeterminateFill", /animation-duration:\s*1\.25s/u, "indeterminate animation duration"],
    [indicators, "indeterminateFill", /width:\s*40%\s*!important/u, "indeterminate fill width"],
    [knob, "root", /display:\s*inline-grid/u, "Knob root display"],
    [knob, "control", /height:\s*3rem/u, "Knob control height"],
    [knob, "control", /width:\s*3rem/u, "Knob control width"],
    [knob, "dial", /height:\s*2\.5rem/u, "default Knob dial"],
    [knob, "dialCompact", /height:\s*2rem/u, "compact Knob dial"],
    [knob, "thumb", /align-items:\s*center/u, "Knob thumb block-axis centering"],
    [knob, "thumb", /justify-items:\s*center/u, "Knob thumb inline-axis centering"],
    [knob, "gesture", /bottom:\s*0/u, "Knob gesture bottom edge"],
    [knob, "gesture", /left:\s*0/u, "Knob gesture left edge"],
    [knob, "gesture", /right:\s*0/u, "Knob gesture right edge"],
    [knob, "gesture", /top:\s*0/u, "Knob gesture top edge"],
  ] as const) {
    assert.match(
      entryCss(map, key),
      declaration,
      `packed ${description} must remain in its compiled recipe`,
    );
  }
  assert.doesNotMatch(
    entryCss(knob, "thumb"),
    /place-items:\s*/u,
    "packed Knob thumb must preserve its longhand-only place-items contract",
  );

  for (const key of [
    "fill",
    "sliderFill",
    "sliderThumb",
    "sliderThumbIndicator",
    "sliderTrack",
    "track",
  ] as const) {
    for (const [declaration, description] of [
      [/background-attachment:\s*scroll/u, "attachment"],
      [/background-clip:\s*border-box/u, "clip"],
      [/background-image:\s*none/u, "image"],
      [/background-origin:\s*padding-box/u, "origin"],
      [/background-position:\s*0(?:%?)\s+0(?:%?)/u, "position"],
      [/background-repeat:\s*repeat/u, "repeat"],
      [/background-size:\s*auto(?:\s+auto)?/u, "size"],
    ] as const) {
      assert.match(
        entryCss(indicators, key),
        declaration,
        `packed ${key} must retain its background-${description} shorthand reset`,
      );
    }
  }
  for (const [key, declaration, description] of [
    ["fill", /background-color:\s*var\(--ui-primary\)/u, "ProgressBar and Meter fill"],
    ["sliderFill", /background-color:\s*var\(--ui-primary\)/u, "Slider fill"],
    ["sliderThumb", /background-color:\s*(?:transparent|#0000)/u, "Slider hit boundary"],
    ["sliderThumbIndicator", /background-color:\s*var\(--ui-background\)/u, "Slider visible thumb"],
    ["sliderTrack", /background-color:\s*var\(--ui-muted\)/u, "Slider track"],
    ["track", /background-color:\s*var\(--ui-muted\)/u, "ProgressBar and Meter track"],
  ] as const) {
    assert.match(
      entryCss(indicators, key),
      declaration,
      `packed ${description} must retain its background-color reset`,
    );
  }
  for (const key of ["sliderThumb", "sliderThumbIndicator"] as const) {
    for (const [declaration, description] of [
      [/border-image-outset:\s*0/u, "outset"],
      [/border-image-repeat:\s*stretch/u, "repeat"],
      [/border-image-slice:\s*100%/u, "slice"],
      [/border-image-source:\s*none/u, "source"],
      [/border-image-width:\s*1/u, "width"],
    ] as const) {
      assert.match(
        entryCss(indicators, key),
        declaration,
        `packed ${key} must retain its border-image-${description} shorthand reset`,
      );
    }
  }

  const coarseCss = packageExactConditionalCss(css, "@media(pointer:coarse)");
  for (const [map, key, declaration, description] of [
    [indicators, "sliderThumb", /height:\s*var\(--interactive-target-min\)/u, "Slider target height"],
    [indicators, "sliderThumb", /width:\s*var\(--interactive-target-min\)/u, "Slider target width"],
    [knob, "control", /height:\s*max\(3rem,\s*var\(--interactive-target-min\)\)/u, "Knob control height"],
    [knob, "control", /width:\s*max\(3rem,\s*var\(--interactive-target-min\)\)/u, "Knob control width"],
  ] as const) {
    assert.match(
      entryCss(map, key, coarseCss),
      declaration,
      `packed real coarse ${description} must remain in the exact media block`,
    );
  }

  const forcedCss = packageExactConditionalCss(
    css,
    "@media(forced-colors:active)",
  );
  for (const [map, key, declaration, description] of [
    [indicators, "fill", /background-color:\s*highlight/u, "indicator fill"],
    [indicators, "sliderFill", /background-color:\s*highlight/u, "Slider fill"],
    [indicators, "sliderThumbFocusVisible", /outline-color:\s*highlight/u, "Slider reactive focus"],
    [indicators, "sliderThumbNativeFocusFallback", /outline-color:\s*highlight/u, "Slider native focus"],
    [indicators, "sliderThumbIndicator", /background-color:\s*canvas/u, "Slider thumb surface"],
    [indicators, "sliderThumbIndicator", /border-color:\s*highlight/u, "Slider thumb border"],
    [knob, "arcTrack", /stroke:\s*graytext/u, "Knob track"],
    [knob, "arcValue", /stroke:\s*highlight/u, "Knob value"],
    [knob, "face", /fill:\s*canvas/u, "Knob face"],
    [knob, "face", /stroke:\s*canvastext/u, "Knob face border"],
    [knob, "indicator", /stroke:\s*highlight/u, "Knob indicator"],
    [knob, "controlNativeFocus", /outline-color:\s*highlight/u, "Knob focus"],
  ] as const) {
    assert.match(
      entryCss(map, key, forcedCss),
      declaration,
      `packed forced-colors ${description} must retain its system color`,
    );
  }

  const reducedCss = packageExactConditionalCss(
    css,
    "@media(prefers-reduced-motion:reduce)",
  );
  for (const [map, key, declaration, description] of [
    [indicators, "indeterminateFill", /animation-name:\s*none/u, "ProgressBar animation stop"],
    [indicators, "indeterminateFill", /animation-duration:\s*0s/u, "ProgressBar zero duration"],
    [knob, "dial", /transition-duration:\s*0s/u, "Knob zero transition duration"],
    [knob, "dial", /transition-property:\s*none/u, "Knob transition stop"],
  ] as const) {
    assert.match(
      entryCss(map, key, reducedCss),
      declaration,
      `packed reduced-motion ${description} must remain in the exact media block`,
    );
  }

  for (const [map, key, pseudo, declarations, description] of [
    [
      indicators,
      "sliderThumbNativeFocusFallback",
      "has(input:focus-visible)",
      [
        /outline-color:\s*var\(--ui-ring\)/u,
        /outline-offset:\s*2px/u,
        /outline-style:\s*solid/u,
        /outline-width:\s*2px/u,
      ],
      "native Slider thumb focus-visible fallback",
    ],
    [
      knob,
      "controlNativeFocus",
      "has(input:focus-visible)",
      [
        /outline-color:\s*var\(--ui-ring\)/u,
        /outline-offset:\s*2px/u,
        /outline-style:\s*solid/u,
        /outline-width:\s*2px/u,
      ],
      "native Knob focus",
    ],
  ] as const) {
    const classNames = packageEntryClassNames(map, key);
    const rules = packageStyleRules(css, classNames);
    for (const declaration of declarations) {
      const selectors = packageDeclarationSelectors(
        rules,
        classNames,
        declaration,
        `packed ${description} ${declaration.source}`,
      ).filter((selector) => selector.endsWith(`:${pseudo}`));
      assert.notEqual(
        selectors.length,
        0,
        `packed ${description} must retain its exact :${pseudo} selector`,
      );
      for (const selector of selectors) {
        requirePackageExactClassPseudoSelector(
          selector,
          classNames,
          pseudo,
          `packed ${description} ${declaration.source}`,
        );
      }
    }
  }

  assert.match(
    entryCss(indicators, "indeterminateFill"),
    /:is\(\s*:lang\(ae\),[^{}]*:lang\(yi\)\s*\)[^{]*\{[^{}]*animation-direction:\s*reverse/u,
    "packed indeterminate ProgressBar must retain its RTL direction reversal",
  );
  assert.doesNotMatch(
    css,
    /@layer\s+components\.hraness-ui\.priority5/u,
    "packed StyleX CSS must stay inside the priority1 through priority4 envelope",
  );
}

function requirePackageContentStyles(javaScript: string, css: string): void {
  const content = packageNamedStyleMap(
    javaScript,
    PACKAGE_CONTENT_STYLE_KEYS,
    "contentStyles class map",
  );
  assert.deepEqual(
    packageTopLevelStyleKeys(content.object, "packed contentStyles class map"),
    PACKAGE_CONTENT_STYLE_KEYS,
    "packed contentStyles must retain its exact finite recipe keys and order",
  );
  const entryCss = (key: string, source = css) => packageStyleRules(
    source,
    packageEntryClassNames(content, key),
  ).map((rule) => rule.source).join("\n");
  for (const [key, declaration, description] of [
    ["actions", /display:\s*flex/u, "shared content actions layout"],
    ["actions", /flex-wrap:\s*wrap/u, "shared content actions wrapping"],
    ["emptyStateRoot", /border-style:\s*dashed/u, "EmptyState boundary"],
    ["emptyStateRoot", /min-height:\s*12rem/u, "EmptyState minimum height"],
    ["emptyStateDescription", /max-width:\s*36rem/u, "EmptyState description measure"],
    ["pageIntroRoot", /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/u, "PageIntro wide grid"],
    ["pageIntroCopy", /max-width:\s*48rem/u, "PageIntro copy measure"],
    ["pageIntroTitle", /text-wrap:\s*balance/u, "PageIntro balanced title"],
    ["inlineAlertRoot", /grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)/u, "InlineAlert grid"],
    ["inlineAlertInfo", /background-color:\s*var\(--ui-info-soft\)/u, "info InlineAlert tone"],
    ["inlineAlertSuccess", /background-color:\s*var\(--ui-success-soft\)/u, "success InlineAlert tone"],
    ["inlineAlertWarning", /background-color:\s*var\(--ui-warning-soft\)/u, "warning InlineAlert tone"],
    [
      "inlineAlertDanger",
      /background-color:\s*color-mix\(in oklch,\s*var\(--ui-destructive\)\s+9%,\s*var\(--ui-card\)\)/u,
      "danger InlineAlert tone",
    ],
    ["settingsCardRoot", /overflow:\s*hidden/u, "SettingsCard clipping"],
    ["settingsCardHeader", /border-bottom-width:\s*1px/u, "SettingsCard header divider"],
    ["settingsCardRectangular", /border-radius:\s*var\(--radius-sharp\)/u, "rectangular SettingsCard shape"],
  ] as const) {
    requirePackageExactBaseDeclaration(
      css,
      packageEntryClassNames(content, key),
      declaration,
      `packed ${description} must remain in its compiled recipe`,
    );
  }
  for (const [key, declaration, description] of [
    ["inlineAlertInfo", /border-color:\s*var\(--ui-border\)/u, "info InlineAlert border"],
    [
      "inlineAlertSuccess",
      /border-color:\s*color-mix\(in oklch,\s*var\(--ui-success\)\s+55%,\s*var\(--ui-border\)\)/u,
      "success InlineAlert border",
    ],
    [
      "inlineAlertWarning",
      /border-color:\s*color-mix\(in oklch,\s*var\(--ui-warning\)\s+55%,\s*var\(--ui-border\)\)/u,
      "warning InlineAlert border",
    ],
    [
      "inlineAlertDanger",
      /border-color:\s*color-mix\(in oklch,\s*var\(--ui-destructive\)\s+55%,\s*var\(--ui-border\)\)/u,
      "danger InlineAlert border",
    ],
  ] as const) {
    requirePackageExactBaseDeclaration(
      css,
      packageEntryClassNames(content, key),
      declaration,
      `packed normal ${description}`,
    );
  }
  const compactCondition = normalizedPackageCondition("@media(width<=40rem)");
  const compactRules = packageStyleRules(
    css,
    packageEntryClassNames(content, "pageIntroRoot"),
  ).filter((rule) => (
    rule.conditions.length === 1
    && rule.conditions[0] === compactCondition
  ));
  assert.notEqual(
    compactRules.length,
    0,
    "packed PageIntro must own rules in an exact equivalent 40rem media condition",
  );
  const compactCss = compactRules.map((rule) => rule.source).join("\n");
  assert.match(
    entryCss("pageIntroRoot", compactCss),
    /grid-template-columns:\s*minmax\(0,\s*1fr\)/u,
    "packed compact PageIntro grid must remain in its exact media block",
  );
  assert.match(
    entryCss("pageIntroRoot", compactCss),
    /align-items:\s*start/u,
    "packed compact PageIntro alignment must remain in its exact media block",
  );
  const forcedCss = packageExactConditionalCss(css, "@media(forced-colors:active)");
  for (const key of [
    "inlineAlertRoot",
    "inlineAlertInfo",
    "inlineAlertSuccess",
    "inlineAlertWarning",
    "inlineAlertDanger",
  ]) {
    assert.match(
      entryCss(key, forcedCss),
      /border-color:\s*canvastext/u,
      `packed forced-colors ${key} must retain its system border`,
    );
  }
  assert.match(
    entryCss("inlineAlertRoot", forcedCss),
    /forced-color-adjust:\s*auto/u,
    "packed forced-colors InlineAlert must retain automatic system adjustment",
  );
}

function requireNoMigratedGallerySentinels(...sources: string[]): void {
  const output = sources.join("\n");
  for (const sentinel of [
    "data-gallery-indicators-layer-conflict",
    "data-gallery-knob-layer-conflict",
    "data-gallery-content-layer-conflict",
    "data-gallery-data-table-layer-conflict",
  ]) {
    assert.doesNotMatch(
      output,
      new RegExp(sentinel, "u"),
      `package output must not contain the gallery-only ${sentinel} sentinel`,
    );
  }
}

function packageNamedStyleEntry(
  map: PackageNamedStyleMap,
  key: string,
): string {
  const knownEntry = map.entries.get(key);
  if (knownEntry !== undefined) return knownEntry;
  const body = map.object.slice(1, -1);
  const matches = [...body.matchAll(
    new RegExp(`(?:^|,)\\s*${key}\\s*:\\s*\\{`, "gu"),
  )];
  assert.equal(
    matches.length,
    1,
    `packed StyleX map must contain exactly one ${key}`,
  );
  const match = matches[0]!;
  const open = (match.index ?? 0) + match[0].lastIndexOf("{");
  return balancedBlock(body, open, `packed StyleX map entry ${key}`);
}

function packageEntryClassNames(
  map: PackageNamedStyleMap,
  key: string,
): ReadonlySet<string> {
  const names = new Set<string>();
  const entry = packageNamedStyleEntry(map, key);
  for (const match of entry.matchAll(
    /["']((?:x[A-Za-z0-9_-]+)(?:\s+x[A-Za-z0-9_-]+)*)["']/gu,
  )) {
    for (const name of match[1]!.split(/\s+/u)) names.add(name);
  }
  assert.notEqual(names.size, 0, `packed StyleX map entry ${key} must not be empty`);
  return names;
}

function requirePackageFieldSelectStyles(javaScript: string, css: string): void {
  const field = packageNamedStyleMap(
    javaScript,
    PACKAGE_FIELD_STYLE_KEYS,
    "fieldStyles class map",
  );
  const select = packageNamedStyleMap(
    javaScript,
    PACKAGE_SELECT_STYLE_KEYS,
    "selectFieldStyles class map",
  );
  const familyClassNames = new Set([...field.classNames, ...select.classNames]);
  const familyCss = packageStyleRules(
    css,
    familyClassNames,
  ).map((rule) => rule.source).join("\n");
  for (const [pattern, description] of [
    [/:focus-within/u, "field focus-within fallback"],
    [/background-image:\s*none/u, "explicit background reset"],
    [/linear-gradient\(45deg,[\s\S]*linear-gradient\(135deg,/u, "native-select arrow"],
    [/var\(--hraness-field-coarse-min,\s*0px\)/u, "synthetic coarse geometry"],
    [/:is\(\s*:lang\(ae\),[^{}]*:lang\(yi\)\s*\)/u, "native RTL switch seam"],
  ] as const) {
    assert.match(familyCss, pattern, `packed field/select recipes must retain ${description}`);
  }
  const optionStateCss = packageCheckboxRuleBodies(
    css,
    new Set([
      ...packageEntryClassNames(select, "optionFocused"),
      ...packageEntryClassNames(select, "optionNativeInteraction"),
    ]),
  ).join("\n");
  assert.match(
    optionStateCss,
    /background-image:\s*none/u,
    "packed Select option states must reset background images",
  );
  const entryCss = (
    map: PackageNamedStyleMap,
    key: string,
    conditionalCss = css,
  ) => packageStyleRules(
    conditionalCss,
    packageEntryClassNames(map, key),
  ).map((rule) => rule.source).join("\n");
  const coarseConditionalCss = packageExactConditionalCss(
    css,
    "@media(pointer:coarse)",
  );
  const coarseGeometry = [
    [field, "controlCompact", [/min-height:\s*var\(--interactive-target-min\)/u]],
    [field, "controlDefault", [/min-height:\s*var\(--interactive-target-min\)/u]],
    [field, "controlLarge", [/min-height:\s*var\(--interactive-target-min\)/u]],
    [field, "inputCompact", [/min-height:\s*calc\(var\(--interactive-target-min\)\s*-\s*2px\)/u]],
    [field, "inputDefault", [/min-height:\s*calc\(var\(--interactive-target-min\)\s*-\s*2px\)/u]],
    [field, "inputLarge", [/min-height:\s*calc\(var\(--interactive-target-min\)\s*-\s*2px\)/u]],
    [field, "numberControlCompact", [
      /min-height:\s*var\(--interactive-target-min\)/u,
      /grid-template-columns:\s*var\(--interactive-target-min\)\s+minmax\(3rem,\s*1fr\)\s+var\(--interactive-target-min\)/u,
    ]],
    [field, "numberControlDefault", [
      /min-height:\s*var\(--interactive-target-min\)/u,
      /grid-template-columns:\s*var\(--interactive-target-min\)\s+minmax\(3rem,\s*1fr\)\s+var\(--interactive-target-min\)/u,
    ]],
    [field, "numberControlLarge", [
      /min-height:\s*var\(--interactive-target-min\)/u,
      /grid-template-columns:\s*var\(--interactive-target-min\)\s+minmax\(3rem,\s*1fr\)\s+var\(--interactive-target-min\)/u,
    ]],
    [field, "searchClearCompact", [
      /min-height:\s*calc\(var\(--interactive-target-min\)\s*-\s*0?\.5rem\)/u,
      /min-width:\s*calc\(var\(--interactive-target-min\)\s*-\s*0?\.5rem\)/u,
    ]],
    [field, "searchClearDefault", [
      /min-height:\s*calc\(var\(--interactive-target-min\)\s*-\s*0?\.5rem\)/u,
      /min-width:\s*calc\(var\(--interactive-target-min\)\s*-\s*0?\.5rem\)/u,
    ]],
    [field, "searchClearLarge", [
      /min-height:\s*calc\(var\(--interactive-target-min\)\s*-\s*0?\.5rem\)/u,
      /min-width:\s*calc\(var\(--interactive-target-min\)\s*-\s*0?\.5rem\)/u,
    ]],
    [field, "radioSwitchControl", [/min-height:\s*var\(--interactive-target-min\)/u]],
    [select, "triggerCompact", [/min-height:\s*var\(--interactive-target-min\)/u]],
    [select, "triggerDefault", [/min-height:\s*var\(--interactive-target-min\)/u]],
    [select, "triggerLarge", [/min-height:\s*var\(--interactive-target-min\)/u]],
    [select, "option", [/min-height:\s*var\(--interactive-target-min\)/u]],
  ] as const;
  for (const [map, key, declarations] of coarseGeometry) {
    const keyCss = entryCss(map, key, coarseConditionalCss);
    for (const declaration of declarations) {
      assert.match(keyCss, declaration, `packed ${key} must retain its exact coarse geometry`);
    }
  }

  const forcedConditionalCss = packageExactConditionalCss(
    css,
    "@media(forced-colors:active)",
  );
  const forcedContracts = [
    [field, "controlFocusWithinFallback", [
      /border-color:\s*canvastext/u,
      /box-shadow:\s*none/u,
      /outline-color:\s*highlight/u,
    ]],
    [field, "numberStepFocusVisible", [
      /box-shadow:\s*none/u,
      /outline-color:\s*highlight/u,
    ]],
    [field, "numberStepNativeInteractions", [
      /box-shadow:\s*none/u,
      /outline-color:\s*highlight/u,
    ]],
    [field, "nativeSelect", [/appearance:\s*auto/u, /background-image:\s*none/u]],
    [field, "radioIndicator", [
      /background-color:\s*canvas/u,
      /border-color:\s*canvastext/u,
      /forced-color-adjust:\s*none/u,
    ]],
    [field, "radioIndicatorSelected", [/background-color:\s*highlight/u, /border-color:\s*highlight/u]],
    [field, "radioDot", [/background-color:\s*highlighttext/u]],
    [field, "switchTrack", [
      /background-color:\s*canvas/u,
      /border-color:\s*canvastext/u,
      /forced-color-adjust:\s*none/u,
    ]],
    [field, "switchTrackSelected", [/background-color:\s*highlight/u, /border-color:\s*highlight/u]],
    [field, "switchThumb", [/background-color:\s*canvastext/u, /box-shadow:\s*none/u]],
    [field, "switchThumbSelected", [/background-color:\s*highlighttext/u]],
  ] as const;
  for (const [map, key, declarations] of forcedContracts) {
    const keyCss = entryCss(map, key, forcedConditionalCss);
    for (const declaration of declarations) {
      assert.match(keyCss, declaration, `packed ${key} must retain its exact forced-colors contract`);
    }
  }
  for (const [map, key] of [
    [field, "control"],
    [field, "controlInvalid"],
    [field, "numberControl"],
    [field, "radioIndicatorInvalid"],
    [field, "switchTrackInvalid"],
    [select, "trigger"],
    [select, "triggerHovered"],
    [select, "triggerFocusVisible"],
    [select, "triggerInvalid"],
    [select, "triggerNativeInteractions"],
  ] as const) {
    assert.match(
      entryCss(map, key, forcedConditionalCss),
      /border-color:\s*canvastext/u,
      `packed ${key} must retain its forced-colors CanvasText border`,
    );
  }
  const ordinaryFocusContracts = [
    [field, "controlFocusWithinFallback", [
      /outline-color:\s*var\(--ui-ring\)/u,
      /outline-offset:\s*2px/u,
      /outline-style:\s*solid/u,
      /outline-width:\s*2px/u,
    ]],
    [field, "numberStepFocusVisible", [
      /box-shadow:\s*inset 0 0 0 2px var\(--ui-ring\)/u,
      /outline-color:\s*var\(--ui-ring\)/u,
      /outline-offset:\s*-2px/u,
      /outline-style:\s*solid/u,
      /outline-width:\s*2px/u,
    ]],
    [field, "numberStepNativeInteractions", [
      /box-shadow:\s*inset 0 0 0 2px var\(--ui-ring\)/u,
      /outline-color:\s*var\(--ui-ring\)/u,
      /outline-offset:\s*-2px/u,
      /outline-style:\s*solid/u,
      /outline-width:\s*2px/u,
    ]],
  ] as const;
  for (const [map, key, declarations] of ordinaryFocusContracts) {
    const keyCss = entryCss(map, key);
    for (const declaration of declarations) {
      assert.match(keyCss, declaration, `packed ${key} must retain its ordinary focus contract`);
    }
  }
  for (const [map, key, pseudo, declarations] of [
    [field, "radioSwitchNativeFocus", "has(input:focus-visible)", [
      /outline-color:\s*var\(--ui-ring\)/u,
      /outline-offset:\s*3px/u,
      /outline-style:\s*solid/u,
      /outline-width:\s*2px/u,
    ]],
    [select, "triggerNativeInteractions", "focus-visible", [
      /border-color:\s*canvastext/u,
      /box-shadow:\s*0 0 0 3px color-mix\(in oklch,\s*var\(--ui-ring\) 24%,\s*transparent\)/u,
      /outline-color:\s*var\(--ui-ring\)/u,
      /outline-offset:\s*2px/u,
      /outline-style:\s*solid/u,
      /outline-width:\s*2px/u,
    ]],
  ] as const) {
    const classNames = packageEntryClassNames(map, key);
    const rules = packageStyleRules(css, classNames);
    for (const declaration of declarations) {
      const suffix = `:${pseudo}`;
      const selectors = packageDeclarationSelectors(
        rules,
        classNames,
        declaration,
        `packed ${key} ${String(declaration)}`,
      ).filter((selector) => selector.endsWith(suffix));
      assert.notEqual(
        selectors.length,
        0,
        `packed ${key} ${String(declaration)} must have an exact :${pseudo} selector`,
      );
      for (const selector of selectors) {
        requirePackageExactClassPseudoSelector(
          selector,
          classNames,
          pseudo,
          `packed ${key} ${String(declaration)} selector`,
        );
      }
    }
  }
  const invalidClasses = packageEntryClassNames(field, "controlInvalid");
  requirePackageExactBaseDeclaration(
    css,
    invalidClasses,
    /border-color:\s*var\(--ui-destructive\)/u,
    "packed controlInvalid ordinary border",
  );
  requirePackageExactBaseDeclaration(
    forcedConditionalCss,
    invalidClasses,
    /border-color:\s*canvastext/u,
    "packed controlInvalid forced-colors border",
  );
  const invalidFocusRules = packageStyleRules(css, invalidClasses).filter(
    (rule) => /:focus-within(?![A-Za-z0-9_-])/u.test(rule.header),
  );
  for (const declaration of [
    /border-color:\s*var\(--ui-destructive\)/u,
    /border-color:\s*canvastext/u,
  ]) {
    for (const selector of packageDeclarationSelectors(
      invalidFocusRules,
      invalidClasses,
      declaration,
      `packed controlInvalid ${String(declaration)}`,
    )) {
      requirePackageExactClassPseudoSelector(
        selector,
        invalidClasses,
        "focus-within",
        `packed controlInvalid ${String(declaration)} selector`,
      );
    }
  }
  const selectInvalidClasses = packageEntryClassNames(select, "triggerInvalid");
  requirePackageExactBaseDeclaration(
    css,
    selectInvalidClasses,
    /border-color:\s*var\(--ui-destructive\)/u,
    "packed triggerInvalid ordinary border",
  );
  requirePackageExactBaseDeclaration(
    forcedConditionalCss,
    selectInvalidClasses,
    /border-color:\s*canvastext/u,
    "packed triggerInvalid forced-colors border",
  );
  for (const pseudo of ["focus-visible", "hover"] as const) {
    const selectInvalidRules = packageStyleRules(css, selectInvalidClasses)
      .filter((rule) =>
        new RegExp(`:${pseudo}(?![A-Za-z0-9_-])`, "u").test(rule.header)
      );
    for (const declaration of [
      /border-color:\s*var\(--ui-destructive\)/u,
      /border-color:\s*canvastext/u,
    ]) {
      const suffix = `:${pseudo}`;
      const selectors = packageDeclarationSelectors(
        selectInvalidRules,
        selectInvalidClasses,
        declaration,
        `packed triggerInvalid :${pseudo} ${String(declaration)}`,
      ).filter((selector) => selector.endsWith(suffix));
      assert.notEqual(
        selectors.length,
        0,
        `packed triggerInvalid :${pseudo} ${String(declaration)} must have an exact pseudo selector`,
      );
      for (const selector of selectors) {
        requirePackageExactClassPseudoSelector(
          selector,
          selectInvalidClasses,
          pseudo,
          `packed triggerInvalid :${pseudo} ${String(declaration)} selector`,
        );
      }
    }
  }
  for (const [map, key, positiveSelector, description] of [
    [
      field,
      "radioSwitchNativeFocus",
      /:has\(input:focus-visible\)/u,
      "native descendant :focus-visible selector",
    ],
    [
      select,
      "triggerNativeInteractions",
      /:focus-visible(?![A-Za-z0-9_-])/u,
      "native :focus-visible selector",
    ],
  ] as const) {
    const keyCss = entryCss(map, key);
    assert.match(
      keyCss,
      positiveSelector,
      `packed ${key} must retain its positive ${description}`,
    );
    assert.doesNotMatch(
      keyCss,
      /:not\(\s*:focus-visible(?![A-Za-z0-9_-])/u,
      `packed ${key} must not negate its native :focus-visible selector`,
    );
  }
  const nativeSelectCss = entryCss(field, "nativeSelect");
  assert.match(nativeSelectCss, /appearance:\s*none/u);
  assert.match(
    nativeSelectCss,
    /background-position:\s*calc\(100%\s*-\s*1rem\)(?:\s+50%)?,\s*calc\(100%\s*-\s*0?\.75rem\)(?:\s+50%)?/u,
  );
  assert.match(nativeSelectCss, /:is\(\s*:lang\(ae\),[^{}]*:lang\(yi\)\s*\)[^{}]*\{[^{}]*background-position:\s*0?\.75rem(?:\s+50%)?,\s*1rem(?:\s+50%)?/u);
  assert.match(nativeSelectCss, /padding-inline-end:\s*2\.5rem/u);
  assert.match(entryCss(field, "textArea"), /min-height:\s*7\.5rem/u);
  assert.match(entryCss(field, "textAreaResizeNone"), /resize:\s*none/u);
  assert.match(entryCss(field, "textAreaResizeVertical"), /resize:\s*vertical/u);

  const reducedConditionalCss = packageExactConditionalCss(
    css,
    "@media(prefers-reduced-motion:reduce)",
  );
  for (const key of ["popoverEntering", "popoverExiting"] as const) {
    const keyCss = entryCss(select, key, reducedConditionalCss);
    assert.match(keyCss, /animation-duration:\s*0s/u);
    assert.match(keyCss, /animation-name:\s*none/u);
  }
  for (const hook of [
    "hraness-text-field",
    "hraness-native-select-field",
    "hraness-file-field",
    "hraness-number-field",
    "hraness-select-field",
  ]) {
    assert.match(javaScript, new RegExp(`["']${hook}["']`, "u"));
  }
}

function requirePackageViteFieldSelectStyles(
  javaScript: string,
  css: string,
): void {
  const field = packageNamedStyleMap(
    javaScript,
    ["control", "controlFocusWithinFallback", "nativeSelect", "root"],
    "tree-shaken fieldStyles class map",
  );
  const select = packageNamedStyleMap(
    javaScript,
    ["option", "trigger", "triggerNativeInteractions"],
    "tree-shaken selectFieldStyles class map",
  );
  const familyCss = packageStyleRules(
    css,
    new Set([...field.classNames, ...select.classNames]),
  ).map((rule) => rule.source).join("\n");
  for (const [pattern, description] of [
    [/:focus-within/u, "field focus-within fallback"],
    [/background-image:\s*none/u, "explicit background reset"],
    [/linear-gradient\(45deg,[\s\S]*linear-gradient\(135deg,/u, "native-select arrow"],
    [/:is\(\s*:lang\(ae\),[^{}]*:lang\(yi\)\s*\)/u, "native RTL switch seam"],
  ] as const) {
    assert.match(
      familyCss,
      pattern,
      `Vite field/select recipes must retain ${description}`,
    );
  }
  for (const hook of [
    "hraness-text-field",
    "hraness-native-select-field",
    "hraness-file-field",
    "hraness-select-field",
  ]) {
    assert.match(javaScript, new RegExp(`["']${hook}["']`, "u"));
  }
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
  contentProbe: ContentPrecedenceProbe,
  dataTableProbe: PackageDataTableProbe,
  fieldSelectProbe: PackageFieldSelectProbe,
  formProbe: FormPrecedenceProbe,
  indicatorKnobProbe: PackageIndicatorKnobProbe,
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
  CheckboxGroup,
  CheckboxField,
  DataTable,
  EmptyState,
  FileField,
  Form,
  Icon,
  InlineAlert,
  KeyHint,
  Knob,
  Link,
  Meter,
  NativeSelectField,
  PageIntro,
  PressableCard,
  ProgressBar,
  QuietSiteFooter,
  QuietSitePage,
  RadioGroup,
  RadioOption,
  SocialIcon,
  StatusDot,
  SelectField,
  Slider,
  SettingsCard,
  Tag,
  ThemedSurface,
  Toolbar,
  SwitchField,
  TextAreaField,
  TextField,
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
const contentRootXstyle = {
  ${JSON.stringify(contentProbe.rootProperty)}: "package-content-root-xstyle",
  $$css: true,
};
const contentRootBaseClasses = ${JSON.stringify(contentProbe.rootBaseClasses)};
const dataTableXstyle = {
  ${JSON.stringify(dataTableProbe.tableProperty)}: "package-data-table-xstyle",
  $$css: true,
};
const dataTableWrapperXstyle = {
  ${JSON.stringify(dataTableProbe.wrapperProperty)}: "package-data-table-wrapper-xstyle",
  $$css: true,
};
const dataTableClasses = ${JSON.stringify(dataTableProbe.classNamesByKey)};
const dataTableBaseClasses = ${JSON.stringify(dataTableProbe.tableBaseClasses)};
const dataTableWrapperBaseClasses = ${JSON.stringify(dataTableProbe.wrapperBaseClasses)};
const fieldRootXstyle = {
  ${JSON.stringify(fieldSelectProbe.fieldRootProperty)}: "package-field-root-xstyle",
  $$css: true,
};
const fieldControlXstyle = {
  ${JSON.stringify(fieldSelectProbe.fieldControlProperty)}: "package-field-control-xstyle",
  $$css: true,
};
const fieldOptionsXstyle = {
  ${JSON.stringify(fieldSelectProbe.fieldOptionsProperty)}: "package-field-options-xstyle",
  $$css: true,
};
const fieldTextAreaXstyle = {
  ${JSON.stringify(fieldSelectProbe.fieldTextAreaProperty)}: "package-field-textarea-xstyle",
  $$css: true,
};
const selectTriggerXstyle = {
  ${JSON.stringify(fieldSelectProbe.selectTriggerProperty)}: "package-select-trigger-xstyle",
  $$css: true,
};
const fieldRootBaseClasses = ${JSON.stringify(fieldSelectProbe.fieldRootBaseClasses)};
const fieldControlBaseClasses = ${JSON.stringify(fieldSelectProbe.fieldControlBaseClasses)};
const fieldOptionsBaseClasses = ${JSON.stringify(fieldSelectProbe.fieldOptionsBaseClasses)};
const fieldTextAreaBaseClasses = ${JSON.stringify(fieldSelectProbe.fieldTextAreaBaseClasses)};
const radioSwitchNativeFocusClasses = ${JSON.stringify(fieldSelectProbe.radioSwitchNativeFocusClasses)};
const selectNativeInteractionClasses = ${JSON.stringify(fieldSelectProbe.selectNativeInteractionClasses)};
const selectTriggerBaseClasses = ${JSON.stringify(fieldSelectProbe.selectTriggerBaseClasses)};
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
const indicatorRootXstyle = {
  ${JSON.stringify(indicatorKnobProbe.indicatorRootProperty)}: "package-indicator-root-xstyle",
  $$css: true,
};
const indicatorRootBaseClasses = ${JSON.stringify(indicatorKnobProbe.indicatorRootBaseClasses)};
const knobRootXstyle = {
  ${JSON.stringify(indicatorKnobProbe.knobRootProperty)}: "package-knob-root-xstyle",
  $$css: true,
};
const knobControlXstyle = {
  ${JSON.stringify(indicatorKnobProbe.knobControlProperty)}: "package-knob-control-xstyle",
  $$css: true,
};
const knobRootBaseClasses = ${JSON.stringify(indicatorKnobProbe.knobRootBaseClasses)};
const knobControlBaseClasses = ${JSON.stringify(indicatorKnobProbe.knobControlBaseClasses)};
const knobControlNativeFocusClasses = ${JSON.stringify(indicatorKnobProbe.knobControlNativeFocusClasses)};
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
assert.doesNotMatch(stylexCss, /@layer components\.hraness-ui\.priority5/u);
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
  "the packed CSS must contain exactly one shared physical 100% width declaration for Avatar children, PressableCard, and DataTable",
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
await access(new URL("./fields.stylex.ts", componentsCssUrl));
await access(new URL("./select-field.stylex.ts", componentsCssUrl));
await access(new URL("./indicators.stylex.ts", componentsCssUrl));
await access(new URL("./knob.stylex.ts", componentsCssUrl));
await access(new URL("./content.stylex.ts", componentsCssUrl));
await access(new URL("./data-table.stylex.ts", componentsCssUrl));
await access(new URL("./data-display.tsx", componentsCssUrl));
assert.match(
  componentsCss,
  /@keyframes\s+hraness-progress-indeterminate\s*\{\s*from\s*\{\s*transform:\s*translateX\(-125%\);\s*\}\s*to\s*\{\s*transform:\s*translateX\(250%\);\s*\}\s*\}/u,
);
assert.match(
  componentsCss,
  /\.hraness-progress(?:__control|__label-row)?(?![A-Za-z0-9_-])/u,
  "components.css must preserve the separate native Feedback progress boundary",
);
assert.doesNotMatch(
  componentsCss,
  /\.hraness-(?:progress-bar|meter|slider|knob)(?:__[A-Za-z0-9_-]+)?(?![A-Za-z0-9_-])/u,
  "components.css must not retain migrated indicator or Knob recipes",
);
assert.doesNotMatch(
  componentsCss,
  /\.hraness-(?:page-intro|empty-state|inline-alert|settings-card)(?:__[A-Za-z0-9_-]+)?(?![A-Za-z0-9_-])/u,
  "components.css must not retain migrated content-family recipes",
);
assert.doesNotMatch(
  componentsCss,
  /\.hraness-data-table(?:__[A-Za-z0-9_-]+)?(?![A-Za-z0-9_-])/u,
  "components.css must not retain migrated DataTable recipes",
);
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
function stripApprovedFieldNativeSeams(css) {
  const candidates = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].filter(
    (match) => /\.hraness-field__(?:input::placeholder|file::file-selector-button)/u
      .test(match[1] ?? ""),
  );
  const counts = {
    fileCompact: 0,
    fileLarge: 0,
    fileUnqualified: 0,
    placeholder: 0,
  };
  const ranges = [];
  for (const candidate of candidates) {
    const selector = (candidate[1] ?? "")
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/\s+/gu, " ")
      .trim();
    if (selector === ".hraness-field__input::placeholder") {
      counts.placeholder += 1;
    } else if (selector === ".hraness-field__file::file-selector-button") {
      counts.fileUnqualified += 1;
    } else if (
      selector
        === ':where(.hraness-file-field[data-size="compact"]) .hraness-field__file::file-selector-button'
    ) {
      counts.fileCompact += 1;
    } else if (
      selector
        === ':where(.hraness-file-field[data-size="large"]) .hraness-field__file::file-selector-button'
    ) {
      counts.fileLarge += 1;
    } else {
      assert.fail(
        "packed components.css contains an unapproved field native seam selector: "
          + selector,
      );
    }
    ranges.push([candidate.index, candidate.index + candidate[0].length]);
  }
  assert.deepEqual(
    counts,
    { fileCompact: 1, fileLarge: 1, fileUnqualified: 2, placeholder: 2 },
    "packed components.css must contain exactly the approved placeholder and file-button native seam rules",
  );
  let stripped = css;
  for (const [start, end] of ranges.toReversed()) {
    stripped = stripped.slice(0, start) + stripped.slice(end);
  }
  return stripped;
}

assert.throws(
  () => stripApprovedFieldNativeSeams(
    componentsCss.replace(
      ".hraness-field__input::placeholder {",
      ".unexpected, .hraness-field__input::placeholder {",
    ),
  ),
  /unapproved field native seam selector/u,
  "the packed field seam guard must reject a grouped unexpected selector",
);
const fieldLegacyWithoutNativeSeams = stripApprovedFieldNativeSeams(componentsCss);
assert.doesNotMatch(
  fieldLegacyWithoutNativeSeams,
  /\.hraness-(?:field__(?:input|file)|text-field|text-area-field|search-field|number-field|radio-group|radio-option|switch-field|native-select-field|file-field|select-field|checkbox-group)(?![A-Za-z0-9_-])/u,
  "packed components.css must retain only the approved placeholder and file-button native seams",
);
assert.equal(
  componentsCss.match(/\.hraness-field__input::placeholder(?![A-Za-z0-9_-])/gu)?.length,
  2,
);
assert.equal(
  componentsCss.match(/\.hraness-field__file::file-selector-button(?![A-Za-z0-9_-])/gu)?.length,
  4,
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

const pageIntroMarkup = renderToStaticMarkup(React.createElement(PageIntro, {
  actions: React.createElement("button", { type: "button" }, "Create"),
  className: "consumer-page-intro",
  description: "Package content overview",
  eyebrow: "Workspace",
  style: { display: "inline-block", maxWidth: "50rem" },
  title: "Projects",
  titleAs: "h3",
  xstyle: contentRootXstyle,
}));
const pageIntroTag = pageIntroMarkup.match(/^<section[^>]*>/u)?.[0] ?? "";
assert.match(pageIntroMarkup, /^<section/u);
assert.match(pageIntroTag, /class="hraness-page-intro [^"]*package-content-root-xstyle consumer-page-intro"/u);
assert.match(pageIntroMarkup, /data-slot="page-intro"/u);
assert.match(pageIntroMarkup, /<h3[^>]*data-slot="page-intro-title"[^>]*>Projects<\/h3>/u);
assert.match(pageIntroTag, /style="display:inline-block;max-width:50rem"/u);
for (const baseClass of contentRootBaseClasses) {
  assert.ok(
    !pageIntroTag.split(/[\s"]/u).includes(baseClass),
    "PageIntro caller xstyle must replace its package display class before native style wins last",
  );
}

const emptyStateMarkup = renderToStaticMarkup(React.createElement(EmptyState, {
  action: React.createElement("button", { type: "button" }, "Add project"),
  description: "Create the first project.",
  icon: "◇",
  title: "No projects",
}));
assert.match(emptyStateMarkup, /^<section/u);
assert.match(emptyStateMarkup, /class="hraness-empty-state [^"]+"/u);
assert.match(emptyStateMarkup, /data-slot="empty-state"/u);
assert.match(emptyStateMarkup, /aria-hidden="true"[^>]*data-slot="empty-state-icon"/u);
assert.match(emptyStateMarkup, /<h2[^>]*data-slot="empty-state-title"[^>]*>No projects<\/h2>/u);

const inlineAlertMarkup = renderToStaticMarkup(React.createElement(InlineAlert, {
  className: "consumer-inline-alert",
  icon: "!",
  isLive: true,
  title: "Action required",
  tone: "danger",
}, "Review the failed step."));
assert.match(inlineAlertMarkup, /^<div/u);
assert.match(inlineAlertMarkup, /aria-live="assertive"/u);
assert.match(inlineAlertMarkup, /class="hraness-inline-alert [^"]+ consumer-inline-alert"/u);
assert.match(inlineAlertMarkup, /data-slot="inline-alert"/u);
assert.match(inlineAlertMarkup, /data-tone="danger"/u);
assert.match(inlineAlertMarkup, /role="alert"/u);

const settingsCardMarkup = renderToStaticMarkup(React.createElement(SettingsCard, {
  actions: React.createElement("button", { type: "button" }, "Edit"),
  description: "Visible to collaborators",
  shape: "rectangular",
  title: "Profile",
}, "Settings body"));
assert.match(settingsCardMarkup, /^<section/u);
assert.match(settingsCardMarkup, /class="hraness-settings-card [^"]+"/u);
assert.match(settingsCardMarkup, /data-shape="rectangular"/u);
assert.match(settingsCardMarkup, /data-slot="settings-card"/u);
assert.match(settingsCardMarkup, /data-slot="settings-card-header"/u);
assert.match(settingsCardMarkup, /data-slot="settings-card-body"/u);

const dataTableColumns = [
  {
    cell: (row) => row.project,
    header: "Project",
    id: "project",
  },
  {
    align: "center",
    cell: (row) => row.owner,
    header: "Owner",
    id: "owner",
  },
  {
    align: "end",
    cell: (row) => row.runs,
    header: "Runs",
    id: "runs",
  },
];
const dataTableMarkup = renderToStaticMarkup(React.createElement(DataTable, {
  "aria-describedby": "package-projects-description",
  caption: React.createElement("span", null, "Recent package projects"),
  className: "consumer-data-table",
  columns: dataTableColumns,
  "data-product": "package-smoke",
  getRowId: (row) => row.id,
  id: "package-projects",
  rows: [{ id: "ocean", owner: "Ada", project: "Ocean", runs: 3 }],
  style: { color: "rgb(1, 2, 3)", width: "42rem" },
  wrapperClassName: "consumer-data-table-wrapper",
  wrapperXstyle: dataTableWrapperXstyle,
  xstyle: dataTableXstyle,
}));
const dataTableWrapperTag = dataTableMarkup.match(/^<div[^>]*>/u)?.[0] ?? "";
const dataTableTag = dataTableMarkup.match(
  /<table[^>]*data-slot="data-table"[^>]*>/u,
)?.[0] ?? "";
const dataTableCaptionTag = dataTableMarkup.match(
  /<caption[^>]*data-slot="data-table-caption"[^>]*>/u,
)?.[0] ?? "";
const dataTableHeaderTags = [...dataTableMarkup.matchAll(
  /<th[^>]*data-slot="data-table-header"[^>]*>/gu,
)].map((match) => match[0]);
const dataTableCellTags = [...dataTableMarkup.matchAll(
  /<td[^>]*data-slot="data-table-cell"[^>]*>/gu,
)].map((match) => match[0]);
const dataTableTagClassNames = (tag) =>
  tag.match(/class="([^"]+)"/u)?.[1]?.split(/\s+/u).filter(Boolean) ?? [];
const assertDataTableRecipeClasses = (tag, keys, description) => {
  const classNames = dataTableTagClassNames(tag);
  for (const key of keys) {
    for (const className of dataTableClasses[key]) {
      assert.ok(
        classNames.includes(className),
        description + " must retain every dataTableStyles." + key + " class",
      );
    }
  }
};
assert.match(
  dataTableWrapperTag,
  /class="hraness-data-table [^"]*package-data-table-wrapper-xstyle consumer-data-table-wrapper"/u,
  "packed DataTable wrapper classes must keep stable, generated caller, and caller class order",
);
assert.match(
  dataTableTag,
  /class="hraness-data-table__table [^"]*package-data-table-xstyle consumer-data-table"/u,
  "packed DataTable table classes must keep stable, generated caller, and caller class order",
);
for (const baseClass of dataTableWrapperBaseClasses) {
  assert.ok(
    !dataTableTagClassNames(dataTableWrapperTag).includes(baseClass),
    "DataTable wrapperXstyle must replace its package max-width class",
  );
}
for (const baseClass of dataTableBaseClasses) {
  assert.ok(
    !dataTableTagClassNames(dataTableTag).includes(baseClass),
    "DataTable xstyle must replace its package width class",
  );
}
for (const className of dataTableClasses.wrapper) {
  if (!dataTableWrapperBaseClasses.includes(className)) {
    assert.ok(dataTableTagClassNames(dataTableWrapperTag).includes(className));
  }
}
for (const className of dataTableClasses.table) {
  if (!dataTableBaseClasses.includes(className)) {
    assert.ok(dataTableTagClassNames(dataTableTag).includes(className));
  }
}
assert.match(dataTableTag, /aria-describedby="package-projects-description"/u);
assert.match(dataTableTag, /data-product="package-smoke"/u);
assert.match(dataTableTag, /id="package-projects"/u);
assert.match(dataTableTag, /style="[^"]*color:rgb\(1, 2, 3\)[^"]*"/u);
assert.match(
  dataTableTag,
  /style="[^"]*width:42rem[^"]*"/u,
  "packed DataTable native table style must remain final after caller xstyle",
);
assert.match(dataTableCaptionTag, /^<caption/u);
assertDataTableRecipeClasses(dataTableCaptionTag, ["caption"], "DataTable caption");
assert.match(dataTableMarkup, /<span>Recent package projects<\/span>/u);
assert.match(dataTableMarkup, /<thead data-slot="data-table-head">/u);
assert.match(dataTableMarkup, /<tr data-slot="data-table-header-row">/u);
assert.match(dataTableMarkup, /<tbody data-slot="data-table-body">/u);
assert.match(dataTableMarkup, /<tr data-slot="data-table-row">/u);
assert.equal(dataTableHeaderTags.length, 3);
assert.equal(dataTableCellTags.length, 3);
for (const [index, alignment] of ["start", "center", "end"].entries()) {
  const alignmentKey = alignment === "start"
    ? "alignStart"
    : alignment === "center"
      ? "alignCenter"
      : "alignEnd";
  const headerTag = dataTableHeaderTags[index] ?? "";
  const cellTag = dataTableCellTags[index] ?? "";
  assert.match(headerTag, new RegExp('data-align="' + alignment + '"', "u"));
  assert.match(headerTag, /scope="col"/u);
  assert.match(cellTag, new RegExp('data-align="' + alignment + '"', "u"));
  assertDataTableRecipeClasses(
    headerTag,
    ["cell", "header", alignmentKey],
    "DataTable header",
  );
  assertDataTableRecipeClasses(
    cellTag,
    ["cell", alignmentKey],
    "DataTable cell",
  );
}
assert.match(dataTableMarkup, />Ocean</u);
assert.match(dataTableMarkup, />Ada</u);

const emptyDataTableMarkup = renderToStaticMarkup(React.createElement(DataTable, {
  columns: dataTableColumns,
  empty: React.createElement("strong", null, "No package projects"),
  getRowId: (row) => row.id,
  rows: [],
}));
const emptyDataTableRowTag = emptyDataTableMarkup.match(
  /<tr[^>]*data-slot="data-table-empty-row"[^>]*>/u,
)?.[0] ?? "";
const emptyDataTableCellTag = emptyDataTableMarkup.match(
  /<td[^>]*data-slot="data-table-empty"[^>]*>/u,
)?.[0] ?? "";
assert.match(emptyDataTableRowTag, /^<tr/u);
assert.match(
  emptyDataTableCellTag,
  /class="hraness-data-table__empty [^"]+"/u,
  "packed empty DataTable must keep its stable hook before generated classes",
);
assert.match(emptyDataTableCellTag, /col[Ss]pan="3"/u);
assert.doesNotMatch(emptyDataTableCellTag, /data-align=/u);
assertDataTableRecipeClasses(
  emptyDataTableCellTag,
  ["cell", "empty"],
  "empty DataTable cell",
);
assert.match(emptyDataTableMarkup, /<strong>No package projects<\/strong>/u);

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

const progressMarkup = renderToStaticMarkup(React.createElement(ProgressBar, {
  className: "consumer-progress",
  label: "Upload",
  showValue: true,
  style: { width: "15rem" },
  value: 35,
  xstyle: indicatorRootXstyle,
}));
const progressTag = progressMarkup.match(/^<div[^>]*>/u)?.[0] ?? "";
assert.match(progressTag, /class="hraness-progress-bar [^"]*package-indicator-root-xstyle consumer-progress"/u);
assert.match(progressTag, /data-slot="progress-bar"/u);
assert.match(progressTag, /role="progressbar"/u);
assert.match(progressTag, /style="width:15rem"/u);
assert.match(progressMarkup, /data-slot="progress-bar-label"/u);
assert.match(progressMarkup, /data-slot="progress-bar-value"/u);
assert.match(progressMarkup, /data-slot="progress-bar-track"/u);
assert.match(progressMarkup, /data-slot="progress-bar-fill"/u);
assert.match(progressMarkup, /--hraness-percentage:35%;width:35%/u);
for (const baseClass of indicatorRootBaseClasses) {
  assert.ok(!progressTag.split(/[\s"]/u).includes(baseClass));
}

const indeterminateMarkup = renderToStaticMarkup(React.createElement(ProgressBar, {
  isIndeterminate: true,
  label: "Loading",
}));
assert.match(indeterminateMarkup, /data-indeterminate="true"/u);
assert.match(indeterminateMarkup, /--hraness-percentage:0%;width:0%/u);

const meterMarkup = renderToStaticMarkup(React.createElement(Meter, {
  className: "consumer-meter",
  label: "Storage",
  maxValue: 100,
  style: ({ percentage }) => ({ width: percentage === 68 ? "16rem" : "14rem" }),
  tone: "warning",
  value: 68,
  xstyle: indicatorRootXstyle,
}));
const meterTag = meterMarkup.match(/^<div[^>]*>/u)?.[0] ?? "";
assert.match(meterTag, /class="hraness-meter [^"]*package-indicator-root-xstyle consumer-meter"/u);
assert.match(meterTag, /data-slot="meter"/u);
assert.match(meterTag, /data-tone="warning"/u);
assert.match(meterTag, /role="meter progressbar"/u);
assert.match(meterTag, /style="width:16rem"/u);
assert.match(meterMarkup, /--hraness-percentage:68%;width:68%/u);

const sliderMarkup = renderToStaticMarkup(React.createElement(Slider, {
  className: "consumer-slider",
  defaultValue: 42,
  label: "Gain",
  name: "gain",
  orientation: "vertical",
  style: { minHeight: "14rem" },
  thumbLabel: "Gain level",
  xstyle: indicatorRootXstyle,
}));
const sliderTag = sliderMarkup.match(/^<div[^>]*>/u)?.[0] ?? "";
assert.match(sliderTag, /class="hraness-slider [^"]*package-indicator-root-xstyle consumer-slider"/u);
assert.match(sliderTag, /data-orientation="vertical"/u);
assert.match(sliderTag, /data-slot="slider"/u);
assert.match(sliderTag, /style="min-height:14rem"/u);
assert.match(sliderMarkup, /data-slot="slider-track"/u);
assert.match(sliderMarkup, /data-slot="slider-fill"/u);
assert.match(sliderMarkup, /data-slot="slider-thumb"/u);
assert.match(sliderMarkup, /data-slot="slider-thumb-indicator"/u);
assert.match(sliderMarkup, /aria-label="Gain level"/u);
const sliderInputTag = sliderMarkup.match(/<input\b[^>]*>/u)?.[0] ?? "";
assert.match(sliderInputTag, /(?:^|\s)name="gain"(?:\s|\/?>)/u);
assert.match(sliderInputTag, /(?:^|\s)type="range"(?:\s|\/?>)/u);

const knobMarkup = renderToStaticMarkup(React.createElement(Knob, {
  className: "consumer-knob",
  controlClassName: "consumer-knob-control",
  controlXstyle: knobControlXstyle,
  defaultValue: 64,
  density: "compact",
  label: "Drive",
  name: "drive",
  style: { width: "9rem" },
  touchPan: "horizontal",
  xstyle: knobRootXstyle,
}));
const knobTag = knobMarkup.match(/^<div[^>]*>/u)?.[0] ?? "";
const knobControlTag = knobMarkup.match(/<div[^>]*data-slot="knob-control"[^>]*>/u)?.[0] ?? "";
const knobThumbTag = knobMarkup.match(/<div[^>]*data-slot="knob-thumb"[^>]*>/u)?.[0] ?? "";
assert.match(knobTag, /class="hraness-knob [^"]*package-knob-root-xstyle consumer-knob"/u);
assert.match(knobTag, /data-density="compact"/u);
assert.match(knobTag, /data-slot="knob"/u);
assert.match(knobTag, /style="width:9rem"/u);
assert.match(knobControlTag, /class="hraness-knob__control [^"]*package-knob-control-xstyle consumer-knob-control"/u);
assert.match(knobControlTag, /touch-action:pan-x/u);
assert.match(knobThumbTag, /height:100%/u);
assert.match(knobThumbTag, /left:0/u);
assert.match(knobThumbTag, /position:absolute/u);
assert.match(knobThumbTag, /touch-action:none/u);
assert.match(knobThumbTag, /transform:none/u);
assert.match(knobThumbTag, /width:100%/u);
assert.match(knobMarkup, /data-slot="knob-dial"/u);
assert.match(knobMarkup, /data-slot="knob-gesture"/u);
const knobInputTag = knobMarkup.match(/<input\b[^>]*>/u)?.[0] ?? "";
assert.match(knobInputTag, /(?:^|\s)name="drive"(?:\s|\/?>)/u);
assert.match(knobInputTag, /(?:^|\s)type="range"(?:\s|\/?>)/u);
for (const baseClass of knobRootBaseClasses) {
  assert.ok(!knobTag.split(/[\s"]/u).includes(baseClass));
}
for (const baseClass of knobControlBaseClasses) {
  assert.ok(!knobControlTag.split(/[\s"]/u).includes(baseClass));
}
for (const focusClass of knobControlNativeFocusClasses) {
  assert.ok(
    !knobControlTag.split(/[\s"]/u).includes(focusClass),
    "Knob controlXstyle must suppress its native focus fallback",
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
assert.match(formTag, /no[Vv]alidate=""/u);
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

const textFieldMarkup = renderToStaticMarkup(React.createElement(TextField, {
  className: "consumer-text-field",
  controlXstyle: fieldControlXstyle,
  defaultValue: "Ada",
  label: "Display name",
  name: "display-name",
  xstyle: fieldRootXstyle,
}));
const textFieldRootTag = textFieldMarkup.match(/^<div[^>]*>/u)?.[0] ?? "";
const textFieldControlTag = textFieldMarkup.match(/<div[^>]*data-slot="field-control"[^>]*>/u)?.[0] ?? "";
assert.match(textFieldRootTag, /class="hraness-field hraness-text-field [^"]*package-field-root-xstyle consumer-text-field"/u);
assert.match(textFieldControlTag, /class="hraness-field__control [^"]*package-field-control-xstyle"/u);
assert.match(textFieldMarkup, /<input[^>]*name="display-name"[^>]*value="Ada"/u);
for (const baseClass of fieldRootBaseClasses) {
  assert.ok(!textFieldRootTag.split(/[\s"]/u).includes(baseClass));
}
for (const baseClass of fieldControlBaseClasses) {
  assert.ok(!textFieldControlTag.split(/[\s"]/u).includes(baseClass));
}

const textAreaMarkup = renderToStaticMarkup(React.createElement(TextAreaField, {
  className: "consumer-text-area-field",
  controlXstyle: fieldControlXstyle,
  defaultValue: "Notes",
  label: "Notes",
  name: "notes",
  resize: "vertical",
  textAreaProps: { style: { resize: "both" } },
  textAreaXstyle: fieldTextAreaXstyle,
  xstyle: fieldRootXstyle,
}));
const textAreaRootTag = textAreaMarkup.match(/^<div[^>]*>/u)?.[0] ?? "";
const textAreaTag = textAreaMarkup.match(/<textarea[^>]*data-slot="field-textarea"[^>]*>/u)?.[0] ?? "";
assert.match(textAreaRootTag, /data-resize="vertical"/u);
assert.match(textAreaRootTag, /package-field-root-xstyle/u);
assert.match(textAreaTag, /package-field-textarea-xstyle/u);
assert.match(textAreaTag, /style="resize:both"/u);
assert.match(textAreaMarkup, />Notes<\/textarea>/u);
for (const baseClass of fieldTextAreaBaseClasses) {
  assert.ok(
    !textAreaTag.split(/[\s"]/u).includes(baseClass),
    "TextAreaField textAreaXstyle must replace its package resize class",
  );
}

const checkboxGroupMarkup = renderToStaticMarkup(React.createElement(CheckboxGroup, {
  className: "consumer-checkbox-group",
  defaultValue: ["digest"],
  label: "Notifications",
  name: "notifications",
  optionsClassName: "consumer-checkbox-options",
  optionsXstyle: fieldOptionsXstyle,
  xstyle: fieldRootXstyle,
}, React.createElement(CheckboxField, {
  label: "Weekly digest",
  value: "digest",
})));
const checkboxGroupOptionsTag = checkboxGroupMarkup.match(
  /<div[^>]*class="hraness-checkbox-group__options[^"]*"[^>]*>/u,
)?.[0] ?? "";
assert.match(checkboxGroupMarkup, /data-slot="checkbox-group"/u);
assert.match(checkboxGroupOptionsTag, /package-field-options-xstyle/u);
assert.match(checkboxGroupOptionsTag, /consumer-checkbox-options/u);
for (const baseClass of fieldOptionsBaseClasses) {
  assert.ok(
    !checkboxGroupOptionsTag.split(/[\s"]/u).includes(baseClass),
    "CheckboxGroup optionsXstyle must replace its package options property class",
  );
}

const radioGroupMarkup = renderToStaticMarkup(React.createElement(RadioGroup, {
  defaultValue: "daily",
  label: "Cadence",
  name: "cadence",
}, React.createElement(RadioOption, {
  label: "Daily",
  value: "daily",
})));
const radioControlTag = radioGroupMarkup.match(
  /<label[^>]*data-slot="radio-control"[^>]*>/u,
)?.[0] ?? "";
assert.ok(
  radioSwitchNativeFocusClasses.every(
    (className) => radioControlTag.split(/[\s"]/u).includes(className),
  ),
  "packed RadioOption must bind every native focus fallback class",
);

const switchMarkup = renderToStaticMarkup(React.createElement(SwitchField, {
  defaultSelected: true,
  label: "Email alerts",
  name: "email-alerts",
}));
const switchControlTag = switchMarkup.match(
  /<label[^>]*data-slot="switch-control"[^>]*>/u,
)?.[0] ?? "";
assert.ok(
  radioSwitchNativeFocusClasses.every(
    (className) => switchControlTag.split(/[\s"]/u).includes(className),
  ),
  "packed SwitchField must bind every native focus fallback class",
);

const nativeSelectMarkup = renderToStaticMarkup(React.createElement(NativeSelectField, {
  controlXstyle: fieldControlXstyle,
  label: "Native choice",
  name: "native-choice",
  options: [
    { id: "alpha", label: "Alpha" },
    { disabled: true, id: "beta", label: "Beta" },
  ],
  value: "alpha",
  xstyle: fieldRootXstyle,
}));
assert.match(nativeSelectMarkup, /data-slot="native-select-field"/u);
assert.match(nativeSelectMarkup, /<select[^>]*name="native-choice"[^>]*>/u);
assert.match(nativeSelectMarkup, /<option value="alpha" selected="">Alpha<\/option>/u);
assert.match(nativeSelectMarkup, /<option disabled="" value="beta">Beta<\/option>/u);

const fileFieldMarkup = renderToStaticMarkup(React.createElement(FileField, {
  controlXstyle: fieldControlXstyle,
  label: "Attachment",
  name: "attachment",
  xstyle: fieldRootXstyle,
}));
assert.match(fileFieldMarkup, /data-slot="file-field"/u);
const fileInputTag = fileFieldMarkup.match(
  /<input[^>]*data-slot="field-file"[^>]*>/u,
)?.[0] ?? "";
assert.match(fileInputTag, /(?:^|\s)name="attachment"(?:\s|\/?>)/u);
assert.match(fileInputTag, /(?:^|\s)type="file"(?:\s|\/?>)/u);

const selectFieldMarkup = renderToStaticMarkup(React.createElement(SelectField, {
  label: "Styled choice",
  name: "styled-choice",
  options: [{ id: "alpha", label: "Alpha", textValue: "Alpha" }],
  triggerXstyle: selectTriggerXstyle,
  value: "alpha",
  xstyle: fieldRootXstyle,
}));
const selectTriggerTag = selectFieldMarkup.match(/<button[^>]*class="hraness-select-field__trigger[^"]*"[^>]*>/u)?.[0] ?? "";
assert.match(selectFieldMarkup, /data-slot="select-field"/u);
assert.match(selectTriggerTag, /package-select-trigger-xstyle/u);
for (const baseClass of selectTriggerBaseClasses) {
  assert.ok(!selectTriggerTag.split(/[\s"]/u).includes(baseClass));
}
assert.ok(
  selectNativeInteractionClasses.every(
    (className) => !selectTriggerTag.split(/[\s"]/u).includes(className),
  ),
  "caller triggerXstyle must suppress SelectField native interaction fallbacks",
);

const nativeFocusSelectMarkup = renderToStaticMarkup(React.createElement(SelectField, {
  label: "Native focus choice",
  name: "native-focus-choice",
  options: [{ id: "alpha", label: "Alpha", textValue: "Alpha" }],
  value: "alpha",
}));
const nativeFocusSelectTriggerTag = nativeFocusSelectMarkup.match(
  /<button[^>]*class="hraness-select-field__trigger[^"]*"[^>]*>/u,
)?.[0] ?? "";
assert.ok(
  selectNativeInteractionClasses.every(
    (className) => nativeFocusSelectTriggerTag.split(/[\s"]/u).includes(className),
  ),
  "packed SelectField must bind every native focus fallback class without a caller triggerXstyle",
);

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
  CheckboxGroup,
  CheckboxField,
  DataTable,
  type DataTableColumn,
  type DataTableProps,
  EmptyState,
  FileField,
  Form,
  Icon,
  InlineAlert,
  KeyHint,
  Knob,
  Link,
  Meter,
  NativeSelectField,
  PageIntro,
  PressableCard,
  ProgressBar,
  QuietSiteFooter,
  QuietSitePage,
  RadioGroup,
  RadioOption,
  SocialIcon,
  StatusDot,
  SelectField,
  Slider,
  SettingsCard,
  Tag,
  ThemedSurface,
  Toolbar,
  SwitchField,
  TextAreaField,
  TextField,
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
  content: {
    backgroundColor: "var(--ui-secondary)",
    borderColor: "var(--ui-primary)",
    display: "flex",
  },
  dataTable: {
    borderCollapse: "separate",
    color: "var(--ui-primary)",
    width: "80%",
  },
  dataTableDynamic: (width: string) => ({ width }),
  dataTableWrapper: {
    borderColor: "var(--ui-primary)",
    maxWidth: "60rem",
    overflowX: "scroll",
  },
  dataTableWrapperDynamic: (maxWidth: string) => ({ maxWidth }),
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
  indicator: {
    color: "var(--ui-primary)",
    display: "flex",
  },
  knob: {
    color: "var(--ui-primary)",
    display: "flex",
  },
  knobControl: {
    backgroundColor: "var(--ui-secondary)",
    cursor: "crosshair",
  },
  field: {
    color: "var(--ui-primary)",
    display: "grid",
  },
  fieldControl: {
    backgroundColor: "var(--ui-secondary)",
    borderColor: "var(--ui-primary)",
  },
  fieldOptions: {
    display: "flex",
    gap: "var(--space-4)",
  },
  fieldTextArea: {
    resize: "both",
  },
  selectTrigger: {
    backgroundColor: "var(--ui-secondary)",
    borderColor: "var(--ui-primary)",
  },
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
const pageIntroRef = createRef<HTMLElement>();
const pageIntroMarkup: string = renderToStaticMarkup(createElement(PageIntro, {
  actions: createElement("button", { type: "button" }, "Create"),
  className: "consumer-page-intro",
  description: "Package content overview",
  eyebrow: "Workspace",
  ref: pageIntroRef,
  style: { maxWidth: "50rem" },
  title: "Projects",
  titleAs: "h3",
  xstyle: styles.content,
}));
const emptyStateRef = createRef<HTMLElement>();
const emptyStateMarkup: string = renderToStaticMarkup(createElement(EmptyState, {
  action: createElement("button", { type: "button" }, "Add project"),
  description: "Create the first project.",
  icon: "◇",
  ref: emptyStateRef,
  title: "No projects",
  xstyle: styles.content,
}));
const inlineAlertRef = createRef<HTMLDivElement>();
const inlineAlertMarkup: string = renderToStaticMarkup(createElement(InlineAlert, {
  children: "Review the failed step.",
  className: "consumer-inline-alert",
  isLive: true,
  ref: inlineAlertRef,
  title: "Action required",
  tone: "danger",
  xstyle: styles.content,
}));
const settingsCardRef = createRef<HTMLElement>();
const settingsCardMarkup: string = renderToStaticMarkup(createElement(SettingsCard, {
  actions: createElement("button", { type: "button" }, "Edit"),
  children: "Settings body",
  description: "Visible to collaborators",
  ref: settingsCardRef,
  shape: "rectangular",
  title: "Profile",
  xstyle: styles.content,
}));
type PackageDataTableRow = Readonly<{
  id: string;
  owner: string;
  project: string;
  runs: number;
}>;
const packageDataTableColumns = [
  {
    cell: (row) => row.project,
    header: "Project",
    id: "project",
  },
  {
    align: "center",
    cell: (row) => row.owner,
    header: "Owner",
    id: "owner",
  },
  {
    align: "end",
    cell: (row) => row.runs,
    header: "Runs",
    id: "runs",
  },
] as const satisfies readonly [
  DataTableColumn<PackageDataTableRow>,
  ...DataTableColumn<PackageDataTableRow>[],
];
const packageDataTableProps: DataTableProps<PackageDataTableRow> = {
  caption: "Recent projects",
  columns: packageDataTableColumns,
  getRowId: (row) => row.id,
  rows: [{ id: "ocean", owner: "Ada", project: "Ocean", runs: 3 }],
  style: { width: "42rem" },
  wrapperXstyle: [
    styles.dataTableWrapper,
    styles.dataTableWrapperDynamic("40rem"),
  ],
  xstyle: [styles.dataTable, styles.dataTableDynamic("41rem")],
};
const packageDataTableRef = createRef<HTMLTableElement>();
const TypedPackageDataTable = DataTable<PackageDataTableRow>;
const dataTableMarkup: string = renderToStaticMarkup(createElement(
  TypedPackageDataTable,
  { ...packageDataTableProps, ref: packageDataTableRef },
));
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
const progressRef = createRef<HTMLDivElement>();
const progressMarkup: string = renderToStaticMarkup(createElement(ProgressBar, {
  className: "consumer-progress",
  label: "Upload",
  progressRef,
  showValue: true,
  style: ({ percentage }) => ({ width: percentage === 35 ? "15rem" : "14rem" }),
  value: 35,
  xstyle: styles.indicator,
}));
const meterRef = createRef<HTMLDivElement>();
const meterMarkup: string = renderToStaticMarkup(createElement(Meter, {
  className: "consumer-meter",
  label: "Storage",
  meterRef,
  tone: "warning",
  value: 68,
  xstyle: styles.indicator,
}));
const sliderRef = createRef<HTMLDivElement>();
const sliderMarkup: string = renderToStaticMarkup(createElement(Slider, {
  className: "consumer-slider",
  defaultValue: 42,
  label: "Gain",
  name: "gain",
  orientation: "vertical",
  sliderRef,
  thumbLabel: "Gain level",
  xstyle: styles.indicator,
}));
const knobRef = createRef<HTMLDivElement>();
const knobMarkup: string = renderToStaticMarkup(createElement(Knob, {
  className: "consumer-knob",
  controlClassName: "consumer-knob-control",
  controlXstyle: styles.knobControl,
  defaultValue: 64,
  density: "compact",
  label: "Drive",
  name: "drive",
  ref: knobRef,
  style: ({ orientation }) => ({ width: orientation === "horizontal" ? "9rem" : "8rem" }),
  touchPan: "horizontal",
  xstyle: styles.knob,
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
const textFieldMarkup: string = renderToStaticMarkup(createElement(TextField, {
  controlXstyle: styles.fieldControl,
  defaultValue: "Ada",
  label: "Display name",
  name: "display-name",
  xstyle: styles.field,
}));
const textAreaMarkup: string = renderToStaticMarkup(createElement(TextAreaField, {
  controlXstyle: styles.fieldControl,
  defaultValue: "Notes",
  label: "Notes",
  name: "notes",
  resize: "vertical",
  textAreaProps: { style: { resize: "both" } },
  textAreaXstyle: styles.fieldTextArea,
  xstyle: styles.field,
}));
const checkboxGroupMarkup: string = renderToStaticMarkup(createElement(CheckboxGroup, {
  children: createElement(CheckboxField, {
    label: "Weekly digest",
    value: "digest",
  }),
  defaultValue: ["digest"],
  label: "Notifications",
  name: "notifications",
  optionsXstyle: styles.fieldOptions,
  xstyle: styles.field,
}));
const radioGroupMarkup: string = renderToStaticMarkup(createElement(RadioGroup, {
  children: createElement(RadioOption, {
    label: "Daily",
    value: "daily",
  }),
  defaultValue: "daily",
  label: "Cadence",
  name: "cadence",
}));
const switchMarkup: string = renderToStaticMarkup(createElement(SwitchField, {
  defaultSelected: true,
  label: "Email alerts",
  name: "email-alerts",
}));
const nativeSelectMarkup: string = renderToStaticMarkup(createElement(NativeSelectField, {
  controlXstyle: styles.fieldControl,
  label: "Native choice",
  name: "native-choice",
  options: [{ id: "alpha", label: "Alpha" }] as const,
  value: "alpha",
  xstyle: styles.field,
}));
const fileFieldMarkup: string = renderToStaticMarkup(createElement(FileField, {
  controlXstyle: styles.fieldControl,
  label: "Attachment",
  name: "attachment",
  xstyle: styles.field,
}));
const selectFieldMarkup: string = renderToStaticMarkup(createElement(SelectField, {
  label: "Styled choice",
  name: "styled-choice",
  options: [{ id: "alpha", label: "Alpha", textValue: "Alpha" }] as const,
  triggerXstyle: styles.selectTrigger,
  value: "alpha",
  xstyle: styles.field,
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
// @ts-expect-error InlineAlert keeps its tone set finite.
const invalidInlineAlertToneMarkup = renderToStaticMarkup(createElement(InlineAlert, { children: "Alert", tone: "accent" }));
// @ts-expect-error SettingsCard keeps its shape set finite.
const invalidSettingsCardShapeMarkup = renderToStaticMarkup(createElement(SettingsCard, { shape: "pill", title: "Settings" }));
// @ts-expect-error Content roots accept compiled StyleX recipes rather than raw CSS objects.
const invalidContentXstyleMarkup = renderToStaticMarkup(createElement(PageIntro, { title: "Projects", xstyle: { display: "flex" } }));
const invalidDataTableAlignmentColumn: DataTableColumn<PackageDataTableRow> = {
  // @ts-expect-error DataTable keeps its alignment set finite and logical.
  align: "right",
  cell: (row) => row.project,
  header: "Project",
  id: "project",
};
const invalidDataTableRows: DataTableProps<PackageDataTableRow> = {
  ...packageDataTableProps,
  rows: [{
    id: "invalid",
    owner: "Ada",
    project: "Invalid",
    // @ts-expect-error DataTable rows preserve their declared generic row type.
    runs: "3",
  }],
};
const invalidDataTableRefMarkup = createElement(TypedPackageDataTable, {
  ...packageDataTableProps,
  // @ts-expect-error DataTable forwards only a native HTMLTableElement ref.
  ref: createRef<HTMLDivElement>(),
});
const invalidDataTableXstyle: DataTableProps<PackageDataTableRow> = {
  ...packageDataTableProps,
  // @ts-expect-error DataTable accepts compiled StyleX recipes, not raw table CSS.
  xstyle: { width: "80%" },
};
const invalidDataTableWrapperXstyle: DataTableProps<PackageDataTableRow> = {
  ...packageDataTableProps,
  // @ts-expect-error DataTable accepts compiled StyleX recipes, not raw wrapper CSS.
  wrapperXstyle: { overflowX: "scroll" },
};
// @ts-expect-error AskAiAboutThis requires one explicit canonical HTTPS URL.
const missingAskAiUrlMarkup = renderToStaticMarkup(createElement(AskAiAboutThis, {}));
// @ts-expect-error CheckboxField requires a label even when visible copy is hidden.
const unnamedCheckboxMarkup = renderToStaticMarkup(createElement(CheckboxField, { showLabel: false }));
// @ts-expect-error CheckboxField has one stable target size and no compact API.
const compactCheckboxMarkup = renderToStaticMarkup(createElement(CheckboxField, { compact: true, label: "Compact" }));
// @ts-expect-error Form accepts compiled StyleX recipes rather than raw CSS objects.
const invalidFormXstyleMarkup = renderToStaticMarkup(createElement(Form, { xstyle: { display: "flex" } }));
// @ts-expect-error Meter keeps its tone set finite.
const invalidMeterToneMarkup = renderToStaticMarkup(createElement(Meter, { label: "Meter", tone: "info" }));
// @ts-expect-error Slider keeps its orientation set finite.
const invalidSliderOrientationMarkup = renderToStaticMarkup(createElement(Slider, { label: "Slider", orientation: "diagonal" }));
// @ts-expect-error Indicator roots accept compiled StyleX recipes rather than raw CSS objects.
const invalidIndicatorXstyleMarkup = renderToStaticMarkup(createElement(ProgressBar, { label: "Progress", xstyle: { display: "flex" } }));
// @ts-expect-error Knob keeps its density set finite.
const invalidKnobDensityMarkup = renderToStaticMarkup(createElement(Knob, { defaultValue: 0, density: "dense", label: "Knob" }));
// @ts-expect-error Knob controls accept compiled StyleX recipes rather than raw CSS objects.
const invalidKnobControlXstyleMarkup = renderToStaticMarkup(createElement(Knob, { controlXstyle: { cursor: "grab" }, defaultValue: 0, label: "Knob" }));

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
void pageIntroMarkup;
void emptyStateMarkup;
void inlineAlertMarkup;
void settingsCardMarkup;
void dataTableMarkup;
void linkMarkup;
void progressMarkup;
void meterMarkup;
void sliderMarkup;
void knobMarkup;
void checkboxMarkup;
void textFieldMarkup;
void textAreaMarkup;
void checkboxGroupMarkup;
void radioGroupMarkup;
void switchMarkup;
void nativeSelectMarkup;
void fileFieldMarkup;
void selectFieldMarkup;
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
void invalidInlineAlertToneMarkup;
void invalidSettingsCardShapeMarkup;
void invalidContentXstyleMarkup;
void invalidDataTableAlignmentColumn;
void invalidDataTableRows;
void invalidDataTableRefMarkup;
void invalidDataTableXstyle;
void invalidDataTableWrapperXstyle;
void missingAskAiUrlMarkup;
void unnamedCheckboxMarkup;
void compactCheckboxMarkup;
void invalidFormXstyleMarkup;
void invalidMeterToneMarkup;
void invalidSliderOrientationMarkup;
void invalidIndicatorXstyleMarkup;
void invalidKnobDensityMarkup;
void invalidKnobControlXstyleMarkup;
`;

function viteClientProbe(
  contentProbe: ContentPrecedenceProbe,
  dataTableProbe: PackageDataTableProbe,
): string {
  return `import "@hraness/ui/styles.css";
import { AskAiAboutThis, Card, CardDescription, CheckboxField, DataTable, EmptyState, FileField, Form, InlineAlert, KeyHint, Knob, Link, Meter, NativeSelectField, PageIntro, PressableCard, ProgressBar, SelectField, SettingsCard, Slider, TextField, Toolbar } from "@hraness/ui";
import * as React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (root === null) throw new Error("Vite package smoke root is missing");
const contentRootXstyle = {
  ${JSON.stringify(contentProbe.rootProperty)}: "vite-content-root-xstyle",
  $$css: true,
};
const contentRootBaseClasses = ${JSON.stringify(contentProbe.rootBaseClasses)};
const dataTableXstyle = {
  ${JSON.stringify(dataTableProbe.tableProperty)}: "vite-data-table-xstyle",
  $$css: true,
};
const dataTableWrapperXstyle = {
  ${JSON.stringify(dataTableProbe.wrapperProperty)}: "vite-data-table-wrapper-xstyle",
  $$css: true,
};
const dataTableBaseClasses = ${JSON.stringify(dataTableProbe.tableBaseClasses)};
const dataTableWrapperBaseClasses = ${JSON.stringify(dataTableProbe.wrapperBaseClasses)};
const reactRoot = createRoot(root);
flushSync(() => reactRoot.render(React.createElement(React.Fragment, null,
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
  React.createElement(PageIntro, {
    className: "vite-content-root-class",
    style: { display: "inline-block" },
    title: "Vite projects",
    xstyle: contentRootXstyle,
  }),
  React.createElement(DataTable, {
    caption: "Vite projects",
    className: "vite-data-table-class",
    columns: [
      { cell: (row) => row.project, header: "Project", id: "project" },
      { align: "end", cell: (row) => row.runs, header: "Runs", id: "runs" },
    ],
    getRowId: (row) => row.id,
    rows: [{ id: "ocean", project: "Ocean", runs: 3 }],
    style: { width: "42rem" },
    wrapperClassName: "vite-data-table-wrapper-class",
    wrapperXstyle: dataTableWrapperXstyle,
    xstyle: dataTableXstyle,
  }),
  React.createElement(EmptyState, { title: "No Vite projects" }),
  React.createElement(InlineAlert, { tone: "success" }, "Vite is ready"),
  React.createElement(SettingsCard, { title: "Vite settings" }, "Settings body"),
  React.createElement(AskAiAboutThis, { url: "https://hraness.com/stripe" }),
  React.createElement(Link, { href: "/reference" }, "Reference"),
  React.createElement(ProgressBar, { label: "Vite progress", value: 35 }),
  React.createElement(Meter, { label: "Vite meter", tone: "success", value: 68 }),
  React.createElement(Slider, { defaultValue: 42, label: "Vite gain", name: "vite-gain" }),
  React.createElement(Knob, { defaultValue: 64, label: "Vite drive", name: "vite-drive" }),
  React.createElement(CheckboxField, {
    label: "Vite checkbox",
    name: "vite-checkbox",
    showLabel: false,
  }),
  React.createElement(TextField, {
    defaultValue: "Ada",
    label: "Display name",
    name: "display-name",
  }),
  React.createElement(NativeSelectField, {
    label: "Native choice",
    name: "native-choice",
    options: [{ id: "alpha", label: "Alpha" }],
    value: "alpha",
  }),
  React.createElement(FileField, {
    label: "Attachment",
    name: "attachment",
  }),
  React.createElement(SelectField, {
    label: "Styled choice",
    name: "styled-choice",
    options: [{ id: "alpha", label: "Alpha", textValue: "Alpha" }],
    value: "alpha",
  }),
  React.createElement(Form, {
    action: "/preferences",
    method: "post",
    onSubmit: (event) => event.preventDefault(),
  }, React.createElement("button", { type: "button" }, "Save locally")),
)));
const contentRoot = root.querySelector('[data-slot="page-intro"]');
if (!(contentRoot instanceof HTMLElement)) {
  throw new Error("Vite client content precedence probe is missing");
}
if (!contentRoot.classList.contains("vite-content-root-xstyle")) {
  throw new Error("Vite client Content caller xstyle did not reach the rendered root");
}
if (contentRootBaseClasses.some((className) => contentRoot.classList.contains(className))) {
  throw new Error("Vite client Content caller xstyle did not replace the base display class");
}
if (contentRoot.style.display !== "inline-block") {
  throw new Error("Vite client Content native style did not win last");
}
const dataTable = root.querySelector('[data-slot="data-table"]');
const dataTableWrapper = root.querySelector('[data-slot="data-table-wrapper"]');
if (!(dataTable instanceof HTMLTableElement) || !(dataTableWrapper instanceof HTMLElement)) {
  throw new Error("Vite client DataTable semantic roots are missing");
}
if (
  !dataTable.classList.contains("vite-data-table-xstyle")
  || !dataTable.classList.contains("vite-data-table-class")
  || !dataTableWrapper.classList.contains("vite-data-table-wrapper-xstyle")
  || !dataTableWrapper.classList.contains("vite-data-table-wrapper-class")
) {
  throw new Error("Vite client DataTable caller class order is missing");
}
if (dataTableBaseClasses.some((className) => dataTable.classList.contains(className))) {
  throw new Error("Vite client DataTable xstyle did not replace the base width class");
}
if (dataTableWrapperBaseClasses.some(
  (className) => dataTableWrapper.classList.contains(className),
)) {
  throw new Error("Vite client DataTable wrapperXstyle did not replace the base max-width class");
}
if (dataTable.style.width !== "42rem") {
  throw new Error("Vite client DataTable native table style did not win last");
}
if (
  dataTable.querySelectorAll('[data-slot="data-table-header"]').length !== 2
  || dataTable.querySelectorAll('[data-slot="data-table-cell"]').length !== 2
  || dataTable.querySelector('[data-align="end"]') === null
) {
  throw new Error("Vite client DataTable native semantics are missing");
}
`;
}

function viteSsrProbe(
  checkboxProbe: CheckboxPrecedenceProbe,
  contentProbe: ContentPrecedenceProbe,
  dataTableProbe: PackageDataTableProbe,
  fieldSelectProbe: PackageFieldSelectProbe,
  formProbe: FormPrecedenceProbe,
  indicatorKnobProbe: PackageIndicatorKnobProbe,
  linkProbe: LinkPrecedenceProbe,
  visuallyHiddenClasses: readonly string[],
): string {
  return `import assert from "node:assert/strict";
import { CheckboxField, DataTable, EmptyState, Form, InlineAlert, Knob, Link, Meter, NativeSelectField, PageIntro, ProgressBar, SelectField, SettingsCard, Slider, TextField } from "@hraness/ui";
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
const contentRootXstyle = {
  ${JSON.stringify(contentProbe.rootProperty)}: "vite-content-root-xstyle",
  $$css: true,
};
const contentRootBaseClasses = ${JSON.stringify(contentProbe.rootBaseClasses)};
const dataTableXstyle = {
  ${JSON.stringify(dataTableProbe.tableProperty)}: "vite-data-table-xstyle",
  $$css: true,
};
const dataTableWrapperXstyle = {
  ${JSON.stringify(dataTableProbe.wrapperProperty)}: "vite-data-table-wrapper-xstyle",
  $$css: true,
};
const dataTableBaseClasses = ${JSON.stringify(dataTableProbe.tableBaseClasses)};
const dataTableWrapperBaseClasses = ${JSON.stringify(dataTableProbe.wrapperBaseClasses)};
const fieldRootXstyle = {
  ${JSON.stringify(fieldSelectProbe.fieldRootProperty)}: "vite-field-root-xstyle",
  $$css: true,
};
const fieldControlXstyle = {
  ${JSON.stringify(fieldSelectProbe.fieldControlProperty)}: "vite-field-control-xstyle",
  $$css: true,
};
const selectTriggerXstyle = {
  ${JSON.stringify(fieldSelectProbe.selectTriggerProperty)}: "vite-select-trigger-xstyle",
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
const indicatorRootXstyle = {
  ${JSON.stringify(indicatorKnobProbe.indicatorRootProperty)}: "vite-indicator-root-xstyle",
  $$css: true,
};
const knobRootXstyle = {
  ${JSON.stringify(indicatorKnobProbe.knobRootProperty)}: "vite-knob-root-xstyle",
  $$css: true,
};
const knobControlXstyle = {
  ${JSON.stringify(indicatorKnobProbe.knobControlProperty)}: "vite-knob-control-xstyle",
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
const textFieldMarkup = renderToStaticMarkup(React.createElement(TextField, {
  controlXstyle: fieldControlXstyle,
  defaultValue: "Ada",
  label: "Display name",
  name: "display-name",
  xstyle: fieldRootXstyle,
}));
assert.match(textFieldMarkup, /vite-field-root-xstyle/u);
assert.match(textFieldMarkup, /vite-field-control-xstyle/u);
assert.match(textFieldMarkup, /name="display-name"/u);
const nativeSelectMarkup = renderToStaticMarkup(React.createElement(NativeSelectField, {
  controlXstyle: fieldControlXstyle,
  label: "Native choice",
  name: "native-choice",
  options: [{ id: "alpha", label: "Alpha" }],
  value: "alpha",
  xstyle: fieldRootXstyle,
}));
assert.match(nativeSelectMarkup, /<select[^>]*name="native-choice"/u);
assert.match(nativeSelectMarkup, /value="alpha" selected=""/u);
const selectFieldMarkup = renderToStaticMarkup(React.createElement(SelectField, {
  label: "Styled choice",
  name: "styled-choice",
  options: [{ id: "alpha", label: "Alpha", textValue: "Alpha" }],
  triggerXstyle: selectTriggerXstyle,
  value: "alpha",
  xstyle: fieldRootXstyle,
}));
assert.match(selectFieldMarkup, /vite-select-trigger-xstyle/u);
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
assert.match(formTag, /no[Vv]alidate=""/u);
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
const pageIntroMarkup = renderToStaticMarkup(React.createElement(PageIntro, {
  className: "vite-content-root-class",
  style: { display: "inline-block" },
  title: "Vite projects",
  titleAs: "h4",
  xstyle: contentRootXstyle,
}));
const pageIntroTag = pageIntroMarkup.match(/^<section[^>]*>/u)?.[0] ?? "";
assert.match(pageIntroMarkup, /<h4[^>]*data-slot="page-intro-title"/u);
assert.match(pageIntroTag, /class="hraness-page-intro [^"]*vite-content-root-xstyle vite-content-root-class"/u);
assert.match(pageIntroTag, /style="display:inline-block"/u);
for (const baseClass of contentRootBaseClasses) {
  assert.ok(
    !pageIntroTag.split(/[\\s"]/u).includes(baseClass),
    "Vite SSR PageIntro caller xstyle must replace its package display class before native style wins last",
  );
}
const emptyStateMarkup = renderToStaticMarkup(React.createElement(EmptyState, {
  title: "No Vite projects",
}));
assert.match(emptyStateMarkup, /data-slot="empty-state"/u);
const inlineAlertMarkup = renderToStaticMarkup(React.createElement(InlineAlert, {
  isLive: true,
  tone: "success",
}, "Vite is ready"));
assert.match(inlineAlertMarkup, /aria-live="polite"/u);
assert.match(inlineAlertMarkup, /role="status"/u);
const settingsCardMarkup = renderToStaticMarkup(React.createElement(SettingsCard, {
  shape: "rectangular",
  title: "Vite settings",
}, "Settings body"));
assert.match(settingsCardMarkup, /data-shape="rectangular"/u);
const dataTableColumns = [
  { cell: (row) => row.project, header: "Project", id: "project" },
  { align: "end", cell: (row) => row.runs, header: "Runs", id: "runs" },
];
const dataTableMarkup = renderToStaticMarkup(React.createElement(DataTable, {
  caption: "Vite projects",
  className: "vite-data-table-class",
  columns: dataTableColumns,
  getRowId: (row) => row.id,
  rows: [{ id: "ocean", project: "Ocean", runs: 3 }],
  style: { width: "42rem" },
  wrapperClassName: "vite-data-table-wrapper-class",
  wrapperXstyle: dataTableWrapperXstyle,
  xstyle: dataTableXstyle,
}));
const dataTableWrapperTag = dataTableMarkup.match(/^<div[^>]*>/u)?.[0] ?? "";
const dataTableTag = dataTableMarkup.match(/<table[^>]*data-slot="data-table"[^>]*>/u)?.[0] ?? "";
assert.match(
  dataTableWrapperTag,
  /class="hraness-data-table [^"]*vite-data-table-wrapper-xstyle vite-data-table-wrapper-class"/u,
);
assert.match(
  dataTableTag,
  /class="hraness-data-table__table [^"]*vite-data-table-xstyle vite-data-table-class"/u,
);
assert.match(dataTableTag, /style="[^"]*width:42rem[^"]*"/u);
for (const baseClass of dataTableWrapperBaseClasses) {
  assert.ok(!dataTableWrapperTag.split(/[\\s"]/u).includes(baseClass));
}
for (const baseClass of dataTableBaseClasses) {
  assert.ok(!dataTableTag.split(/[\\s"]/u).includes(baseClass));
}
assert.equal(dataTableMarkup.match(/data-slot="data-table-header"/gu)?.length, 2);
assert.equal(dataTableMarkup.match(/data-slot="data-table-cell"/gu)?.length, 2);
assert.match(dataTableMarkup, /data-align="end"/u);
const emptyDataTableMarkup = renderToStaticMarkup(React.createElement(DataTable, {
  columns: dataTableColumns,
  empty: "No Vite projects",
  getRowId: (row) => row.id,
  rows: [],
}));
assert.match(emptyDataTableMarkup, /data-slot="data-table-empty-row"/u);
assert.match(emptyDataTableMarkup, /col[Ss]pan="2"/u);
assert.match(emptyDataTableMarkup, />No Vite projects</u);
const progressMarkup = renderToStaticMarkup(React.createElement(ProgressBar, {
  className: "vite-progress-class",
  label: "Vite progress",
  style: { width: "15rem" },
  value: 35,
  xstyle: indicatorRootXstyle,
}));
const progressTag = progressMarkup.match(/^<div[^>]*>/u)?.[0] ?? "";
assert.match(progressTag, /class="hraness-progress-bar [^"]*vite-indicator-root-xstyle vite-progress-class"/u);
assert.match(progressTag, /style="width:15rem"/u);
for (const baseClass of ${JSON.stringify(indicatorKnobProbe.indicatorRootBaseClasses)}) {
  assert.ok(!progressTag.split(/[\\s"]/u).includes(baseClass));
}
const meterMarkup = renderToStaticMarkup(React.createElement(Meter, {
  label: "Vite meter",
  tone: "success",
  value: 68,
  xstyle: indicatorRootXstyle,
}));
assert.match(meterMarkup, /data-slot="meter"/u);
assert.match(meterMarkup, /data-tone="success"/u);
const sliderMarkup = renderToStaticMarkup(React.createElement(Slider, {
  defaultValue: 42,
  label: "Vite gain",
  name: "vite-gain",
  xstyle: indicatorRootXstyle,
}));
assert.match(sliderMarkup, /data-slot="slider-thumb-indicator"/u);
assert.match(sliderMarkup, /<input[^>]*name="vite-gain"/u);
const knobMarkup = renderToStaticMarkup(React.createElement(Knob, {
  className: "vite-knob-class",
  controlClassName: "vite-knob-control-class",
  controlXstyle: knobControlXstyle,
  defaultValue: 64,
  label: "Vite drive",
  name: "vite-drive",
  style: { width: "9rem" },
  touchPan: "horizontal",
  xstyle: knobRootXstyle,
}));
const knobTag = knobMarkup.match(/^<div[^>]*>/u)?.[0] ?? "";
const knobControlTag = knobMarkup.match(/<div[^>]*data-slot="knob-control"[^>]*>/u)?.[0] ?? "";
assert.match(knobTag, /class="hraness-knob [^"]*vite-knob-root-xstyle vite-knob-class"/u);
assert.match(knobTag, /style="width:9rem"/u);
assert.match(knobControlTag, /vite-knob-control-xstyle/u);
assert.match(knobControlTag, /touch-action:pan-x/u);
for (const baseClass of ${JSON.stringify(indicatorKnobProbe.knobRootBaseClasses)}) {
  assert.ok(!knobTag.split(/[\\s"]/u).includes(baseClass));
}
for (const baseClass of ${JSON.stringify(indicatorKnobProbe.knobControlBaseClasses)}) {
  assert.ok(!knobControlTag.split(/[\\s"]/u).includes(baseClass));
}
for (const focusClass of ${JSON.stringify(indicatorKnobProbe.knobControlNativeFocusClasses)}) {
  assert.ok(!knobControlTag.split(/[\\s"]/u).includes(focusClass));
}
console.log("Vite SSR CheckboxField, Form, Link, Content, DataTable, indicators, and Knob xstyle runtime passed");
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
    join(consumer, "node_modules", "@hraness", "ui", "src", "fields.stylex.ts"),
  );
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "select-field.stylex.ts"),
  );
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "indicators.stylex.ts"),
  );
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "knob.stylex.ts"),
  );
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "content.stylex.ts"),
  );
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "data-table.stylex.ts"),
  );
  await access(
    join(consumer, "node_modules", "@hraness", "ui", "src", "data-display.tsx"),
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
  const [
    installedJavaScript,
    installedStylexCss,
    installedComponentsCss,
    installedStylesCss,
  ] = await Promise.all([
    readFile(join(installedPackageRoot, "dist", "index.js"), "utf8"),
    readFile(join(installedPackageRoot, "dist", "stylex.css"), "utf8"),
    readFile(join(installedPackageRoot, "src", "components.css"), "utf8"),
    readFile(join(installedPackageRoot, "src", "styles.css"), "utf8"),
  ]);
  const checkboxProbe = packageCheckboxStyleMap(installedJavaScript);
  const contentProbe = packageContentPrecedenceProbe(
    installedJavaScript,
    installedStylexCss,
  );
  const dataTableProbe = packageDataTableProbe(
    installedJavaScript,
    installedStylexCss,
  );
  const fieldSelectProbe = packageFieldSelectProbe(installedJavaScript);
  const formProbe = packageFormStyleMap(installedJavaScript, installedStylexCss);
  const indicatorKnobProbe = packageIndicatorKnobProbe(installedJavaScript);
  const linkProbe = packageLinkStyleMap(installedJavaScript);
  requirePackageCheckboxStyles(installedJavaScript, installedStylexCss);
  requirePackageFieldSelectStyles(installedJavaScript, installedStylexCss);
  requirePackageLinkStyles(installedJavaScript, installedStylexCss);
  const visuallyHiddenClasses = requirePackageVisuallyHiddenStyles(
    installedJavaScript,
    installedStylexCss,
  );
  requirePackageFormStyles(installedJavaScript, installedStylexCss);
  requirePackageIndicatorKnobStyles(installedJavaScript, installedStylexCss);
  requirePackageContentStyles(installedJavaScript, installedStylexCss);
  requirePackageDataTableStyles(installedJavaScript, installedStylexCss);
  requireNoMigratedGallerySentinels(
    installedJavaScript,
    installedStylexCss,
    installedComponentsCss,
    installedStylesCss,
  );

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
      contentProbe,
      dataTableProbe,
      fieldSelectProbe,
      formProbe,
      indicatorKnobProbe,
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
    writeFile(
      join(consumer, "vite-client.ts"),
      viteClientProbe(contentProbe, dataTableProbe),
    ),
    writeFile(
      join(consumer, "vite-ssr.ts"),
      viteSsrProbe(
        checkboxProbe,
        contentProbe,
        dataTableProbe,
        fieldSelectProbe,
        formProbe,
        indicatorKnobProbe,
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
  requirePackageViteFieldSelectStyles(viteJavaScript, viteCss);
  requirePackageLinkStyles(viteJavaScript, viteCss);
  requirePackageFormStyles(viteJavaScript, viteCss);
  requirePackageIndicatorKnobStyles(viteJavaScript, viteCss);
  requirePackageContentStyles(viteJavaScript, viteCss);
  requirePackageVisuallyHiddenStyles(viteJavaScript, viteCss);
  requireNoMigratedGallerySentinels(viteJavaScript, viteCss);
  assert.match(viteJavaScript, /hraness-pressable-card/u);
  assert.match(viteJavaScript, /hraness-toolbar/u);
  assert.match(viteJavaScript, /hraness-key-hint/u);
  assert.match(viteJavaScript, /hraness-page-intro/u);
  assert.match(
    viteJavaScript,
    /vite-content-root-xstyle/u,
    "Vite client must bundle the Content caller xstyle runtime probe",
  );
  assert.match(
    viteJavaScript,
    /Vite client Content native style did not win last/u,
    "Vite client must bundle the Content native-style precedence assertion",
  );
  assert.match(viteJavaScript, /hraness-empty-state/u);
  assert.match(viteJavaScript, /hraness-inline-alert/u);
  assert.match(viteJavaScript, /hraness-settings-card/u);
  assert.match(viteJavaScript, /hraness-link/u);
  assert.match(viteJavaScript, /hraness-form/u);
  assert.match(viteJavaScript, /hraness-progress-bar/u);
  assert.match(viteJavaScript, /hraness-meter/u);
  assert.match(viteJavaScript, /hraness-slider/u);
  assert.match(viteJavaScript, /hraness-knob/u);
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
  assert.doesNotMatch(
    viteCss,
    /\.hraness-(?:progress-bar|meter|slider|knob)(?:__[A-Za-z0-9_-]+)?(?![A-Za-z0-9_-])/u,
  );

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
    /hraness-text-field/u,
    "Vite SSR must bundle the TextField implementation",
  );
  assert.match(
    viteSsrBundle,
    /vite-field-root-xstyle/u,
    "Vite SSR must bundle the caller field root xstyle probe",
  );
  assert.match(
    viteSsrBundle,
    /vite-field-control-xstyle/u,
    "Vite SSR must bundle the caller field controlXstyle probe",
  );
  assert.match(
    viteSsrBundle,
    /hraness-select-field/u,
    "Vite SSR must bundle the SelectField implementation",
  );
  assert.match(
    viteSsrBundle,
    /vite-select-trigger-xstyle/u,
    "Vite SSR must bundle the caller SelectField triggerXstyle probe",
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
  assert.match(
    viteSsrBundle,
    /vite-content-root-xstyle/u,
    "Vite SSR must bundle the caller Content xstyle probe",
  );
  assert.match(
    viteSsrBundle,
    /hraness-progress-bar/u,
    "Vite SSR must bundle the ProgressBar implementation",
  );
  assert.match(
    viteSsrBundle,
    /vite-indicator-root-xstyle/u,
    "Vite SSR must bundle the caller indicator xstyle probe",
  );
  assert.match(
    viteSsrBundle,
    /hraness-slider__thumb-indicator/u,
    "Vite SSR must bundle the Slider visible-thumb implementation",
  );
  assert.match(
    viteSsrBundle,
    /hraness-knob/u,
    "Vite SSR must bundle the Knob implementation",
  );
  assert.match(
    viteSsrBundle,
    /vite-knob-control-xstyle/u,
    "Vite SSR must bundle the caller Knob controlXstyle probe",
  );
  for (const hook of [
    "hraness-page-intro",
    "hraness-empty-state",
    "hraness-inline-alert",
    "hraness-settings-card",
  ]) {
    assert.match(
      viteSsrBundle,
      new RegExp(hook, "u"),
      `Vite SSR must bundle the ${hook} implementation`,
    );
  }
  requireNoMigratedGallerySentinels(viteSsrBundle);
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
