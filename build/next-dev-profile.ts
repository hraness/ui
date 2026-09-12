/** Private finite authored-source profile for the native development bridge. */
import assert from "node:assert/strict";
import { posix } from "node:path";
import { parseAsync, traverse, types as t, type NodePath } from "@babel/core";
import { sha256 } from "./compiler.js";
import { createNextDevConsumerLedger, type NextDevConsumerSource } from "./next-dev-consumers.js";
import { NEXT_DEV_CLIENT_IMPORT } from "./next-dev-markers.js";
import { STYLEX_NEXT_DEV_EXTENSIONS, type NextDevSource } from "./next-dev-session.js";

type Module = Readonly<{ ast: t.File; consumer: NextDevConsumerSource | undefined; path: string }>;
const SOURCE = /^app\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(?:ts|tsx|js|jsx|mjs|mts|cjs|cts)$/u;
const SPECIAL = /\/(?:layout|template|loading|error|global-error|not-found|default|route|sitemap|robots|manifest|opengraph-image|twitter-image)\.[^.]+$/u;
const CLIENT_REACT = new Set(["lazy", "Suspense", "useState", "useEffect", "useRef", "useMemo", "useCallback"]);
const renderNodes = (node: t.JSXElement): readonly (t.JSXElement | t.JSXExpressionContainer | t.JSXSpreadChild | t.JSXText | t.JSXFragment)[] =>
  node.children.filter((child) => !t.isJSXText(child) || child.value.trim().length > 0);

/**
 * Flat static App Router pages, one style-free root layout, parameter-free
 * synchronous pages and explicitly registered client/lazy modules. Data-only
 * source creation/reexports remain supported, including .tsx data modules.
 * Calls and ambient names are an allowlist, not a general JavaScript safety
 * analysis. Authored imperative DOM writes, opaque callbacks, and alternate
 * renderers are outside this deliberately narrow development profile. The
 * marker transform separately proves each exact returned native root.
 */
