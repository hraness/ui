"use client";

import { Search01Icon } from "@hugeicons/core-free-icons";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";

import {
  AppearanceIcon,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  CheckboxField,
  Icon,
  InlineAlert,
  Progress,
  QuietSiteFooter,
  QuietSitePage,
  Skeleton,
  SkipLink,
  SocialIcon,
  Spinner,
  StatusDot,
  Tabs,
  Tag,
  ThemedSurface,
  ViewportFrame,
  WrappingRow,
} from "@hraness/ui";

const galleryTabs = [
  {
    id: "semantics",
    label: "Semantics",
    panel: "Native landmarks and accessible names remain the primary contract.",
  },
  {
    id: "states",
    label: "States",
    panel: "Stable data attributes expose interaction state without generated selectors.",
  },
] as const;

type GalleryTheme = "dark" | "light";

const galleryStyles = stylex.create({
  quietSiteFooterOverride: {
    "max-inline-size": "35rem",
  },
  themedSurfaceTexture: {
    backgroundColor: "var(--ui-secondary)",
    backgroundImage:
      "repeating-linear-gradient(135deg, transparent 0 2px, currentColor 2px 3px)",
    backgroundPosition: "0 0",
    backgroundRepeat: "repeat",
    backgroundSize: "4px 4px",
    borderColor: "var(--ui-primary)",
    borderRadius: "var(--radius-sm)",
    color: "var(--ui-secondary-foreground)",
    paddingInline: "var(--space-2)",
  },
  wrappingRowConstraint: {
    "inline-size": "11rem",
  },
});

