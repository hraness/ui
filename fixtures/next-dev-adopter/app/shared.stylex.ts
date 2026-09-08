import * as stylex from "@stylexjs/stylex";

export const serverMargin = 38.375;
export const sharedDefaultBackground = "rgb(43, 73, 103)";
export const sharedThemeBackground = "rgb(83, 113, 143)";
export const sharedPalette = stylex.defineVars({ surfaceBackground: sharedDefaultBackground });
export const sharedTheme = stylex.createTheme(sharedPalette, { surfaceBackground: sharedThemeBackground });

export const sharedStyles = stylex.create({
  surface: {
    borderColor: "rgb(37, 67, 97)",
    borderStyle: "solid",
    borderWidth: 2,
    marginLeft: serverMargin,
    padding: 24,
  },
  link: { color: "rgb(61, 91, 121)" },
  tokenSurface: { backgroundColor: sharedPalette.surfaceBackground },
});
