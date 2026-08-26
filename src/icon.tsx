"use client";

import {
  BlueskyIcon,
  ComputerIcon,
  GithubIcon,
  InstagramIcon,
  Linkedin01Icon,
  Moon02Icon,
  NewTwitterIcon,
  Sun03Icon,
  ThreadsIcon,
  YoutubeIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";

import { iconStyles } from "./icon.stylex.js";
import { cn } from "./lib/utils.js";

export type IconProps = Readonly<{
  /** A glyph imported from `@hugeicons/core-free-icons`. */
  icon: IconSvgElement;
  /** Optional presentation class; color inherits from the surrounding text. */
  className?: string;
  /** Square glyph size in CSS pixels. */
  size?: number;
  /** Stroke weight in CSS pixels. */
  strokeWidth?: number;
  /** Typed StyleX presentation applied after the shared icon recipe. */
  xstyle?: StyleXStyles;
}>;

/**
 * Portable web renderer for HugeIcons. Icons are decorative by default and
 * inherit the surrounding text color.
 */
export function Icon({
  className,
  icon,
  size = 20,
  strokeWidth = 1.5,
  xstyle,
}: IconProps) {
  const presentation = stylex.props(iconStyles.root, xstyle);

  return (
    <HugeiconsIcon
      {...presentation}
      aria-hidden="true"
      className={cn("hraness-icon", presentation.className, className)}
      color="currentColor"
      data-slot="icon"
      icon={icon}
      size={size}
      strokeWidth={strokeWidth}
    />
  );
}

export const socialIconNames = [
  "bluesky",
  "github",
  "instagram",
  "linkedin",
  "substack",
  "threads",
  "x",
  "youtube",
] as const;

export type SocialIconName = (typeof socialIconNames)[number];

const SOCIAL_ICONS: Readonly<
  Record<Exclude<SocialIconName, "substack">, IconSvgElement>
> = {
  bluesky: BlueskyIcon,
  github: GithubIcon,
  instagram: InstagramIcon,
  linkedin: Linkedin01Icon,
  threads: ThreadsIcon,
  x: NewTwitterIcon,
  youtube: YoutubeIcon,
};

export function isSocialIconName(input: unknown): input is SocialIconName {
  return typeof input === "string"
    && socialIconNames.some((name) => name === input);
}

function SubstackIcon({ size }: Readonly<{ size: number }>) {
  const presentation = stylex.props(iconStyles.root);

  return (
    <svg
      {...presentation}
      aria-hidden="true"
      className={cn("hraness-icon", presentation.className)}
      fill="currentColor"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <path d="M22.539 8.242H1.46V5.406h21.08v2.836ZM1.46 10.812v2.836h21.08v-2.836H1.46ZM22.54 16.218V24L12 18.11 1.46 24v-7.782h21.08ZM1.46 0v2.836h21.08V0H1.46Z" />
    </svg>
  );
}

export type SocialIconProps = Readonly<{
  className?: string;
  name: SocialIconName;
  size?: number;
  /** Typed StyleX presentation applied after the shared wrapper recipe. */
  xstyle?: StyleXStyles;
}>;

/** A decorative, current-color brand mark for a visible social-profile label. */
export function SocialIcon({
  className,
  name,
  size = 16,
  xstyle,
}: SocialIconProps) {
  const presentation = stylex.props(iconStyles.wrapper, xstyle);

  return (
    <span
      {...presentation}
      aria-hidden="true"
      className={cn(
        "hraness-social-icon",
        presentation.className,
        className,
      )}
      data-slot="social-icon"
      data-social-icon={name}
    >
      {name === "substack"
        ? <SubstackIcon size={size} />
        : <Icon icon={SOCIAL_ICONS[name]} size={size} />}
    </span>
  );
}

export const appearanceIconNames = ["light", "dark", "system"] as const;
export type AppearanceIconName = (typeof appearanceIconNames)[number];

const APPEARANCE_ICONS: Readonly<Record<AppearanceIconName, IconSvgElement>> = {
  dark: Moon02Icon,
  light: Sun03Icon,
  system: ComputerIcon,
};

export type AppearanceIconProps = Readonly<{
  className?: string;
  name: AppearanceIconName;
  size?: number;
  /** Typed StyleX presentation applied after the shared wrapper recipe. */
  xstyle?: StyleXStyles;
}>;

/** The shared Light, Dark, or System glyph used inside a named control. */
export function AppearanceIcon({
  className,
  name,
  size = 18,
  xstyle,
}: AppearanceIconProps) {
  const presentation = stylex.props(iconStyles.wrapper, xstyle);

  return (
    <span
      {...presentation}
      aria-hidden="true"
      className={cn(
        "hraness-appearance-icon",
        presentation.className,
        className,
      )}
      data-appearance-icon={name}
      data-slot="appearance-icon"
    >
      <Icon icon={APPEARANCE_ICONS[name]} size={size} />
    </span>
  );
}
