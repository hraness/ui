import type { CSSProperties } from "react";
import type { CSSProperties as StyleXCSSProperties } from "@stylexjs/stylex";

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

/** Merge extracted dynamic StyleX values before caller-owned native styles. */
export function mergeStylexInlineStyles(
  stylexStyle: Readonly<Record<string, number | string>> | undefined,
  callerStyle: CSSProperties | undefined,
): CSSProperties | undefined {
  if (stylexStyle === undefined) return callerStyle;
  return { ...stylexStyle, ...callerStyle };
}
