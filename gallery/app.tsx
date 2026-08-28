"use client";

import { Search01Icon } from "@hugeicons/core-free-icons";
import * as stylex from "@stylexjs/stylex";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  AppearanceIcon,
  Avatar,
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
  IconButton,
  IconLink,
  InlineAlert,
  KeyHint,
  Link,
  LinkButton,
  Progress,
  PressableCard,
  QuietSiteFooter,
  QuietSitePage,
  SegmentedControl,
  SelectField,
  Skeleton,
  SkipLink,
  SocialIcon,
  Spinner,
  StatusDot,
  Tabs,
  Tag,
  ThemedSurface,
  Toolbar,
  ToggleButton,
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

const gallerySegments = [
  { id: "all", label: "all" },
  { id: "projects", label: "projects" },
  { id: "shared", label: "shared" },
  { id: "dependencies", label: "dependencies" },
] as const;

const gallerySelectOptions = [
  { id: "followers", label: "followers", textValue: "followers" },
  { id: "following", label: "following", textValue: "following" },
] as const;

const galleryActionSizes = ["compact", "default", "large", "transport"] as const;

type GalleryTheme = "dark" | "light";
type GallerySegment = typeof gallerySegments[number]["id"];

const avatarImageSource =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' fill='%236366f1'/%3E%3Cpath d='M0 16 16 0v16Z' fill='%23f8fafc'/%3E%3C/svg%3E";

