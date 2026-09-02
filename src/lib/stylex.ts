import type { CSSProperties } from "react";
import * as stylex from "@stylexjs/stylex";
import type { CSSProperties as StyleXCSSProperties } from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";

/**
 * StyleX 0.19 lowers camel-case logical size aliases to physical properties.
 * Migrated logical-size components expose the canonical dashed keys instead.
 */
export type LogicalSizeStyleProperties = Omit<
  StyleXCSSProperties,
  "inlineSize" | "maxInlineSize" | "minInlineSize"
> & Readonly<{
  "inline-size"?: StyleXCSSProperties["inlineSize"];
  "max-inline-size"?: StyleXCSSProperties["maxInlineSize"];
  "min-inline-size"?: StyleXCSSProperties["minInlineSize"];
}>;

/** Whether compiled StyleX output contributes any actual presentation. */
export function hasCompiledStylexPresentation(
  presentation: ReturnType<typeof stylex.props>,
): boolean {
  return presentation.className !== undefined
    || presentation.style !== undefined;
}

/** Whether a conditional StyleX value contributes any compiled presentation. */
export function hasStylexPresentation(
  xstyle: StyleXStyles | undefined,
): boolean {
  return hasCompiledStylexPresentation(stylex.props(xstyle));
}

/** Merge extracted dynamic StyleX values before caller-owned native styles. */
export function mergeStylexInlineStyles(
  stylexStyle: Readonly<Record<string, number | string>> | undefined,
  callerStyle: CSSProperties | undefined,
): CSSProperties | undefined {
  if (stylexStyle === undefined) return callerStyle;
  return { ...stylexStyle, ...callerStyle };
}
