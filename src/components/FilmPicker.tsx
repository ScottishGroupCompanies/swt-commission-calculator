"use client";

import { useId, useMemo, useState } from "react";
import { formatSell } from "@/lib/format";
import type { CatalogFilm } from "@/lib/types";

export function FilmPicker({
  query,
  catalog,
  onChange,
}: {
  query: string;
  catalog: CatalogFilm[];
  onChange: (query: string, film: CatalogFilm | null) => void;
}) {
  const listId = useId();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const pool = needle
      ? catalog.filter(
          (film) =>
            film.product.toLowerCase().includes(needle) ||
            film.manufacturer.toLowerCase().includes(needle),
        )
      : catalog;
    return pool.slice(0, 8);
  }, [catalog, query]);

  const activeIndex = matches.length === 0 ? 0 : Math.min(active, matches.length - 1);

  function choose(film: CatalogFilm) {
    onChange(film.product, film);
    setOpen(false);
  }

  return (
    <div className="combo">
      <label htmlFor={inputId}>Film</label>
      <input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        placeholder="Search the 307-film catalog"
        onFocus={() => setOpen(true)}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 120);
        }}
        onChange={(event) => {
          const next = event.target.value;
          const exact = catalog.find(
            (film) => film.product.toLowerCase() === next.trim().toLowerCase(),
          );
          onChange(next, exact ?? null);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((index) => Math.min(index + 1, Math.max(matches.length - 1, 0)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && open && matches[activeIndex]) {
            event.preventDefault();
            choose(matches[activeIndex]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && matches.length > 0 ? (
        <ul id={listId} role="listbox" className="combo-list">
          {matches.map((film, index) => (
            <li key={`${film.product}-${index}`} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? "active" : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(film)}
              >
                <span>{film.product}</span>
                <small>
                  {film.manufacturer} · group {film.pricingGroup} · {formatSell(film.sellPerSf)}/SF
                </small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {open && query.trim() && matches.length === 0 ? (
        <p className="combo-empty">No catalog film matches that name.</p>
      ) : null}
    </div>
  );
}
