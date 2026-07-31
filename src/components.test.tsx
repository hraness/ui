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