const galleryStyles = stylex.create({
  actionControlOverride: {
    alignItems: "stretch",
    backgroundColor: "var(--ui-secondary)",
    borderColor: "var(--ui-warning)",
    color: "var(--ui-secondary-foreground)",
    display: "grid",
    justifyContent: "start",
    minHeight: "3.5rem",
    paddingInline: "var(--space-5)",
    width: "15rem",
    ":focus-visible": {
      boxShadow: "none",
      outlineColor: "var(--ui-warning)",
      outlineOffset: "6px",
      outlineStyle: "dashed",
      outlineWidth: "3px",
    },
    ":hover": {
      backgroundColor: "var(--ui-accent)",
      color: "var(--ui-accent-foreground)",
    },
  },
  actionRootOverride: {
    display: "inline-grid",
    maxWidth: "17rem",
    verticalAlign: "bottom",
  },
  avatarOverride: {
    backgroundColor: "var(--ui-accent)",
    borderRadius: "var(--radius-sm)",
    height: "3rem",
    width: "3rem",
  },
  checkboxControlDynamicHeight: (height: string) => ({ minHeight: height }),
  checkboxControlOverride: {
    backgroundColor: "var(--ui-secondary)",
    gap: "var(--space-4)",
    gridTemplateColumns: "minmax(0, 1fr) auto",
  },
  checkboxRootDynamicWidth: (width: string) => ({ width }),
  checkboxRootOverride: {
    color: "var(--ui-primary)",
    display: "flex",
    gap: "var(--space-5)",
    gridTemplateColumns: "none",
  },
  cardDynamicWidth: (width: string) => ({ width }),
  cardOverride: {
    backgroundColor: "var(--ui-secondary)",
    borderColor: "var(--ui-primary)",
    borderRadius: "var(--radius-sm)",
    boxShadow: "none",
    color: "var(--ui-secondary-foreground)",
    gap: "var(--space-2)",
    paddingInline: "var(--space-2)",
  },
  cardPartOverride: {
    color: "var(--ui-primary)",
    paddingInline: "var(--space-2)",
  },
  keyHintDynamicWidth: (width: string) => ({ width }),
  keyHintOverride: {
    alignItems: "stretch",
    backgroundColor: "var(--ui-secondary)",
    borderColor: "var(--ui-primary)",
    borderRadius: "var(--radius-lg)",
    color: "var(--ui-secondary-foreground)",
    fontFamily: "var(--ui-font-heading)",
    fontSize: "var(--text-body)",
    justifyContent: "flex-start",
    minHeight: "2rem",
    minWidth: "2rem",
    paddingInline: "var(--space-2)",
  },
  linkDynamicLetterSpacing: (letterSpacing: string) => ({ letterSpacing }),
  linkOverride: {
    color: "var(--ui-foreground)",
    textDecorationThickness: "3px",
    ":focus-visible": {
      outlineColor: "var(--ui-warning)",
      outlineOffset: "6px",
      outlineStyle: "dashed",
      outlineWidth: "3px",
    },
    ":hover": {
      textDecorationThickness: "4px",
    },
  },
  pressableCardOverride: {
    outlineColor: "var(--ui-warning)",
    outlineOffset: "7px",
    outlineWidth: "4px",
    transform: "none",
    transitionDuration: "0s, 0s, 0s",
  },
  quietSiteFooterOverride: {
    "max-inline-size": "35rem",
  },
  statusDotOverride: {
    backgroundColor: "var(--ui-primary)",
    height: "1rem",
    width: "1rem",
  },
  statusPillOverride: {
    backgroundColor: "var(--ui-accent)",
    borderColor: "var(--ui-primary)",
    borderRadius: "var(--radius-sm)",
    color: "var(--ui-accent-foreground)",
    minHeight: "2rem",
    width: "8rem",
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
  toolbarDynamicWidth: (width: string) => ({ width }),
  toolbarOverride: {
    alignItems: "end",
    backgroundColor: "var(--ui-secondary)",
    borderColor: "var(--ui-primary)",
    borderRadius: "var(--radius-sm)",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: "var(--space-2)",
    paddingBlock: "var(--space-2)",
    paddingInline: "var(--space-2)",
    ":focus-visible": {
      outlineColor: "var(--ui-warning)",
      outlineOffset: "7px",
      outlineStyle: "dashed",
      outlineWidth: "4px",
    },
  },
  wrappingRowConstraint: {
    "inline-size": "11rem",
  },
});

export function PrimitiveGallery() {
  const [cardPressCount, setCardPressCount] = useState(0);
  const [pressCount, setPressCount] = useState(0);
  const [segment, setSegment] = useState<GallerySegment>("all");
  const [theme, setTheme] = useState<GalleryTheme>("light");
  const checkboxFieldRef = useRef<HTMLDivElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const captureCheckboxFieldRef = useCallback((node: HTMLDivElement | null) => {
    checkboxFieldRef.current = node;
  }, []);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-gallery-hydration-root]");
    if (root === null) throw new Error("The primitive gallery hydration root is missing.");
    const checkboxField = checkboxFieldRef.current;
    if (checkboxField === null) {
      throw new Error("The CheckboxField callback ref did not receive its native div.");
    }
    const toolbar = toolbarRef.current;
    if (toolbar === null) throw new Error("The Toolbar ref did not receive its native div.");
    const link = linkRef.current;
    if (link === null) throw new Error("The Link ref did not receive its native anchor.");
    root.dataset.hydrated = "true";
    checkboxField.dataset.galleryCheckboxFieldRef = "true";
    link.dataset.galleryLinkRef = "true";
    toolbar.dataset.galleryToolbarRef = "true";
    return () => {
      delete root.dataset.hydrated;
      delete checkboxField.dataset.galleryCheckboxFieldRef;
      delete link.dataset.galleryLinkRef;
      delete toolbar.dataset.galleryToolbarRef;
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
            semantic hooks, browser interaction, and the current package-compiled
            StyleX recipes.
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

          <div
            data-gallery-action-family-layer-conflict="true"
            data-gallery-action-row="true"
          >
            <Button
              className="gallery-action gallery-action--default"
              controlClassName="gallery-action-control gallery-action-control--default"
              data-gallery-action="default"
              data-gallery-primary-action="true"
              leading={<Icon icon={Search01Icon} />}
              onPress={() => setPressCount((count) => count + 1)}
              variant="primary"
            >
              Run primitive check
            </Button>
            <Button
              className="gallery-action gallery-action--override"
              controlClassName="gallery-action-control gallery-action-control--override"
              controlXstyle={galleryStyles.actionControlOverride}
              data-gallery-action="override"
              variant="primary"
              xstyle={galleryStyles.actionRootOverride}
            >
              Caller action
            </Button>
            <output aria-live="polite" data-gallery-press-count="true">
              Runs: {pressCount}
            </output>
          </div>

          <div data-gallery-link-row="true">
            <Link
              className="gallery-link gallery-link--default"
              data-gallery-link="default"
              data-gallery-link-empty-xstyle="true"
              data-gallery-link-layer-conflict="true"
              href="/reference"
              xstyle={[false, null, undefined, []]}
            >
              Default reference
            </Link>
            <Link
              className="gallery-link gallery-link--override"
              data-gallery-link="override"
              data-gallery-link-layer-conflict="true"
              data-gallery-link-native-style-last="true"
              href="/reference?presentation=override"
              linkRef={linkRef}
              style={({ isHovered }) => ({
                letterSpacing: isHovered ? "2px" : "1px",
              })}
              xstyle={[
                galleryStyles.linkOverride,
                galleryStyles.linkDynamicLetterSpacing("0.5px"),
              ]}
            >
              Caller reference
            </Link>
          </div>

          <div data-gallery-checkbox-row="true">
            <CheckboxField
              className="gallery-checkbox gallery-checkbox--default"
              controlClassName="gallery-checkbox-control gallery-checkbox-control--default"
              data-gallery-checkbox="default"
              data-gallery-checkbox-field-layer-conflict="true"
              description="The browser harness toggles this control with the Space key."
              fieldRef={captureCheckboxFieldRef}
              label="Preserve accessible interaction"
              name="gallery-default-checkbox"
            />
            <CheckboxField
              className="gallery-checkbox gallery-checkbox--override"
              controlClassName="gallery-checkbox-control gallery-checkbox-control--override"
              controlXstyle={[
                galleryStyles.checkboxControlOverride,
                galleryStyles.checkboxControlDynamicHeight("3.25rem"),
              ]}
              data-gallery-checkbox="override"
              data-gallery-checkbox-field-layer-conflict="true"
              description="The accessible name remains when visible label copy is hidden."
              isDisabled
              isInvalid
              isSelected
              label="Select archived projects"
              name="gallery-override-checkbox"
              showLabel={false}
              style={{ width: "15rem" }}
              xstyle={[
                galleryStyles.checkboxRootOverride,
                galleryStyles.checkboxRootDynamicWidth("14rem"),
              ]}
            />
          </div>
          <SelectField
            className="gallery-select"
            data-gallery-select="true"
            defaultValue="followers"
            label="Profile metric"
            options={gallerySelectOptions}
            showLabel={false}
            size="compact"
          />
        </section>

        <section aria-labelledby="gallery-key-hint-heading" data-gallery-section="key-hints">
          <div data-gallery-section-heading="true">
            <div>
              <h2 id="gallery-key-hint-heading">Key hints</h2>
              <p>Native keyboard notation keeps its compact recipe and caller-last presentation.</p>
            </div>
          </div>
          <div data-gallery-key-hint-row="true">
            <span>
              Open commands{" "}
              <KeyHint
                className="gallery-key-hint gallery-key-hint--default"
                data-gallery-key-hint="default"
                data-gallery-key-hint-layer-conflict="true"
                title="Command K"
              >
                ⌘K
              </KeyHint>
            </span>
            <span>
              Dismiss{" "}
              <KeyHint
                aria-label="Escape"
                className="gallery-key-hint gallery-key-hint--override"
                data-gallery-key-hint="override"
                data-gallery-key-hint-layer-conflict="true"
                style={{ width: "3rem" }}
                xstyle={[
                  galleryStyles.keyHintOverride,
                  galleryStyles.keyHintDynamicWidth("2.5rem"),
                ]}
              >
                Esc
              </KeyHint>
            </span>
          </div>
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
          <SegmentedControl
            aria-label="Systems shown"
            className="gallery-segmented-control"
            items={gallerySegments}
            onChange={setSegment}
            size="compact"
            value={segment}
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

        <section aria-labelledby="gallery-avatar-heading" data-gallery-section="avatars">
          <div data-gallery-section-heading="true">
            <div>
              <h2 id="gallery-avatar-heading">Avatars</h2>
              <p>Finite squares preserve deterministic fallbacks, image cropping, and caller overrides.</p>
            </div>
          </div>
          <div data-gallery-avatar-row="true">
            <Avatar
              alt="Small Ada profile"
              className="gallery-avatar gallery-avatar--small"
              data-gallery-avatar-layer-conflict="true"
              data-gallery-avatar-size="small"
              name="Ada Lovelace"
              size="small"
            />
            <Avatar
              alt="Default Grace profile"
              className="gallery-avatar gallery-avatar--default"
              data-gallery-avatar-layer-conflict="true"
              data-gallery-avatar-size="default"
              name="Grace Hopper"
            />
            <Avatar
              alt="Large Katherine profile"
              className="gallery-avatar gallery-avatar--large"
              data-gallery-avatar-layer-conflict="true"
              data-gallery-avatar-size="large"
              name="Katherine Johnson"
              size="large"
            />
            <Avatar
              alt="Geometric profile"
              className="gallery-avatar gallery-avatar--image"
              data-gallery-avatar-image="true"
              data-gallery-avatar-layer-conflict="true"
              name="Geometric profile"
              src={avatarImageSource}
            />
            <Avatar
              alt="Override profile"
              className="gallery-avatar gallery-avatar--override"
              data-gallery-avatar-layer-conflict="true"
              data-gallery-avatar-override="true"
              name="Override Profile"
              size="small"
              style={{ height: "4rem", width: "4rem" }}
              xstyle={galleryStyles.avatarOverride}
            />
          </div>
        </section>

        <section aria-labelledby="gallery-status-family-heading" data-gallery-section="status-family">
          <div data-gallery-section-heading="true">
            <div>
              <h2 id="gallery-status-family-heading">Status family</h2>
              <p>Finite tones, compact geometry, public accents, and decorative dots share one boundary.</p>
            </div>
          </div>
          <div data-gallery-status-family-row="badges">
            <Badge className="gallery-badge gallery-badge--neutral" data-gallery-badge-tone="neutral" data-gallery-status-family-layer-conflict="true">Neutral</Badge>
            <Badge className="gallery-badge gallery-badge--info" data-gallery-badge-tone="info" data-gallery-status-family-layer-conflict="true" tone="info">Info</Badge>
            <Badge className="gallery-badge gallery-badge--success" data-gallery-badge-tone="success" data-gallery-status-family-layer-conflict="true" isLive tone="success">Success</Badge>
            <Badge className="gallery-badge gallery-badge--warning" data-gallery-badge-tone="warning" data-gallery-status-family-layer-conflict="true" tone="warning">Warning</Badge>
            <Badge className="gallery-badge gallery-badge--danger" data-gallery-badge-tone="danger" data-gallery-status-family-layer-conflict="true" tone="danger">Danger</Badge>
          </div>
          <div data-gallery-status-family-row="tags">
            <Tag className="gallery-tag gallery-tag--default" data-gallery-status-family-layer-conflict="true" data-gallery-tag-variant="default" icon="◆">Default</Tag>
            <Tag className="gallery-tag gallery-tag--muted" data-gallery-status-family-layer-conflict="true" data-gallery-tag-variant="muted" variant="muted">Muted</Tag>
            <Tag accentColor="#D97706" className="gallery-tag gallery-tag--outline" data-gallery-status-family-layer-conflict="true" data-gallery-tag-variant="outline" variant="outline">Outline</Tag>
          </div>
          <div data-gallery-status-family-row="dots">
            <StatusDot className="gallery-dot gallery-dot--neutral" data-gallery-status-dot-tone="neutral" data-gallery-status-family-layer-conflict="true" />
            <StatusDot className="gallery-dot gallery-dot--info" data-gallery-status-dot-tone="info" data-gallery-status-family-layer-conflict="true" tone="info" />
            <StatusDot className="gallery-dot gallery-dot--success" data-gallery-status-dot-tone="success" data-gallery-status-family-layer-conflict="true" tone="success" />
            <StatusDot className="gallery-dot gallery-dot--warning" data-gallery-status-dot-tone="warning" data-gallery-status-family-layer-conflict="true" tone="warning" />
            <StatusDot className="gallery-dot gallery-dot--danger" data-gallery-status-dot-tone="danger" data-gallery-status-family-layer-conflict="true" tone="danger" />
          </div>
          <div data-gallery-status-family-row="overrides">
            <Badge
              className="gallery-badge gallery-badge--override"
              data-gallery-status-family-layer-conflict="true"
              data-gallery-status-family-override="badge"
              style={{ minHeight: "2.5rem", width: "9rem" }}
              tone="danger"
              xstyle={galleryStyles.statusPillOverride}
            >
              Badge override
            </Badge>
            <Tag
              className="gallery-tag gallery-tag--override"
              data-gallery-status-family-layer-conflict="true"
              data-gallery-status-family-override="tag"
              style={{ minHeight: "2.5rem", width: "9rem" }}
              variant="muted"
              xstyle={galleryStyles.statusPillOverride}
            >
              Tag override
            </Tag>
            <StatusDot
              className="gallery-dot gallery-dot--override"
              data-gallery-status-family-layer-conflict="true"
              data-gallery-status-family-override="dot"
              style={{ height: "1.25rem", width: "1.25rem" }}
              tone="danger"
              xstyle={galleryStyles.statusDotOverride}
            />
          </div>
        </section>

        <section aria-labelledby="gallery-card-family-heading" data-gallery-section="card-family">
          <div data-gallery-section-heading="true">
            <div>
              <h2 id="gallery-card-family-heading">Card family</h2>
              <p>Finite tones, shapes, inherited descriptions, and React Aria interaction share one compiled boundary.</p>
            </div>
          </div>
          <div data-gallery-card-family-grid="cards">
            <Card className="gallery-card gallery-card--card" data-gallery-card-family-layer-conflict="true" data-gallery-card-tone="card" tone="card">
              <CardHeader>
                <CardTitle>Card tone</CardTitle>
                <CardDescription>Default description</CardDescription>
              </CardHeader>
              <CardContent>Rounded content</CardContent>
              <CardFooter>Footer</CardFooter>
            </Card>
            <Card className="gallery-card gallery-card--neutral" data-gallery-card-family-layer-conflict="true" data-gallery-card-tone="neutral" shape="rectangular" tone="neutral">
              <CardHeader>
                <CardTitle>Neutral tone</CardTitle>
                <CardDescription>Rectangular description</CardDescription>
              </CardHeader>
            </Card>
            <Card className="gallery-card gallery-card--accent" data-gallery-card-family-layer-conflict="true" data-gallery-card-tone="accent" tone="accent">
              <CardHeader>
                <CardTitle>Accent tone</CardTitle>
                <CardDescription>Accent description</CardDescription>
              </CardHeader>
            </Card>
            <Card className="gallery-card gallery-card--inverse" data-gallery-card-family-layer-conflict="true" data-gallery-card-tone="inverse" shape="rectangular" tone="inverse">
              <CardHeader>
                <CardTitle>Inverse tone</CardTitle>
                <CardDescription>Inverse description</CardDescription>
              </CardHeader>
            </Card>
          </div>
          <div data-gallery-card-family-grid="pressables">
            <PressableCard
              aria-label="Run Card-family action"
              className="gallery-pressable-card gallery-pressable-card--interactive"
              data-gallery-card-family-layer-conflict="true"
              data-gallery-pressable-card-tone="accent"
              data-gallery-pressable-card-state="interactive"
              onPress={() => setCardPressCount((count) => count + 1)}
              tone="accent"
            >
              Interactive PressableCard
            </PressableCard>
            <PressableCard
              className="gallery-pressable-card gallery-pressable-card--neutral"
              data-gallery-card-family-layer-conflict="true"
              data-gallery-pressable-card-tone="neutral"
              shape="rectangular"
              tone="neutral"
            >
              Neutral rectangular
            </PressableCard>
            <PressableCard
              className="gallery-pressable-card gallery-pressable-card--disabled"
              data-gallery-card-family-layer-conflict="true"
              data-gallery-pressable-card-tone="card"
              data-gallery-pressable-card-state="disabled"
              isDisabled
              tone="card"
            >
              Disabled PressableCard
            </PressableCard>
            <PressableCard
              className="gallery-pressable-card gallery-pressable-card--pending"
              data-gallery-card-family-layer-conflict="true"
              data-gallery-pressable-card-tone="inverse"
              data-gallery-pressable-card-state="pending"
              isPending
              shape="rectangular"
              tone="inverse"
            >
              {({ isPending }) => isPending ? "Pending PressableCard" : "Ready PressableCard"}
            </PressableCard>
          </div>
          <div data-gallery-card-family-grid="overrides">
            <Card
              className="gallery-card gallery-card--class-variable"
              data-gallery-card-class-variable="true"
              data-gallery-card-family-layer-conflict="true"
              tone="accent"
            >
              <CardHeader>
                <CardTitle>Caller class variable</CardTitle>
                <CardDescription>
                  Unlayered class description override
                </CardDescription>
              </CardHeader>
            </Card>
            <Card
              className="gallery-card gallery-card--override"
              data-gallery-card-family-layer-conflict="true"
              data-gallery-card-family-override="card"
              style={{
                "--hraness-card-description": "rgb(11, 12, 13)",
                backgroundColor: "rgb(7, 8, 9)",
                borderRadius: "13px",
                width: "15rem",
              } as CSSProperties}
              tone="accent"
              xstyle={[
                galleryStyles.cardOverride,
                galleryStyles.cardDynamicWidth("14rem"),
              ]}
            >
              <CardHeader xstyle={galleryStyles.cardPartOverride}>
                <CardTitle xstyle={galleryStyles.cardPartOverride}>Caller Card</CardTitle>
                <CardDescription
                  style={{ color: "rgb(14, 15, 16)" }}
                  xstyle={galleryStyles.cardPartOverride}
                >
                  Native description override
                </CardDescription>
              </CardHeader>
              <CardContent xstyle={galleryStyles.cardPartOverride}>
                <span
                  data-gallery-card-variable-override="true"
                  style={{ color: "var(--hraness-card-description)" }}
                >
                  Inherited caller variable
                </span>
              </CardContent>
              <CardFooter xstyle={galleryStyles.cardPartOverride}>Caller footer</CardFooter>
            </Card>
            <PressableCard
              aria-label="Caller override PressableCard"
              className="gallery-pressable-card gallery-pressable-card--override"
              data-gallery-card-family-layer-conflict="true"
              data-gallery-card-family-override="pressable"
              onPress={() => setCardPressCount((count) => count + 1)}
              style={({ isFocusVisible }) => ({
                backgroundColor: isFocusVisible
                  ? "rgb(21, 22, 23)"
                  : "rgb(17, 18, 19)",
                borderRadius: "13px",
                width: "15rem",
              })}
              tone="accent"
              xstyle={[
                galleryStyles.cardOverride,
                galleryStyles.cardDynamicWidth("14rem"),
                galleryStyles.pressableCardOverride,
              ]}
            >
              Caller PressableCard
            </PressableCard>
            <Card
              className="gallery-card gallery-card--nested"
              data-gallery-card-nested-outer="true"
              style={{
                "--hraness-card-description": "rgb(41, 42, 43)",
              } as CSSProperties}
              tone="accent"
            >
              <CardHeader>
                <CardTitle>Nested description reset</CardTitle>
                <CardDescription data-gallery-card-nested-outer-description="true">
                  Caller-owned outer description
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Card data-gallery-card-nested-inner="true" tone="inverse">
                  <CardHeader>
                    <CardTitle>Nested inverse Card</CardTitle>
                    <CardDescription data-gallery-card-nested-inner-description="true">
                      Tone-owned inner description
                    </CardDescription>
                  </CardHeader>
                </Card>
              </CardContent>
            </Card>
          </div>
          <output aria-live="polite" data-gallery-card-press-count="true">
            Card presses: {cardPressCount}
          </output>
        </section>

        <section aria-labelledby="gallery-toolbar-heading" data-gallery-section="toolbars">
          <div data-gallery-section-heading="true">
            <div>
              <h2 id="gallery-toolbar-heading">Toolbars</h2>
              <p>Finite orientation, accessible naming, arrow navigation, and caller focus recipes share one compiled boundary.</p>
            </div>
          </div>
          <div data-gallery-toolbar-grid="true">
            <Toolbar
              aria-label="Horizontal editor actions"
              className="gallery-toolbar gallery-toolbar--horizontal"
              data-gallery-toolbar-layer-conflict="true"
              data-gallery-toolbar-orientation="horizontal"
              data-gallery-toolbar-native-focus="true"
            >
              <button type="button">Undo</button>
              <button type="button">Redo</button>
            </Toolbar>
            <span id="gallery-vertical-toolbar-name">Vertical editor actions</span>
            <Toolbar
              aria-labelledby="gallery-vertical-toolbar-name"
              className="gallery-toolbar gallery-toolbar--vertical"
              data-gallery-toolbar-layer-conflict="true"
              data-gallery-toolbar-orientation="vertical"
              orientation="vertical"
            >
              <button type="button">Move up</button>
              <button type="button">Move down</button>
            </Toolbar>
            <Toolbar
              aria-label="Caller override toolbar"
              className="gallery-toolbar gallery-toolbar--override"
              data-gallery-toolbar-layer-conflict="true"
              data-gallery-toolbar-override="true"
              orientation="vertical"
              ref={toolbarRef}
              style={({ orientation }) => ({
                width: orientation === "horizontal" ? "15rem" : "13rem",
              })}
              xstyle={[
                galleryStyles.toolbarOverride,
                galleryStyles.toolbarDynamicWidth("14rem"),
              ]}
            >
              <button type="button">Align start</button>
              <button type="button">Align end</button>
            </Toolbar>
          </div>
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

        <section
          aria-labelledby="gallery-coarse-actions-heading"
          data-gallery-section="coarse-actions"
        >
          <div data-gallery-section-heading="true">
            <div>
              <h2 id="gallery-coarse-actions-heading">Coarse action targets</h2>
              <p>Real touch-pointer evidence covers every action density and presentation.</p>
            </div>
          </div>
          <div data-gallery-coarse-action-matrix="true">
            {galleryActionSizes.map((size) => (
              <div data-gallery-coarse-action-row={size} key={size}>
                <span data-gallery-coarse-action-size={size}>{size}</span>
                <Button
                  aria-label={`${size} button`}
                  data-gallery-coarse-kind="button"
                  data-gallery-coarse-size={size}
                  size={size}
                >
                  B
                </Button>
                <LinkButton
                  aria-label={`${size} link button`}
                  data-gallery-coarse-kind="link-button"
                  data-gallery-coarse-size={size}
                  href={`/coarse-targets/${size}/link-button`}
                  size={size}
                >
                  L
                </LinkButton>
                <IconButton
                  aria-label={`${size} icon button`}
                  data-gallery-coarse-kind="icon-button"
                  data-gallery-coarse-size={size}
                  size={size}
                >
                  I
                </IconButton>
                <IconLink
                  aria-label={`${size} control icon link`}
                  data-gallery-coarse-kind="control-icon-link"
                  data-gallery-coarse-size={size}
                  href={`/coarse-targets/${size}/icon-link`}
                  size={size}
                >
                  L
                </IconLink>
                <ToggleButton
                  aria-label={`${size} toggle button`}
                  data-gallery-coarse-kind="toggle-button"
                  data-gallery-coarse-size={size}
                  size={size}
                >
                  T
                </ToggleButton>
                <ToggleButton
                  aria-label={`${size} icon toggle`}
                  data-gallery-coarse-kind="icon-toggle-button"
                  data-gallery-coarse-size={size}
                  isIconOnly
                  size={size}
                >
                  T
                </ToggleButton>
              </div>
            ))}
            <div data-gallery-coarse-action-row="inline">
              <span data-gallery-coarse-action-size="inline">inline</span>
              <IconLink
                aria-label="Inline icon link"
                data-gallery-coarse-kind="inline-icon-link"
                data-gallery-coarse-size="inline"
                href="/coarse-targets/inline-icon-link"
                presentation="inline"
              >
                L
              </IconLink>
            </div>
          </div>
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
