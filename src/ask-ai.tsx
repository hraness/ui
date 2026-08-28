import {
  ChatGptIcon,
  ClaudeIcon,
  GrokIcon,
  PerplexityAiIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { forwardRef, type HTMLAttributes } from "react";

import { askAiStyles } from "./ask-ai.stylex.js";
import { mergeStylexInlineStyles } from "./lib/stylex.js";
import { cn } from "./lib/utils.js";

export const askAiProviders = [
  "chatgpt",
  "claude",
  "perplexity",
  "grok",
] as const;

export type AskAiProvider = (typeof askAiProviders)[number];

export type AskAiProviderLink = Readonly<{
  href: string;
  label: "ChatGPT" | "Claude" | "Perplexity" | "Grok";
  provider: AskAiProvider;
}>;

type ProviderDefinition = Readonly<{
  baseUrl: string;
  icon: IconSvgElement;
  label: AskAiProviderLink["label"];
  parameter: "q" | "text";
  provider: AskAiProvider;
}>;

const providerDefinitions = [
  {
    baseUrl: "https://chatgpt.com/",
    icon: ChatGptIcon,
    label: "ChatGPT",
    parameter: "q",
    provider: "chatgpt",
  },
  {
    baseUrl: "https://claude.ai/new",
    icon: ClaudeIcon,
    label: "Claude",
    parameter: "q",
    provider: "claude",
  },
  {
    baseUrl: "https://perplexity.ai/",
    icon: PerplexityAiIcon,
    label: "Perplexity",
    parameter: "q",
    provider: "perplexity",
  },
  {
    baseUrl: "https://x.com/i/grok",
    icon: GrokIcon,
    label: "Grok",
    parameter: "text",
    provider: "grok",
  },
] as const satisfies readonly ProviderDefinition[];

function malformedSubjectUrl(): never {
  throw new TypeError(
    "AskAiAboutThis url must be a well-formed absolute HTTPS URL.",
  );
}

function validateSubjectUrl(value: string): void {
  if (
    value.length === 0
    || value.trim() !== value
    || /[\u0000-\u0020\u007F\\]/u.test(value)
    || !/^[A-Za-z][A-Za-z\d+.-]*:\/\//u.test(value)
  ) {
    malformedSubjectUrl();
  }

  try {
    decodeURI(value);
  } catch {
    malformedSubjectUrl();
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    malformedSubjectUrl();
  }

  if (parsed.protocol !== "https:") {
    throw new TypeError("AskAiAboutThis url must use HTTPS.");
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new TypeError("AskAiAboutThis url must not include credentials.");
  }
}

/** Build each provider destination while preserving the literal subject URL. */
export function buildAskAiProviderLinks(
  url: string,
): readonly AskAiProviderLink[] {
  validateSubjectUrl(url);
  const prompt = `Tell me about ${url}`;

  return providerDefinitions.map((definition) => {
    const providerUrl = new URL(definition.baseUrl);
    providerUrl.searchParams.set(definition.parameter, prompt);
    return {
      href: providerUrl.href,
      label: definition.label,
      provider: definition.provider,
    };
  });
}

export type AskAiAboutThisProps = Omit<
  HTMLAttributes<HTMLElement>,
  "aria-label" | "children"
> & Readonly<{
  /** The canonical absolute HTTPS project or content URL to discuss. */
  url: string;
  /** Typed StyleX presentation applied after the shared wrapping recipe. */
  xstyle?: StyleXStyles;
}>;

/** Four plain outbound AI links for one canonical project or content URL. */
export const AskAiAboutThis = forwardRef<HTMLElement, AskAiAboutThisProps>(
  ({ className, style, url, xstyle, ...props }, ref) => {
    const links = buildAskAiProviderLinks(url);
    const presentation = stylex.props(askAiStyles.root, xstyle);
    const labelPresentation = stylex.props(askAiStyles.label);
    const linksPresentation = stylex.props(askAiStyles.links);
    const linkPresentation = stylex.props(askAiStyles.link);
    const iconPresentation = stylex.props(askAiStyles.icon);

    return (
      <nav
        {...props}
        {...presentation}
        aria-label="Ask AI about this"
        className={cn(
          "hraness-ask-ai-about-this",
          presentation.className,
          className,
        )}
        data-slot="ask-ai-about-this"
        ref={ref}
        style={mergeStylexInlineStyles(presentation.style, style)}
      >
        <span
          {...labelPresentation}
          className={cn(
            "hraness-ask-ai-about-this__label",
            labelPresentation.className,
          )}
          data-slot="ask-ai-about-this-label"
        >
          Ask AI about this
        </span>
        <span
          {...linksPresentation}
          className={cn(
            "hraness-ask-ai-about-this__links",
            linksPresentation.className,
          )}
          data-slot="ask-ai-about-this-links"
        >
          {links.map((link, index) => {
            const definition = providerDefinitions[index];
            if (
              definition === undefined
              || definition.provider !== link.provider
            ) {
              throw new Error("Ask AI provider definitions are out of order.");
            }

            return (
              <a
                {...linkPresentation}
                className={cn(
                  "hraness-ask-ai-about-this__link",
                  linkPresentation.className,
                )}
                data-ask-ai-provider={link.provider}
                data-slot="ask-ai-about-this-link"
                href={link.href}
                key={link.provider}
                rel="noopener noreferrer nofollow"
                target="_blank"
              >
                <HugeiconsIcon
                  {...iconPresentation}
                  aria-hidden="true"
                  className={cn(
                    "hraness-ask-ai-about-this__icon",
                    iconPresentation.className,
                  )}
                  color="currentColor"
                  data-slot="ask-ai-about-this-icon"
                  icon={definition.icon}
                  size={15}
                  strokeWidth={1.5}
                />
                <span data-slot="ask-ai-about-this-provider-label">
                  {link.label}
                </span>
              </a>
            );
          })}
        </span>
      </nav>
    );
  },
);

AskAiAboutThis.displayName = "AskAiAboutThis";
