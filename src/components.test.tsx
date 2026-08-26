import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Tag,
  TextField,
} from "./index.js";

test("Button keeps native and React Aria disabled semantics", () => {
  const html = renderToStaticMarkup(
    <Button
      aria-label="Delete project"
      className="delete-project"
      isDisabled
      variant="danger"
    >
      Delete project
    </Button>,
  );

  expect(html).toContain("<button");
  expect(html).toContain('aria-label="Delete project"');
  expect(html).toContain('disabled=""');
  expect(html).toContain('data-disabled="true"');
  expect(html).toContain('data-variant="danger"');
  expect(html).toContain("hraness-button__control");
  expect(html).toContain("delete-project");
});

test("Badge and Card expose predictable composition slots", () => {
  const html = renderToStaticMarkup(
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Local server</CardTitle>
        <CardDescription>Listening on port 3000.</CardDescription>
      </CardHeader>
      <CardContent>
        <Badge tone="success">Ready</Badge>
      </CardContent>
      <CardFooter>Open application</CardFooter>
    </Card>,
  );

  expect(html).toContain('data-slot="card"');
  expect(html).toContain('data-slot="card-title"');
  expect(html).toContain('data-slot="card-description"');
  expect(html).toContain('data-slot="card-content"');
  expect(html).toContain('data-slot="card-footer"');
  expect(html).toContain('data-slot="badge"');
  expect(html).toContain('data-tone="success"');
  expect(html).toContain("max-w-md");
});

test("Tag exposes stable variants and an optional decorative icon", () => {
  const html = renderToStaticMarkup(
    <>
      <Tag
        accentColor="#D97706"
        className="project-tag"
        icon="🧭"
        style={{ marginInlineStart: "1rem" }}
        variant="outline"
      >
        linked project
      </Tag>
      <Tag variant="outline">linked project without an accent</Tag>
      <Tag>project</Tag>
      <Tag icon={null} variant="muted">reading</Tag>
    </>,
  );

  expect(html).toMatch(/class="hraness-tag [^"]+ project-tag"/u);
  expect(html).toContain('data-slot="tag"');
  expect(html).toContain('data-variant="outline"');
  expect(html).toContain('--hraness-tag-accent:#D97706');
  expect(html).toContain('margin-inline-start:1rem');
  expect(html).toMatch(
    /<span(?=[^>]*aria-hidden="true")(?=[^>]*class="hraness-tag__icon [^"]+")(?=[^>]*data-slot="tag-icon")[^>]*>🧭<\/span>/u,
  );
  expect(html).toMatch(
    /<span class="hraness-tag__label [^"]+" data-slot="tag-label">linked project<\/span>/u,
  );
  expect(html.match(/data-slot="tag-icon"/gu)).toHaveLength(1);
  expect(html.match(/data-variant="outline"/gu)).toHaveLength(2);
  expect(html).toContain("linked project without an accent");
  expect(html.match(/data-variant="default"/gu)).toHaveLength(1);
  expect(html.match(/data-variant="muted"/gu)).toHaveLength(1);
  expect(html).not.toContain('role="status"');
});

test("TextField connects its label, description, and validation error", () => {
  const html = renderToStaticMarkup(
    <TextField
      description="Used for local development notices."
      errorMessage="Enter a valid email address."
      inputProps={{
        autoComplete: "email",
      }}
      isInvalid
      label="Email"
      placeholder="you@example.com"
      type="email"
    />,
  );
  const labelFor = html.match(/<label[^>]*\sfor="([^"]+)"/u)?.[1];
  const inputId = html.match(/<input[^>]*\sid="([^"]+)"/u)?.[1];

  expect(labelFor).toBeDefined();
  expect(labelFor).toBe(inputId);
  expect(html).toContain("Email");
  expect(html).toContain('type="email"');
  expect(html).toContain('placeholder="you@example.com"');
  expect(html).toContain('autoComplete="email"');
  expect(html).toContain('aria-describedby="');
  expect(html).toContain('aria-invalid="true"');
  expect(html).toContain("Used for local development notices.");
  expect(html).toContain("Enter a valid email address.");
});
