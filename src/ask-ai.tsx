import * as stylex from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { forwardRef, type CSSProperties, type HTMLAttributes } from "react";

import {
  askAiProviderMarks,
  type AskAiProviderMark,
} from "./ask-ai-marks.generated.js";
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
  label: AskAiProviderLink["label"];
  mark: AskAiProviderMark;
  parameter: "q" | "text";
  provider: AskAiProvider;
}>;

function requiredMark(provider: AskAiProvider): AskAiProviderMark {
  const mark: AskAiProviderMark | undefined = askAiProviderMarks[provider];
  if (mark === undefined) {
    throw new Error(`The shared provider-mark registry must cover ${provider}.`);
  }
  return mark;
}

const providerDefinitions = [
  {
    baseUrl: "https://chatgpt.com/",
    label: "ChatGPT",
    mark: requiredMark("chatgpt"),
    parameter: "q",
    provider: "chatgpt",
  },
  {
    baseUrl: "https://claude.ai/new",
    label: "Claude",
    mark: requiredMark("claude"),
    parameter: "q",
    provider: "claude",
  },
  {
    baseUrl: "https://perplexity.ai/",
    label: "Perplexity",
    mark: requiredMark("perplexity"),
    parameter: "q",
    provider: "perplexity",
  },
  {
    baseUrl: "https://x.com/i/grok",
    label: "Grok",
    mark: requiredMark("grok"),
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
    const iconGlyphPresentation = stylex.props(askAiStyles.iconGlyph);
    const iconArtPresentation = stylex.props(askAiStyles.iconArt);

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
                <span
                  {...iconPresentation}
                  aria-hidden="true"
                  className={cn(
                    "hraness-ask-ai-about-this__icon",
                    iconPresentation.className,
                  )}
                  data-slot="ask-ai-about-this-icon"
                  style={
                    { "--_ask-ai-accent": definition.mark.accent } as CSSProperties
                  }
                >
                  <svg
                    {...iconGlyphPresentation}
                    aria-hidden="true"
                    className={cn(
                      "hraness-ask-ai-about-this__icon-glyph",
                      iconGlyphPresentation.className,
                    )}
                    dangerouslySetInnerHTML={{
                      __html: definition.mark.glyph.body,
                    }}
                    fill="currentColor"
                    viewBox={definition.mark.glyph.viewBox}
                  />
                  {definition.mark.art === null ? null : (
                    <svg
                      {...iconArtPresentation}
                      aria-hidden="true"
                      className={cn(
                        "hraness-ask-ai-about-this__icon-art",
                        iconArtPresentation.className,
                      )}
                      dangerouslySetInnerHTML={{
                        __html: definition.mark.art.body,
                      }}
                      viewBox={definition.mark.art.viewBox}
                    />
                  )}
                </span>
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
