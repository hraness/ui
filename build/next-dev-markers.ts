/** Private first-party marker transform; not a public framework support claim. */
import assert from "node:assert/strict";
import { transformAsync, types as t, type NodePath, type PluginObj, type TransformOptions } from "@babel/core";
import { parseStylexSourceMap, type StylexSourceMapV1 } from "./compiler.js";
import { createNextDevConsumerLedger, type NextDevConsumerDescriptor } from "./next-dev-consumers.js";
import type { NextDevSource } from "./next-dev-session.js";

export const NEXT_DEV_CLIENT_IMPORT = "@hraness/ui/stylex-build/next-dev-client";

/**
 * The producer supplies the descriptor only after capturing this transformed
 * source. Authored code has one zero-argument marker, never a revision string,
 * URL or catalogue. The adapter must separately validate the complete finite
 * source/import profile before using this per-module transform.
 */
export async function stampNextDevConsumerSource(source: NextDevSource, value: NextDevConsumerDescriptor): Promise<Readonly<{
  code: string;
  map: StylexSourceMapV1;
}>> {
  const ledger = createNextDevConsumerLedger({ consumers: [{ source: value.source, target: value.target }], session: value.session });
  ledger.publish({ includedRevisions: value.includedRevisions, revision: value.revision,
    sequence: value.sequence, stylesheetSha256: value.stylesheetSha256 });
  const descriptor = ledger.captured(value);
  ledger.close();
  assert.equal(source.logicalPath, descriptor.source, "Next development marker source differs from producer authority");
  assert.ok(Buffer.byteLength(source.code) > 0 && Buffer.byteLength(source.code) <= 2 * 1024 * 1024,
    "Next development marker source exceeds its byte bound");
  const inputMap = parseStylexSourceMap(source.map, "Next development marker input map");
  assert.deepEqual(inputMap.sources, [source.logicalPath], "Next development marker map must retain its exact logical source");
  let stamped = false;
  const plugin: PluginObj = {
    visitor: {
      Program(path) {
        const client = path.node.directives.some(({ value }) => value.value === "use client");
        assert.equal(client, descriptor.target === "client", "Next development consumer directive differs from its registered target");
        assert.ok(!path.node.directives.some(({ value }) => value.value === "use server"), "Next development consumer cannot define server actions");
        const imports = path.get("body").filter((entry): entry is NodePath<t.ImportDeclaration> =>
          entry.isImportDeclaration() && entry.node.source.value === NEXT_DEV_CLIENT_IMPORT);
        assert.equal(imports.length, 1, "Next development consumer requires one exact client-boundary import");
        const boundaryImport = imports[0]!;
        assert.ok(boundaryImport.node.importKind !== "type" && boundaryImport.node.specifiers.length === 2,
          "Next development consumer import requires exactly its boundary and marker");
        const bindings = new Map<string, NodePath<t.ImportSpecifier>>();
        for (const specifier of boundaryImport.get("specifiers")) {
          assert.ok(specifier.isImportSpecifier() && specifier.node.importKind !== "type" && t.isIdentifier(specifier.node.imported),
            "Next development consumer requires ordinary named runtime imports");
          const imported = specifier.node.imported.name;
          assert.ok(["StylexNextDevConsumer", "stylexNextDevRevision"].includes(imported) && !bindings.has(imported),
            "Next development consumer has an unknown or repeated boundary import");
          bindings.set(imported, specifier);
        }
        const boundary = bindings.get("StylexNextDevConsumer")!;
        const marker = bindings.get("stylexNextDevRevision")!;
        assert.ok(boundary !== undefined && marker !== undefined, "Next development consumer requires both boundary imports");
        const exports = path.get("body").filter((entry) => entry.isExportDefaultDeclaration());
        assert.equal(exports.length, 1, "Next development consumer requires one default function");
        const declaration = (exports[0] as NodePath<t.ExportDefaultDeclaration>).get("declaration");
        assert.ok(declaration.isFunctionDeclaration() && !declaration.node.async && !declaration.node.generator,
          "Next development consumer requires a synchronous default function declaration");
        if (descriptor.target !== "client") {
          assert.equal(declaration.node.params.length, 0, "Next development server page cannot consume asynchronous route inputs");
          assert.equal(declaration.node.body.body.length, 1, "Next development server page must synchronously return its complete owned root");
        }
        const returns = declaration.get("body.body").filter((entry): entry is NodePath<t.ReturnStatement> => entry.isReturnStatement());
        assert.equal(returns.length, 1, "Next development consumer requires one unconditional root return");
        const functionReturns: NodePath<t.ReturnStatement>[] = [];
        declaration.traverse({ ReturnStatement(returnPath) {
          if (returnPath.getFunctionParent() === declaration) functionReturns.push(returnPath);
        } });
        assert.ok(functionReturns.length === 1 && functionReturns[0]!.node === returns[0]!.node,
          "Next development consumer cannot return outside its one unconditional root");
        const root = returns[0]!.get("argument");
        assert.ok(root.isJSXElement(), "Next development consumer must directly return its native boundary");
        const opening = root.get("openingElement");
        const boundaryName = boundary.node.local.name;
        assert.ok(t.isJSXIdentifier(opening.node.name, { name: boundaryName })
          && root.node.closingElement != null && t.isJSXIdentifier(root.node.closingElement.name, { name: boundaryName }),
        "Next development consumer must own the complete returned root");
        const boundaryBinding = path.scope.getBinding(boundaryName);
        assert.ok(boundaryBinding !== undefined && boundaryBinding.path === boundary && boundaryBinding.constant,
          "Next development consumer boundary binding changed");
        assert.equal(root.scope.getBinding(boundaryName), boundaryBinding, "Next development consumer boundary is shadowed");
        assert.ok(boundaryBinding.referencePaths.length === 2 && boundaryBinding.referencePaths.every((reference) =>
          reference.node === opening.node.name || reference.node === root.node.closingElement!.name),
        "Next development consumer boundary cannot be reused or aliased");
        const attributes = opening.get("attributes");
        const named = attributes.filter((attribute): attribute is NodePath<t.JSXAttribute> => attribute.isJSXAttribute());
        const names = named.map(({ node }) => t.isJSXIdentifier(node.name) ? node.name.name : "");
        assert.ok(names.every((name) => name !== "") && new Set(names).size === names.length,
          "Next development native boundary attributes must be ordinary and unique");
        assert.ok(!names.some((name) => ["ref", "children", "dangerouslySetInnerHTML", "data-hraness-stylex-consumer", "data-hraness-stylex-descriptor"].includes(name)),
          "Next development authored attributes cannot replace native ownership");
        const tag = named.find(({ node }) => t.isJSXIdentifier(node.name, { name: "as" }));
        assert.ok(tag !== undefined && t.isStringLiteral(tag.node.value) && ["main", "section", "p"].includes(tag.node.value.value),
          "Next development boundary requires a literal finite native tag");
        const revision = named.find(({ node }) => t.isJSXIdentifier(node.name, { name: "revision" }));
        assert.ok(revision !== undefined && t.isJSXExpressionContainer(revision.node.value)
          && t.isCallExpression(revision.node.value.expression), "Next development boundary requires its exact revision marker");
        const call = revision.get("value.expression") as NodePath<t.CallExpression>;
        const markerName = marker.node.local.name;
        assert.ok(t.isIdentifier(call.node.callee, { name: markerName }) && call.node.arguments.length === 0
          && call.node.optional !== true && call.node.typeParameters == null && call.node.typeArguments == null,
        "Next development revision marker must be an ordinary zero-argument call");
        const markerBinding = path.scope.getBinding(markerName);
        assert.ok(markerBinding !== undefined && markerBinding.path === marker && markerBinding.constant
          && call.scope.getBinding(markerName) === markerBinding && markerBinding.referencePaths.length === 1
          && markerBinding.referencePaths[0]!.node === call.node.callee,
        "Next development revision marker cannot be shadowed, aliased or reused");
        // Unknown spreads could overwrite the reserved tag/descriptor even if
        // they occur earlier in JSX. Only compiler-owned StyleX props survive.
        for (const attribute of attributes) {
          if (!attribute.isJSXSpreadAttribute()) continue;
          const argument = attribute.node.argument;
          assert.ok(t.isCallExpression(argument) && t.isMemberExpression(argument.callee) && !argument.callee.computed
            && t.isIdentifier(argument.callee.object) && t.isIdentifier(argument.callee.property, { name: "props" }),
          "Next development native boundary permits only StyleX props spreads");
          const stylexBinding = attribute.scope.getBinding(argument.callee.object.name);
          assert.ok(stylexBinding?.path.isImportNamespaceSpecifier()
            && stylexBinding.path.parentPath?.isImportDeclaration()
            && stylexBinding.path.parentPath.node.source.value === "@stylexjs/stylex",
          "Next development native boundary spread is not the captured StyleX import");
        }
        call.replaceWith(t.valueToNode(descriptor));
        marker.remove();
        stamped = true;
      },
    },
  };
  const result = await transformAsync(source.code, {
    ast: false, babelrc: false, code: true, configFile: false,
    filename: source.logicalPath, sourceFileName: source.logicalPath, sourceType: "module", sourceMaps: true,
    parserOpts: { plugins: ["typescript", "jsx"] }, plugins: [plugin],
    inputSourceMap: { ...inputMap, names: [...inputMap.names], sources: [...inputMap.sources],
      ...(inputMap.sourcesContent === undefined ? {} : { sourcesContent: [...inputMap.sourcesContent] }) } as NonNullable<TransformOptions["inputSourceMap"]>,
  });
  assert.ok(stamped && result !== null && typeof result.code === "string" && result.map != null,
    "Next development consumer marker transform returned incomplete output");
  const map = parseStylexSourceMap(result.map, "Next development marker output map");
  assert.deepEqual(map.sources, inputMap.sources, "Next development marker transform changed its source-map identity");
  assert.deepEqual(map.sourcesContent, inputMap.sourcesContent, "Next development marker transform changed authored source-map content");
  return Object.freeze({ code: result.code, map });
}
