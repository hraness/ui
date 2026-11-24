import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, Icon, SearchableSelect, type SearchableSelectOption } from "@hraness/ui";
import { Location01Icon } from "@hugeicons/core-free-icons";
import "@hraness/ui/styles.css";

const places = [
  { id: "coruna", label: "A Coruña", description: "Galicia", lang: "gl" },
  { id: "porto", label: "Porto", description: "Norte", keywords: ["Oporto"], lang: "pt" },
  { id: "alegre", label: "Porto Alegre", description: "Rio Grande do Sul", lang: "pt" },
  { id: "athens", label: "Αθήνα", description: "Attica", keywords: ["Athens"], lang: "el" },
  { id: "tokyo", label: "東京", description: "Japan", keywords: ["Tokyo"], lang: "ja" },
  { id: "closed", label: "Porto Bay", description: "Unavailable", isDisabled: true },
  {
    id: "anglesey",
    label: "Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch",
    description: "Anglesey, Wales",
    lang: "cy",
  },
].map((item) => ({
  ...item,
  icon: <Icon icon={Location01Icon} size={18} />,
})) satisfies SearchableSelectOption[];

function Example() {
  const [destination, setDestination] = useState("coruna");
  const [preview, setPreview] = useState("");
  const [query, setQuery] = useState({ text: "", reason: "" });
  return (
    <div className="example" data-query={query.text} data-reason={query.reason}>
      <SearchableSelect
        label="Destination"
        value={destination}
        options={places}
        onChange={setDestination}
        onPreview={setPreview}
        onQueryChange={(text, reason) => setQuery({ text, reason })}
        placeholder="Search destinations"
        emptyText="No matching destinations"
        openLabel="Browse destinations"
      />
      <output aria-label="Saved destination">
        Saved destination: {places.find((item) => item.id === destination)?.label}
      </output>
      {preview && (
        <output aria-label="Preview">
          Preview: {places.find((item) => item.id === preview)?.label}
        </output>
      )}
      <Button onPress={() => setDestination("coruna")}>Restore original destination</Button>
    </div>
  );
}

function Gallery() {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <h1>Choose a destination</h1>
      {new URLSearchParams(location.search).has("dialog") ? (
        <>
          <Button onPress={() => dialog.current?.showModal()}>Edit destination</Button>
          <dialog aria-label="Trip settings" ref={dialog}>
            <Example />
            <Button onPress={() => dialog.current?.close()}>Done</Button>
          </dialog>
        </>
      ) : (
        <Example />
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Gallery />);