export async function validateNextDevNativeProfile(sources: readonly NextDevSource[], consumers: readonly NextDevConsumerSource[]): Promise<void> {
  const ledger = createNextDevConsumerLedger({ consumers, session: "0".repeat(32) }); ledger.close();
  const registry = new Map(consumers.map((consumer) => [consumer.source, consumer]));
  assert.ok(sources.length > 0 && sources.length <= 4096, "Next development native profile requires a bounded source census");
  const modules = new Map<string, Module>();
  for (const source of sources) {
    assert.ok(SOURCE.test(source.logicalPath) && !modules.has(source.logicalPath), "Next development native profile requires unique ordinary app sources");
    assert.ok(source.logicalPath === "app/layout.tsx" || !SPECIAL.test(source.logicalPath),
      "Next development native profile excludes nested layouts and asynchronous/special route boundaries");
    assert.deepEqual(source.map.sources, [source.logicalPath], "Next development profile requires the captured logical source map");
    assert.ok(source.map.sourcesContent?.length === 1 && typeof source.map.sourcesContent[0] === "string"
      && sha256(source.map.sourcesContent[0]) === source.sourceSha256, "Next development profile authored bytes differ from captured identity");
    const ast = await parseAsync(source.map.sourcesContent[0], { babelrc: false, configFile: false, filename: source.logicalPath,
      sourceType: "module", parserOpts: { plugins: ["typescript", "jsx"] } });
    assert.ok(ast != null && t.isFile(ast), "Next development profile could not parse its captured module");
    modules.set(source.logicalPath, { ast, consumer: registry.get(source.logicalPath), path: source.logicalPath });
  }
  assert.ok(modules.has("app/layout.tsx") && registry.has("app/page.tsx"), "Next development native profile requires its root layout and registered root page");
  for (const source of registry.keys()) assert.ok(modules.has(source), "Next development registered consumer is absent from its complete source census");
  const resolve = (from: string, specifier: string): Module => {
    assert.ok(specifier.startsWith(".") && !/[?#\\]/u.test(specifier), "Next development profile imports must use ordinary relative source paths");
    const base = posix.normalize(posix.join(posix.dirname(from), specifier));
    const extension = posix.extname(base);
    const stems = extension === ".js" ? [base.slice(0, -3) + ".ts", base.slice(0, -3) + ".tsx", base, base.slice(0, -3) + ".jsx"]
      : extension === ".mjs" ? [base.slice(0, -4) + ".mts", base]
        : extension === ".cjs" ? [base.slice(0, -4) + ".cts", base]
          : /^\.(?:ts|tsx|jsx|mts|cts)$/u.test(extension) ? [base] : STYLEX_NEXT_DEV_EXTENSIONS.map((extension) => base + extension);
    const found = stems.find((path) => modules.has(path));
    assert.ok(found !== undefined, "Next development profile relative import has no exact captured source");
    return modules.get(found)!;
  };
  for (const module of modules.values()) {
    const layout = module.path === "app/layout.tsx";
    const data = module.consumer === undefined && !layout;
    const client = module.consumer?.target === "client";
    const imports = new Map<string, { imported: string; source: string; target: Module | null }>();
    let cssImports = 0;
    for (const statement of module.ast.program.body) {
      if (t.isImportDeclaration(statement)) {
        if (statement.importKind === "type" || (statement.specifiers.length > 0
          && statement.specifiers.every((specifier) => t.isImportSpecifier(specifier) && specifier.importKind === "type"))) continue;
        if (statement.source.value.endsWith(".css")) {
          assert.ok(layout && statement.source.value === "./stylex-dev.css" && statement.specifiers.length === 0,
            "Next development native layout owns the sole exact stylesheet marker import");
          cssImports++; continue;
        }
        const target = statement.source.value.startsWith(".") ? resolve(module.path, statement.source.value) : null;
        if (target !== null) {
          assert.ok(!layout && target.path !== "app/layout.tsx" && (target.consumer === undefined || (!data && target.consumer.target === "client")),
            "Next development profile cannot import another server/Edge page or an unbounded layout");
        } else assert.ok(statement.source.value === "@stylexjs/stylex"
          || (!data && statement.source.value === NEXT_DEV_CLIENT_IMPORT)
          || (client && statement.source.value === "react")
          || (!layout && !data && statement.source.value === "@hraness/ui"),
        "Next development native profile excludes unknown runtime imports and server consumers");
        for (const specifier of statement.specifiers) {
          if (t.isImportSpecifier(specifier) && specifier.importKind === "type") continue;
          const imported = t.isImportSpecifier(specifier) ? t.isIdentifier(specifier.imported) ? specifier.imported.name : specifier.imported.value
            : t.isImportDefaultSpecifier(specifier) ? "default" : "*";
          if (statement.source.value === "react") assert.ok(CLIENT_REACT.has(imported), "Next development client uses an unsupported React composition");
          if (statement.source.value === "@hraness/ui") assert.equal(imported, "Link", "Next development native profile currently admits only the pinned Link primitive");
          if (target?.consumer !== undefined) assert.equal(imported, "default", "Next development client consumers require their exact default export");
          imports.set(specifier.local.name, { imported, source: statement.source.value, target });
        }
      } else if (t.isExportNamedDeclaration(statement) || t.isExportAllDeclaration(statement)) {
        if (statement.exportKind === "type") continue;
        if (statement.source !== null && statement.source !== undefined) {
          const target = resolve(module.path, statement.source.value);
          assert.ok(data && target.consumer === undefined && target.path !== "app/layout.tsx",
            "Next development profile reexports must remain data-only");
        } else if (!data) {
          assert.ok(module.consumer?.target !== "client" && t.isExportNamedDeclaration(statement)
            && t.isVariableDeclaration(statement.declaration) && statement.declaration.kind === "const"
            && statement.declaration.declarations.length === 1 && t.isIdentifier(statement.declaration.declarations[0]!.id, { name: "runtime" })
            && t.isStringLiteral(statement.declaration.declarations[0]!.init)
            && statement.declaration.declarations[0]!.init.value === (module.consumer?.target === "edge-server" ? "edge" : "nodejs"),
          "Next development profile excludes asynchronous route exports and server actions");
        }
      }
    }
    const defaultExport = module.ast.program.body.find((statement): statement is t.ExportDefaultDeclaration => t.isExportDefaultDeclaration(statement));
    if (data) assert.equal(defaultExport, undefined, "Next development unregistered sources must remain data-only");
    else assert.ok(defaultExport !== undefined && t.isFunctionDeclaration(defaultExport.declaration)
      && !defaultExport.declaration.async && !defaultExport.declaration.generator,
    "Next development render sources require synchronous default function declarations");
    if (module.consumer !== undefined) assert.equal((defaultExport!.declaration as t.FunctionDeclaration).params.length, 0,
      "Next development registered consumers cannot receive opaque rendering or asynchronous route inputs");
    if (module.consumer?.target === "edge-server") assert.ok(module.ast.program.body.some((statement) =>
      t.isExportNamedDeclaration(statement) && t.isVariableDeclaration(statement.declaration)
      && statement.declaration.declarations.some((entry) => t.isIdentifier(entry.id, { name: "runtime" }) && t.isStringLiteral(entry.init, { value: "edge" }))),
    "Next development registered Edge page lacks its exact runtime declaration");
    assert.equal(module.ast.program.directives.some(({ value }) => value.value === "use client"), client,
      "Next development source directive differs from its finite consumer registration");
    assert.ok(!module.ast.program.directives.some(({ value }) => value.value === "use server"), "Next development native profile excludes server actions");
    const jsxNames = new Set([...imports].filter(([, entry]) => entry.target?.consumer?.target === "client"
      || entry.source === NEXT_DEV_CLIENT_IMPORT || entry.source === "@hraness/ui" || (client && entry.source === "react" && entry.imported === "Suspense"))
      .map(([name]) => name));
    const lazyImports = new Set<t.CallExpression>();
    const lazyDeclarations = new Map<string, t.VariableDeclarator>();
    for (const statement of module.ast.program.body) {
      if (!t.isVariableDeclaration(statement)) continue;
      for (const declaration of statement.declarations) {
        const call = declaration.init;
        if (!t.isCallExpression(call) || !t.isIdentifier(call.callee) || imports.get(call.callee.name)?.source !== "react"
          || imports.get(call.callee.name)?.imported !== "lazy") continue;
        const factory = call.arguments[0];
        assert.ok(client && call.arguments.length === 1 && t.isIdentifier(declaration.id) && t.isArrowFunctionExpression(factory)
          && !factory.async && factory.params.length === 0 && t.isCallExpression(factory.body) && t.isImport(factory.body.callee)
          && factory.body.arguments.length === 1 && t.isStringLiteral(factory.body.arguments[0])
          && resolve(module.path, factory.body.arguments[0].value).consumer?.target === "client",
        "Next development lazy consumers require one exact registered client import");
        lazyImports.add(factory.body); jsxNames.add(declaration.id.name);
        lazyDeclarations.set(declaration.id.name, declaration);
      }
    }
    let nodes = 0;
    t.traverseFast(module.ast, (node) => {
      assert.ok(++nodes <= 100_000, "Next development source AST exceeds its finite bound");
      assert.ok(!t.isAwaitExpression(node) && !t.isYieldExpression(node) && !t.isThrowStatement(node) && !t.isThisExpression(node)
        && !t.isNewExpression(node) && !t.isClass(node) && !t.isObjectMethod(node)
        && !t.isMetaProperty(node) && !t.isJSXSpreadChild(node), "Next development native profile excludes asynchronous or opaque rendering constructs");
      assert.ok(!t.isAssignmentExpression(node) && !t.isUpdateExpression(node)
        && !(t.isUnaryExpression(node) && node.operator === "delete") && !t.isLoop(node),
      "Next development native profile excludes imperative mutation and unbounded control flow");
      if (t.isFunction(node)) assert.ok(!node.async && !node.generator && !data
        && (client || node === defaultExport?.declaration), "Next development server/data source cannot defer work to another function");
      if (t.isMemberExpression(node) || t.isOptionalMemberExpression(node)) assert.ok(!node.computed && t.isIdentifier(node.property)
        && !["then", "constructor", "prototype", "__proto__"].includes(node.property.name),
      "Next development native profile excludes opaque member access and custom thenables");
      if (t.isObjectProperty(node)) assert.ok(!node.computed && !(t.isIdentifier(node.key) || t.isStringLiteral(node.key)
        ? ["then", "constructor", "prototype", "__proto__"].includes(t.isIdentifier(node.key) ? node.key.name : node.key.value) : false),
      "Next development native profile excludes custom thenable or prototype properties");
      if (t.isCallExpression(node)) {
        if (t.isImport(node.callee)) assert.ok(lazyImports.has(node), "Next development dynamic imports must be registered native lazy consumers");
        else if (!client) {
          const stylex = t.isMemberExpression(node.callee) && !node.callee.computed && t.isIdentifier(node.callee.object)
            && imports.get(node.callee.object.name)?.source === "@stylexjs/stylex" && t.isIdentifier(node.callee.property)
            && ["create", "defineVars", "createTheme", ...(!data ? ["props"] : [])].includes(node.callee.property.name);
          const marker = !data && !layout && t.isIdentifier(node.callee) && imports.get(node.callee.name)?.source === NEXT_DEV_CLIENT_IMPORT
            && imports.get(node.callee.name)?.imported === "stylexNextDevRevision";
          assert.ok(stylex || marker, "Next development server/data rendering cannot call an unregistered producer");
        }
      }
      if (t.isJSXElement(node)) {
        assert.ok(!data, "Next development JSX source requires a registered consumer");
        const name = node.openingElement.name;
        assert.ok(t.isJSXIdentifier(name) && (/^[a-z][a-z0-9]*$/u.test(name.name) || jsxNames.has(name.name)),
          "Next development JSX references an unknown rendering consumer");
        assert.ok(!["script", "style", "link", "iframe", "object", "embed", "template"].includes(name.name),
          "Next development native profile excludes opaque or independently styled subdocuments");
      }
      if (t.isJSXAttribute(node)) assert.ok(!t.isJSXIdentifier(node.name)
        || !["ref", "dangerouslySetInnerHTML", "data-hraness-stylex-consumer", "data-hraness-stylex-descriptor"].includes(node.name.name),
      "Next development authored JSX cannot inject HTML or native ownership attributes");
      if (t.isJSXFragment(node)) assert.ok(!data && client, "Next development server/data source cannot hide a root behind a fragment");
    });
    const imported = (path: NodePath, name: string, source: string, member: string): boolean => {
      const binding = path.scope.getBinding(name);
      return binding !== undefined && binding.constant && binding.path.isImportSpecifier()
        && t.isIdentifier(binding.path.node.imported, { name: member })
        && binding.path.parentPath?.isImportDeclaration() === true && binding.path.parentPath.node.source.value === source;
    };
    const stylexProps = (path: NodePath, node: t.Node, methods: readonly string[]): boolean => {
      if (!t.isCallExpression(node) || !t.isMemberExpression(node.callee) || node.callee.computed
        || !t.isIdentifier(node.callee.object) || !t.isIdentifier(node.callee.property) || !methods.includes(node.callee.property.name)) return false;
      const binding = path.scope.getBinding(node.callee.object.name);
      return binding !== undefined && binding.constant && binding.path.isImportNamespaceSpecifier()
        && binding.path.parentPath?.isImportDeclaration() === true && binding.path.parentPath.node.source.value === "@stylexjs/stylex";
    };
    traverse(module.ast, {
      ReferencedIdentifier(path) {
        if (!path.isIdentifier()) return;
        assert.ok(path.scope.getBinding(path.node.name) !== undefined || ["undefined", "Infinity", "NaN"].includes(path.node.name),
          "Next development native source references unbound ambient authority");
      },
      JSXSpreadAttribute(path) {
        assert.ok(stylexProps(path, path.node.argument, ["props"]), "Next development authored JSX permits only bound StyleX props spreads");
      },
      JSXOpeningElement(path) {
        const name = path.node.name;
        if (!t.isJSXIdentifier(name) || /^[a-z][a-z0-9]*$/u.test(name.name)) return;
        const binding = path.scope.getBinding(name.name);
        assert.ok(binding?.constant && (binding.path.isImportDefaultSpecifier() || binding.path.isImportSpecifier()
          ? binding.path.parentPath?.isImportDeclaration() === true
            && binding.path.parentPath.node.source.value === imports.get(name.name)?.source
          : binding.path.isVariableDeclarator() && binding.path.node === lazyDeclarations.get(name.name)),
        "Next development JSX consumer must retain its exact captured binding");
      },
      CallExpression(path) {
        if (t.isImport(path.node.callee)) return; // Exact lazy call was checked above.
        const callee = path.node.callee;
        let allowed = stylexProps(path, path.node, ["create", "defineVars", "createTheme", ...(!data ? ["props"] : [])]);
        if (t.isIdentifier(callee)) {
          allowed ||= !data && !layout && imported(path, callee.name, NEXT_DEV_CLIENT_IMPORT, "stylexNextDevRevision");
          allowed ||= client && [...CLIENT_REACT].filter((name) => name !== "Suspense").some((name) => imported(path, callee.name, "react", name));
          const binding = path.scope.getBinding(callee.name);
          if (client && binding?.constant && binding.path.isVariableDeclarator()) {
            const declaration = binding.path.node;
            allowed ||= t.isArrayPattern(declaration.id) && declaration.id.elements.length === 2
              && t.isIdentifier(declaration.id.elements[1], { name: callee.name }) && t.isCallExpression(declaration.init)
              && t.isIdentifier(declaration.init.callee) && imported(binding.path, declaration.init.callee.name, "react", "useState");
          }
        }
        assert.ok(allowed, "Next development native profile excludes unreviewed calls before its owned boundary");
      },
      OptionalCallExpression() { throw new Error("Next development native profile excludes optional opaque calls"); },
    });
    if (!layout) { assert.equal(cssImports, 0); continue; }
    assert.equal(cssImports, 1, "Next development root layout must import its exact stylesheet marker once");
    const layoutFunction = defaultExport!.declaration as t.FunctionDeclaration;
    const parameter = layoutFunction.params[0];
    assert.ok(layoutFunction.params.length === 1 && t.isObjectPattern(parameter) && parameter.properties.length === 1
      && t.isObjectProperty(parameter.properties[0]) && t.isIdentifier(parameter.properties[0].key, { name: "children" })
      && t.isIdentifier(parameter.properties[0].value, { name: "children" }), "Next development root layout must forward only its native children input");
    const result = layoutFunction.body.body[0];
    assert.ok(layoutFunction.body.body.length === 1 && t.isReturnStatement(result) && t.isJSXElement(result.argument),
      "Next development root layout must synchronously return its style-free document");
    const html = result.argument;
    assert.ok(t.isJSXIdentifier(html.openingElement.name, { name: "html" }) && html.openingElement.attributes.every((attribute) =>
      t.isJSXAttribute(attribute) && t.isJSXIdentifier(attribute.name, { name: "lang" }) && t.isStringLiteral(attribute.value)),
    "Next development root html must remain style-free");
    const body = renderNodes(html);
    assert.ok(body.length === 1 && t.isJSXElement(body[0]) && t.isJSXIdentifier(body[0].openingElement.name, { name: "body" })
      && body[0].openingElement.attributes.length === 0, "Next development root requires one style-free body");
    const document = renderNodes(body[0]);
    assert.ok(document.length === 1 && t.isJSXElement(document[0]) && t.isJSXIdentifier(document[0].openingElement.name)
      && imports.get(document[0].openingElement.name.name)?.source === NEXT_DEV_CLIENT_IMPORT
      && imports.get(document[0].openingElement.name.name)?.imported === "StylexNextDevDocument"
      && document[0].openingElement.attributes.length === 0, "Next development root requires its mounted document owner outside consumer suspension");
    const children = renderNodes(document[0]);
    assert.ok(children.length === 1 && t.isJSXExpressionContainer(children[0]) && t.isIdentifier(children[0].expression, { name: "children" }),
      "Next development root document must forward its complete native children");
  }
}
