import * as stylex from "@stylexjs/stylex";

const styles = stylex.create({ secondary: { marginInlineEnd: "161803px" } });
const secondary = document.querySelector<HTMLElement>("[data-secondary]");
if (secondary === null) throw new Error("Missing second entry boundary");
secondary.className = stylex.props(styles.secondary).className;
secondary.dataset.secondary = "ready";
