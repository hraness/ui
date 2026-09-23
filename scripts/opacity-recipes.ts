/** Read complete CSS color-mix calls, including nested fallback expressions. */
export function colorMixExpressions(source: string) {
  const expressions: { start: number; end: number; space: string; operands: string[]; expression: string }[] = [];
  for (const match of source.matchAll(/color-mix\(/gu)) {
    const start = match.index;
    let end = start + match[0].length, depth = 1;
    while (end < source.length && depth > 0) {
      if (source[end] === "(") depth++;
      if (source[end] === ")") depth--;
      end++;
    }
    if (depth !== 0) throw new Error("Incomplete color-mix expression");
    const expression = source.slice(start, end);
    const content = expression.slice(match[0].length, -1), parts: string[] = [];
    let beginning = 0;
    for (let index = 0, nesting = 0; index < content.length; index++) {
      if (content[index] === "(") nesting++;
      if (content[index] === ")") nesting--;
      if (content[index] === "," && nesting === 0) { parts.push(content.slice(beginning, index).trim()); beginning = index + 1; }
    }
    parts.push(content.slice(beginning).trim());
    const [interpolation, ...operands] = parts;
    if (!interpolation?.startsWith("in ") || operands.length !== 2) throw new Error("Malformed color-mix expression");
    expressions.push({ start, end, space: interpolation.slice(3).trim(), operands, expression });
  }
  return expressions;
}

export function opacityRecipes(source: string) {
  return colorMixExpressions(source).filter(mix => mix.operands.some(operand => /^transparent(?:\s+(?:\d+(?:\.\d+)?|\.\d+)%)?$/iu.test(operand)));
}

export function requireHuePreservingOpacity(source: string) {
  const recipes = opacityRecipes(source);
  for (const recipe of recipes) if (recipe.space !== "srgb") throw new Error("Opacity-only color-mix must use srgb: " + recipe.expression);
  return recipes;
}
