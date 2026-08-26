import * as stylex from "@stylexjs/stylex";

export const avatarStyles = stylex.create({
  child: {
    height: "100%",
    width: "100%",
  },
  fallback: {
    alignItems: "center",
    display: "grid",
    justifyItems: "center",
  },
  image: {
    objectFit: "cover",
  },
  large: {
    fontSize: "var(--text-body)",
    height: "3.5rem",
    width: "3.5rem",
  },
  root: {
    alignItems: "center",
    backgroundColor: "var(--ui-muted)",
    borderRadius: "var(--radius-round)",
    color: "var(--ui-muted-foreground)",
    display: "inline-grid",
    flex: "0 0 auto",
    fontWeight: "var(--font-weight-medium)",
    height: "2.5rem",
    justifyItems: "center",
    overflow: "hidden",
    width: "2.5rem",
  },
  small: {
    fontSize: "var(--text-caption)",
    height: "2rem",
    width: "2rem",
  },
});