export function PrimitiveGallery() {
  const [pressCount, setPressCount] = useState(0);
  const [theme, setTheme] = useState<GalleryTheme>("light");

  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-gallery-hydration-root]");
    if (root === null) throw new Error("The primitive gallery hydration root is missing.");
    root.dataset.hydrated = "true";
    return () => {
      delete root.dataset.hydrated;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div data-gallery-root="true">
      <SkipLink href="#primitive-gallery-main" />
      <QuietSitePage
        className="gallery-quiet-site-page"
        data-gallery-quiet-site-layer-conflict="true"
        data-gallery-quiet-site-page="true"
        id="primitive-gallery-main"
      >
        <header data-gallery-intro="true">
          <p data-gallery-eyebrow="true">@hraness/ui primitive harness</p>
          <h1>Portable component behavior and presentation</h1>
          <p>
            The executable gallery verifies the packed default stylesheet,
            semantic hooks, browser interaction, and the current StyleX icon and
            quiet-site recipes.
          </p>
        </header>

        <section aria-labelledby="gallery-actions-heading" data-gallery-section="actions">
          <div data-gallery-section-heading="true">
            <div>
              <h2 id="gallery-actions-heading">Actions and focus</h2>
              <p>Keyboard interaction drives the same React Aria state as pointer input.</p>
            </div>
            <Button
              data-gallery-theme-toggle="true"
              leading={<AppearanceIcon name={theme} />}
              onPress={() => setTheme((current) => current === "light" ? "dark" : "light")}
              variant="quiet"
            >
              Use {theme === "light" ? "dark" : "light"} theme
            </Button>
          </div>

          <div data-gallery-action-row="true">
            <Button
              data-gallery-primary-action="true"
              leading={<Icon icon={Search01Icon} />}
              onPress={() => setPressCount((count) => count + 1)}
              variant="primary"
            >
              Run primitive check
            </Button>
            <output aria-live="polite" data-gallery-press-count="true">
              Runs: {pressCount}
            </output>
          </div>

          <CheckboxField
            data-gallery-checkbox="true"
            description="The browser harness toggles this control with the Space key."
            label="Preserve accessible interaction"
          />
        </section>

        <section aria-labelledby="gallery-icon-heading" data-gallery-section="icons">
          <div data-gallery-section-heading="true">
            <div>
              <h2 id="gallery-icon-heading">Icon compiler canary</h2>
              <p>These glyphs remain decorative and inherit the surrounding current color.</p>
            </div>
          </div>
          <Card data-gallery-icon-card="true" tone="accent">
            <CardHeader>
              <div data-gallery-icon-canary="true">
                <Icon icon={Search01Icon} size={28} strokeWidth={2} />
              </div>
              <CardTitle>Package-compiled StyleX</CardTitle>
              <CardDescription>
                The packed stylesheet supplies the glyph and wrapper declarations.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div data-gallery-icon-family="true">
                <p data-gallery-icon-wrapper-canary="true">
                  <SocialIcon className="gallery-social-icon" name="github" /> GitHub
                  {" · "}<SocialIcon name="substack" /> Substack
                  {" · "}
                  <AppearanceIcon
                    className="gallery-appearance-icon"
                    name="system"
                  /> System
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <Tag icon="◆" variant="outline">stable semantic hooks</Tag>
            </CardFooter>
          </Card>
        </section>

        <section aria-labelledby="gallery-collections-heading" data-gallery-section="collections">
          <div data-gallery-section-heading="true">
            <div>
              <h2 id="gallery-collections-heading">Collections</h2>
              <p>Arrow keys move selection while labels and panels share one source.</p>
            </div>
          </div>
          <Tabs
            aria-label="Primitive gallery evidence"
            data-gallery-tabs="true"
            defaultValue="semantics"
            items={galleryTabs}
            size="compact"
          />
        </section>

        <section aria-labelledby="gallery-feedback-heading" data-gallery-section="feedback">
          <div data-gallery-section-heading="true">
            <div>
              <h2 id="gallery-feedback-heading">Status and feedback</h2>
              <p>Motion preferences and forced colors retain readable state.</p>
            </div>
          </div>
          <div data-gallery-status-row="true">
            <Badge tone="success"><StatusDot tone="success" /> Ready</Badge>
            <Tag variant="muted">package consumer</Tag>
            <Spinner label="Checking primitives" size="small" />
          </div>
          <InlineAlert title="Migration boundary" tone="info">
            Quiet-site landmarks now use package-compiled StyleX while later families
            remain on their legacy recipes.
          </InlineAlert>
          <Progress label="Harness coverage" showValue value={78} />
          <Skeleton height="1rem" isText width="68%" />
        </section>

        <section aria-labelledby="gallery-structure-heading" data-gallery-section="structure">
          <div data-gallery-section-heading="true">
            <div>
              <h2 id="gallery-structure-heading">Structural surfaces</h2>
              <p>Logical sizing keeps wrapping and viewport ownership writing-mode aware.</p>
            </div>
          </div>
          <WrappingRow
            aria-label="Constrained structural row"
            className="gallery-wrapping-row"
            data-gallery-wrapping-row-layer-conflict="true"
            data-gallery-wrapping-row="true"
            xstyle={galleryStyles.wrappingRowConstraint}
          >
            <span data-gallery-wrapping-row-item="one">First item</span>
            <span data-gallery-wrapping-row-item="two">Second item</span>
          </WrappingRow>
          <ViewportFrame
            aria-hidden="true"
            as="section"
            className="gallery-viewport-frame"
            data-gallery-viewport-frame="true"
            data-gallery-viewport-frame-layer-conflict="true"
            style={{
              left: "-200vw",
              pointerEvents: "none",
              position: "fixed",
              top: 0,
              zIndex: -1,
            }}
          >
            <span>Off-canvas viewport canary</span>
          </ViewportFrame>
        </section>

        <section aria-labelledby="gallery-themed-surface-heading" data-gallery-section="themed-surfaces">
          <div data-gallery-section-heading="true">
            <div>
              <h2 id="gallery-themed-surface-heading">Themed surfaces</h2>
              <p>Finite tone and shape recipes remain composable by downstream presentation packages.</p>
            </div>
          </div>
          <div data-gallery-themed-surface-grid="true">
            <ThemedSurface
              className="gallery-themed-surface gallery-themed-surface--card"
              data-gallery-themed-surface-layer-conflict="true"
              data-gallery-themed-surface-tone="card"
              tone="card"
            >
              Card
            </ThemedSurface>
            <ThemedSurface
              className="gallery-themed-surface gallery-themed-surface--accent"
              data-gallery-themed-surface-layer-conflict="true"
              data-gallery-themed-surface-tone="accent"
              tone="accent"
            >
              Accent
            </ThemedSurface>
            <ThemedSurface
              className="gallery-themed-surface gallery-themed-surface--secondary"
              data-gallery-themed-surface-layer-conflict="true"
              data-gallery-themed-surface-tone="secondary"
              shape="rectangular"
              tone="secondary"
            >
              Secondary rectangular
            </ThemedSurface>
            <ThemedSurface
              className="gallery-themed-surface gallery-themed-surface--popover"
              data-gallery-themed-surface-layer-conflict="true"
              data-gallery-themed-surface-tone="popover"
              tone="popover"
            >
              Popover
            </ThemedSurface>
            <ThemedSurface
              className="gallery-themed-surface gallery-themed-surface--inverse"
              data-gallery-themed-surface-layer-conflict="true"
              data-gallery-themed-surface-tone="inverse"
              tone="inverse"
            >
              Inverse
            </ThemedSurface>
          </div>
          <ThemedSurface
            className="gallery-themed-surface-texture"
            data-gallery-themed-surface-layer-conflict="true"
            data-gallery-themed-surface-texture="true"
            style={{ backgroundPosition: "2px 3px" }}
            tone="accent"
            xstyle={galleryStyles.themedSurfaceTexture}
          >
            Downstream texture override
          </ThemedSurface>
        </section>
      </QuietSitePage>
      <QuietSiteFooter
        className="gallery-quiet-site-footer"
        data-gallery-quiet-site-priority3-conflict="true"
        data-gallery-quiet-site-footer="true"
        xstyle={galleryStyles.quietSiteFooterOverride}
      >
        Packed archive consumer · default stylesheet · React hydration
      </QuietSiteFooter>
    </div>
  );
}
