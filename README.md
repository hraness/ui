# hraness/ui

`@hraness/ui` is a source-first set of accessible React primitives for Tailwind CSS applications. It combines React Aria Components behavior with shadcn-style CVA variants and class composition.

The initial surface includes `Button`, `Badge`, compound `Card` primitives, and `TextField`. The package exports TypeScript and TSX source directly and does not ship a stylesheet.

## Install

Pin an immutable release from GitHub:

```json
{
  "dependencies": {
    "@hraness/ui": "github:hraness/ui#v0.1.0"
  }
}
```

Then install with Bun:

```sh
bun install
```

React 18 or 19 and React DOM 18 or 19 are peer dependencies.

## Configure Tailwind CSS v4

Tailwind ignores dependencies by default. Register the package source from the stylesheet that imports Tailwind:

```css
@import "tailwindcss";
@source "../node_modules/@hraness/ui/src";
```

The `@source` path is relative to that stylesheet, so adjust it if your CSS lives deeper in the application.

The components use the standard shadcn theme roles: `background`, `foreground`, `card`, `card-foreground`, `primary`, `primary-foreground`, `secondary`, `secondary-foreground`, `muted-foreground`, `accent`, `accent-foreground`, `destructive`, `border`, `input`, and `ring`. Define those roles in the application's Tailwind theme. Existing Tailwind v4 shadcn themes already provide them.

## Use the primitives

```tsx
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
} from "@hraness/ui";

export function ProjectCard() {
  return (
    <Card className="max-w-md">
      <CardHeader>
        <Badge variant="secondary">Local</Badge>
        <CardTitle>Local preview</CardTitle>
        <CardDescription>A Vite application running on this computer.</CardDescription>
      </CardHeader>
      <CardContent>
        <TextField
          description="Used for development notices."
          inputProps={{ placeholder: "you@example.com" }}
          label="Email"
          type="email"
        />
      </CardContent>
      <CardFooter>
        <Button onPress={() => console.log("Open preview")}>Open application</Button>
      </CardFooter>
    </Card>
  );
}
```

Use React Aria's `onPress` event for button actions. `Button` accepts `default`, `destructive`, `outline`, `secondary`, `ghost`, and `link` variants, plus `default`, `sm`, `lg`, and `icon` sizes.

## Extend classes

Every primitive accepts `className`. Later utilities win when they conflict with a default:

```tsx
<Button className="h-12 px-6" variant="outline">
  Open application
</Button>
```

The package also exports `cn`, `buttonVariants`, and `badgeVariants` for component composition.

## Development and contributions

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. Report suspected vulnerabilities privately as described in [SECURITY.md](./SECURITY.md).

## License

MIT
