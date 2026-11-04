import type { LibraryQuery, SortKey, StatusFilter } from "../lib/libraryView";
import { SORT_LABELS, STATUS_LABELS, isFiltered } from "../lib/libraryView";
import { SOURCE_KEYS, sourceKeyLabel, type SourceKey } from "../lib/source";
import SourceIcon from "./SourceIcon";
import { SearchIcon } from "./icons";

interface Props {
  query: LibraryQuery;
  onChange: (patch: Partial<LibraryQuery>) => void;
  /** Videos per source in the current folder, before any filter. */
  counts: Record<SourceKey | "all", number>;
  /** Videos shown with the current filters. */
  shown: number;
}

/**
 * Count cards that filter by source (the selected one carries the data hue),
 * then search, status and sort on one line.
 */
export default function LibraryToolbar({ query, onChange, counts, shown }: Props) {
  const selected: SourceKey | "all" = query.sources.length === 1 ? query.sources[0] : "all";
  const pick = (key: SourceKey | "all") => onChange({ sources: key === "all" ? [] : [key] });
  const cards: (SourceKey | "all")[] = ["all", ...SOURCE_KEYS];

  return (
    <div className="library-toolbar">
      <div className="count-cards" role="radiogroup" aria-label="Source">
        {cards.map((key) => (
          <button
            key={key}
            role="radio"
            aria-checked={selected === key}
            className={"count-card" + (selected === key ? " selected" : "")}
            onClick={() => pick(key)}
          >
            <span className="count-label">
              {key !== "all" && <SourceIcon source={key} size={13} />}
              {key === "all" ? "All sources" : sourceKeyLabel(key)}
            </span>
            <span className="count-value">{counts[key]}</span>
          </button>
        ))}
      </div>
      <div className="filter-row">
        <label className="search-field">
          <SearchIcon />
          <input
            type="search"
            placeholder="Search titles and channels"
            aria-label="Search the library"
            value={query.search}
            onChange={(event) => onChange({ search: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Escape") onChange({ search: "" });
            }}
          />
        </label>
        <select
          aria-label="Show"
          value={query.status}
          onChange={(event) => onChange({ status: event.target.value as StatusFilter })}
        >
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {value === "all" ? "Every status" : label}
            </option>
          ))}
        </select>
        <select
          aria-label="Sort by"
          value={query.sort}
          onChange={(event) => onChange({ sort: event.target.value as SortKey })}
        >
          {Object.entries(SORT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {isFiltered(query) && (
          <span className="library-count">
            {shown} shown
            <button className="link-button" onClick={() => onChange({ search: "", sources: [], status: "all" })}>
              Reset
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
