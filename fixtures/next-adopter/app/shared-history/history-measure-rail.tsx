"use client";

import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { HistoryCategoryIcon } from "./category-icon";
import { historyStyles } from "./shared-history.stylex";

type HistoryMeasureId = "net-revenue" | "payment-volume" | "valuation";

const measureControls = [
  { id: "payment-volume", label: "annual volume" },
  { id: "net-revenue", label: "net revenue" },
  { id: "valuation", label: "valuation" },
] as const satisfies readonly Readonly<{
  id: HistoryMeasureId;
  label: string;
}>[];

export function HistoryMeasureRail({ children }: Readonly<{ children: ReactNode }>) {
  const railRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | undefined>(undefined);
  const [activeMeasure, setActiveMeasure] = useState<HistoryMeasureId>(
    "payment-volume",
  );

  useEffect(() => {
    const rail = railRef.current;
    if (rail === null) return;

    const updateActiveMeasure = () => {
      frameRef.current = undefined;
      const cards = [...rail.querySelectorAll<HTMLElement>("[data-measure]")];
      const nearest = cards.reduce<HTMLElement | undefined>((best, card) => {
        if (best === undefined) return card;
        return Math.abs(card.offsetLeft - rail.scrollLeft)
          < Math.abs(best.offsetLeft - rail.scrollLeft)
          ? card
          : best;
      }, undefined);
      const id = nearest?.dataset.measure;
      if (id === "payment-volume" || id === "net-revenue" || id === "valuation") {
        setActiveMeasure(id);
      }
    };
    const onScroll = () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(updateActiveMeasure);
    };
    rail.addEventListener("scroll", onScroll, { passive: true });
    updateActiveMeasure();
    return () => {
      rail.removeEventListener("scroll", onScroll);
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const showMeasure = (id: HistoryMeasureId) => {
    const rail = railRef.current;
    const card = rail?.querySelector<HTMLElement>(`[data-measure="${id}"]`);
    if (rail === null || rail === undefined || card === null || card === undefined) {
      return;
    }
    setActiveMeasure(id);
    rail.scrollTo({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      left: card.offsetLeft,
    });
  };

  return (
    <aside {...stylex.props(historyStyles.volume)} aria-label="Illustrative company measures" className={`history-volume ${stylex.props(historyStyles.volume).className ?? ""}`}>
      <div {...stylex.props(historyStyles.controls)} aria-label="Scale chart" className={`history-measure-controls ${stylex.props(historyStyles.controls).className ?? ""}`} role="group">
        {measureControls.map(({ id, label }) => (
          <button
            {...stylex.props(historyStyles.control, activeMeasure === id && historyStyles.selectedControl)}
            aria-controls={`history-measure-${id}`}
            aria-pressed={activeMeasure === id}
            key={id}
            onClick={() => showMeasure(id)}
            type="button"
          >
            <HistoryCategoryIcon filterId={id} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div {...stylex.props(historyStyles.rail)} className={`history-measure-rail ${stylex.props(historyStyles.rail).className ?? ""}`} ref={railRef}>{children}</div>
    </aside>
  );
}
