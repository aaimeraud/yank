import type { LibraryQuery, SortKey, StatusFilter } from "../lib/libraryView";
import { SORT_LABELS, STATUS_LABELS, isFiltered } from "../lib/libraryView";
import { SOURCE_KEYS, sourceKeyLabel, type SourceKey } from "../lib/source";
import SourceIcon from "./SourceIcon";

interface Props {
  query: LibraryQuery;
  onChange: (patch: Partial<LibraryQuery>) => void;
  /** Videos shown with the current filters, and before them. */
  shown: number;
  total: number;
}

/** Search, source chips, status and sort for the grid. */
export default function LibraryToolbar({ query, onChange, shown, total }: Props) {
  const toggleSource = (key: SourceKey) =>
    onChange({
      sources: query.sources.includes(key)
        ? query.sources.filter((s) => s !== key)
        : [...query.sources, key],
    });

  return (
    <div className="library-toolbar">
      <input
        className="library-search"
        type="search"
        placeholder="Search titles and channels"
        aria-label="Search the library"
        value={query.search}
        onChange={(event) => onChange({ search: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Escape") onChange({ search: "" });
        }}
      />
      <div className="source-chips" role="group" aria-label="Filter by source">
        {SOURCE_KEYS.map((key) => (
          <button
            key={key}
            className={"source-chip" + (query.sources.includes(key) ? " active" : "")}
            aria-pressed={query.sources.includes(key)}
            onClick={() => toggleSource(key)}
          >
            <SourceIcon source={key} size={13} />
            {sourceKeyLabel(key)}
          </button>
        ))}
      </div>
      <select
        aria-label="Show"
        value={query.status}
        onChange={(event) => onChange({ status: event.target.value as StatusFilter })}
      >
        {Object.entries(STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
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
          {shown} of {total}
          <button
            className="tool-link"
            onClick={() => onChange({ search: "", sources: [], status: "all" })}
          >
            Reset
          </button>
        </span>
      )}
    </div>
  );
}
