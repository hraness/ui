import { hydrateRoot } from "react-dom/client";

import { PrimitiveGallery } from "./app.js";

declare global {
  interface Window {
    __HRANESS_UI_GALLERY_HYDRATION_STARTED__?: boolean;
    __HRANESS_UI_GALLERY_RECOVERABLE_ERRORS__?: string[];
    __HRANESS_UI_GALLERY_UNMOUNT__?: () => void;
  }
}

export function hydratePrimitiveGallery(): void {
  const container = document.querySelector<HTMLElement>("[data-gallery-hydration-root]");
  if (container === null) throw new Error("The primitive gallery root is missing.");

  const recoverableErrors: string[] = [];
  window.__HRANESS_UI_GALLERY_RECOVERABLE_ERRORS__ = recoverableErrors;
  const root = hydrateRoot(container, <PrimitiveGallery />, {
    onRecoverableError(error) {
      recoverableErrors.push(error instanceof Error ? error.message : String(error));
    },
  });
  window.__HRANESS_UI_GALLERY_HYDRATION_STARTED__ = true;
  window.__HRANESS_UI_GALLERY_UNMOUNT__ = () => {
    root.unmount();
    delete window.__HRANESS_UI_GALLERY_HYDRATION_STARTED__;
    delete window.__HRANESS_UI_GALLERY_RECOVERABLE_ERRORS__;
    delete window.__HRANESS_UI_GALLERY_UNMOUNT__;
  };
}
