import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  Badge,
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  TextField,
} from "./index";

test("button variants expose complete, composable Tailwind recipes", () => {
  const classes = buttonVariants({ size: "icon", variant: "outline" });

  expect(classes).toContain("border-input");
  expect(classes).toContain("data-[hovered]:bg-accent");
  expect(classes).toContain("data-[focus-visible]:ring-[3px]");
  expect(classes).toContain("size-9");
});

test("Button keeps native and React Aria disabled semantics", () => {
  const html = renderToStaticMarkup(
    <Button
      aria-label="Delete project"
      className="delete-project"
      isDisabled
      variant="destructive"
    >
      Delete project
    </Button>,
  );

  expect(html).toContain("<button");
  expect(html).toContain('aria-label="Delete project"');
  expect(html).toContain('disabled=""');
  expect(html).toContain('data-disabled="true"');
  expect(html).toContain("bg-destructive");
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
        <Badge variant="secondary">Ready</Badge>
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
  expect(html).toContain("bg-secondary");
  expect(html).toContain("max-w-md");
});

test("TextField connects its label, description, and validation error", () => {
  const html = renderToStaticMarkup(
    <TextField
      description="Used for local development notices."
      errorMessage="Enter a valid email address."
      inputProps={{
        autoComplete: "email",
        placeholder: "you@example.com",
      }}
      isInvalid
      label="Email"
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
