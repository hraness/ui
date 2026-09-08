import React from "react";
import { hydrateRoot } from "react-dom/client";
import * as stylex from "@stylexjs/stylex";
import { View } from "./view.ts";
import "./styles/app.css";

const styles = stylex.create({ client: { scrollMarginBottom: "314159px" } });
const root = document.querySelector<HTMLElement>("#root");
const shell = document.querySelector<HTMLElement>("[data-shell]");
if (root === null || shell === null) throw new Error("Missing emitted SSR boundary");
hydrateRoot(root, React.createElement(View));
shell.classList.add(...stylex.props(styles.client).className.split(" "));
const lazy = await import("./lazy.ts");
shell.classList.add(...lazy.lazyClassName.split(" "));
shell.dataset.lazy = "ready";
