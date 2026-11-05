import { useEffect, useMemo, useRef, useState } from "react";
import type { Format, QueueEntry, SearchKind, SearchResult, Video } from "../../types";
import type { Youtube } from "../../hooks/useYoutube";
import { FORMAT_OPTIONS } from "../../lib/downloadFormats";
import { formatLongDuration, plural } from "../../lib/format";
import { PLAYLIST_STEP, canLoadMore, entryToHit, hitState, isUnavailable, watchBlocker } from "../../lib/youtube";
import { CloseIcon, SearchIcon } from "../icons";
import ResultCard, { type HitActions } from "./ResultCard";

interface Props {
  youtube: Youtube;
  library: Map<string, Video>;
  /** Active queue rows by video id. */
  downloads: Map<string, QueueEntry>;
  playingId: string | null;
  actions: HitActions & {
    /** Stream `hits[index]`, then the rest of `hits` in order. */
    watchList: (hits: SearchResult[], index: number, label: string) => void;
  };
}

const KINDS: { value: SearchKind; label: string }[] = [
  { value: "video", label: "Videos" },
  { value: "playlist", label: "Playlists" },
];

/**
 * Search YouTube without leaving the app. A hit streams in the player
 * (ADR 0010) or goes to the download queue like a pasted link; a playlist
 * opens in place with its videos.
 */
export default function YouTube({ youtube, library, downloads, playingId, actions }: Props) {
  const { search, playlist } = youtube;
  const inputRef = useRef<HTMLInputElement>(null);

  // Landing on the screen puts the cursor in the field, unless a playlist
  // is open (then the keyboard belongs to its list).
  useEffect(() => {
    if (!playlist) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (kind: SearchKind = search.kind) => youtube.run(youtube.draft, kind);

  return (
    <>
      <header className="screen-head">
        <div className="screen-titles">
          <h1 className="screen-title">YouTube</h1>
          <p className="screen-sub">Search, watch here, download what you want to keep.</p>
        </div>
      </header>

      <form
        className="yt-search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="search-field yt-field">
          <SearchIcon />
          <input
            ref={inputRef}
            type="search"
            value={youtube.draft}
            onChange={(event) => youtube.setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && youtube.draft) {
                event.preventDefault();
                youtube.clear();
              }
            }}
            placeholder="Search YouTube"
            aria-label="Search YouTube"
            spellCheck={false}
            autoCorrect="off"
            enterKeyHint="search"
          />
          {youtube.draft && (
            <button type="button" className="yt-clear" onClick={youtube.clear} aria-label="Clear the search">
              <CloseIcon size={10} />
            </button>
          )}
        </label>
        <div className="segmented" role="group" aria-label="Look for">
          {KINDS.map((kind) => (
            <button
              key={kind.value}
              type="button"
              aria-pressed={search.kind === kind.value}
              className={search.kind === kind.value ? "on" : undefined}
              onClick={() => {
                if (kind.value === search.kind) return;
                // Switching kind re-runs the search typed, or just remembers the kind.
                youtube.run(youtube.draft || search.query, kind.value);
              }}
            >
              {kind.label}
            </button>
          ))}
        </div>
      </form>

      {playlist ? (
        <PlaylistView
          youtube={youtube}
          library={library}
          downloads={downloads}
          playingId={playingId}
          actions={actions}
        />
      ) : (
        <Results youtube={youtube} library={library} downloads={downloads} playingId={playingId} actions={actions} />
      )}
    </>
  );
}

function Results({ youtube, library, downloads, playingId, actions }: Props) {
  const { search } = youtube;
  const label = `“${search.query}” on YouTube`;
  const hitActions: HitActions = {
    ...actions,
    open: (hit) => {
      if (hit.kind === "playlist") youtube.openPlaylist(hit);
      else actions.watchList(search.results, search.results.indexOf(hit), label);
    },
  };

  if (search.status === "idle") return <Idle youtube={youtube} />;
  if (search.status === "loading") return <Skeleton />;
  if (search.status === "error" && search.results.length === 0) {
    return <Failure message={search.error} onRetry={youtube.retry} />;
  }
  if (search.results.length === 0) {
    return (
      <p className="empty">
        Nothing on YouTube for “{search.query}”{search.kind === "playlist" ? " in playlists" : ""}. Try other words
        {search.kind === "playlist" ? ", or look for videos instead" : ""}.
      </p>
    );
  }

  return (
    <>
      <div className="grid">
        {search.results.map((hit, index) => (
          <ResultCard
            key={`${hit.kind}:${hit.id}`}
            hit={hit}
            index={index}
            state={hitState(hit, library, downloads)}
            playing={hit.id === playingId}
            actions={hitActions}
          />
        ))}
      </div>
      <More youtube={youtube} />
    </>
  );
}

/**
 * The end of the list: loads the next page on its own when it scrolls into
 * view (with a button for keyboard users), or says the list is complete.
 */
function More({ youtube }: { youtube: Youtube }) {
  const { search } = youtube;
  const ref = useRef<HTMLDivElement>(null);
  const loadMore = useRef(youtube.loadMore);
  loadMore.current = youtube.loadMore;
  const ready = canLoadMore(search);

  useEffect(() => {
    const el = ref.current;
    if (!el || !ready) return;
    const observer = new IntersectionObserver(
      (entries) => entries.some((entry) => entry.isIntersecting) && loadMore.current(),
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ready, search.results.length]);

  return (
    <div className="yt-more" ref={ref}>
      {search.status === "more" && (
        <span className="yt-more-status" role="status">
          <span className="spinner" aria-hidden="true" /> Loading more
        </span>
      )}
      {search.status === "error" && <Failure message={search.error} onRetry={youtube.retry} inline />}
      {ready && (
        <button className="ghost" onClick={youtube.loadMore}>
          Show more results
        </button>
      )}
      {search.status === "done" && !search.hasMore && (
        <span className="yt-more-status">That is everything YouTube returned.</span>
      )}
    </div>
  );
}

function Idle({ youtube }: { youtube: Youtube }) {
  return (
    <div className="yt-idle">
      <p className="empty">
        Find a video or a playlist. Click one to watch it right here, streamed in the player; Download keeps it
        in your library.
      </p>
      {youtube.recent.length > 0 && (
        <div className="yt-recent">
          <div className="yt-recent-head">
            <span className="nav-heading">Recent searches</span>
            <button className="link-button" onClick={youtube.forgetRecent}>
              Clear
            </button>
          </div>
          <div className="yt-chips">
            {youtube.recent.map((query) => (
              <button key={query} className="chip" onClick={() => youtube.run(query, youtube.search.kind)}>
                {query}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Skeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid" aria-busy="true" aria-label="Searching">
      {Array.from({ length: count }, (_, index) => (
        <div className="card skeleton" key={index} style={{ "--enter-delay": `${index * 45}ms` } as React.CSSProperties}>
          <div className="thumb" />
          <div className="skeleton-line" />
          <div className="skeleton-line short" />
        </div>
      ))}
    </div>
  );
}

function Failure({ message, onRetry, inline = false }: { message: string | null; onRetry: () => void; inline?: boolean }) {
  return (
    <div className={"yt-failure" + (inline ? " inline" : "")} role="alert">
      <p className="err">{message ?? "The search failed."}</p>
      {!inline && (
        <p className="yt-hint">
          A yt-dlp update often fixes this: <code>brew upgrade yt-dlp</code>
        </p>
      )}
      <button className="bulk-action" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}

/** A playlist opened from the results: its videos, Play all, Download all. */
function PlaylistView({ youtube, library, downloads, playingId, actions }: Props) {
  const open = youtube.playlist!;
  const [shown, setShown] = useState(PLAYLIST_STEP);
  const [format, setFormat] = useState<Format | "">("");

  const hits = useMemo(
    () => (open.info?.entries ?? []).map(entryToHit).filter((hit): hit is SearchResult => hit !== null),
    [open.info],
  );
  const playable = hits.filter((hit) => !isUnavailable(hit) && !watchBlocker(hit));
  const total = hits.reduce((sum, hit) => sum + (hit.duration ?? 0), 0);
  const title = open.info?.title ?? open.hit.title;
  const label = title;

  const facts = [open.hit.channel ?? null, open.info ? plural(hits.length, "video") : null, total > 0 ? formatLongDuration(total) : null].filter(
    (fact): fact is string => !!fact,
  );

  const hitActions: HitActions = {
    ...actions,
    open: (hit) => actions.watchList(playable, playable.indexOf(hit), label),
  };

  return (
    <section className="yt-playlist" aria-label={title}>
      <button className="link-button yt-back" onClick={youtube.closePlaylist}>
        ← Back to results
      </button>
      <header className="yt-playlist-head">
        <div className="screen-titles">
          <h2 className="yt-playlist-title">{title}</h2>
          <p className="screen-sub">
            {facts.map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
          </p>
        </div>
        <div className="screen-actions">
          <button className="bulk-action" disabled={playable.length === 0} onClick={() => actions.watchList(playable, 0, label)}>
            Play all
          </button>
          <select aria-label="Format for Download all" value={format} onChange={(event) => setFormat(event.target.value as Format | "")}>
            <option value="">Default format</option>
            {FORMAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.short}
              </option>
            ))}
          </select>
          <button className="primary" onClick={() => actions.download(open.hit, format || null)}>
            Download all
          </button>
        </div>
      </header>

      {open.error ? (
        <Failure message={open.error} onRetry={() => youtube.openPlaylist(open.hit)} />
      ) : !open.info ? (
        <Skeleton count={4} />
      ) : hits.length === 0 ? (
        <p className="empty">This playlist is empty, or its videos are not available.</p>
      ) : (
        <>
          <div className="grid">
            {hits.slice(0, shown).map((hit, index) => (
              <ResultCard
                key={`${hit.id}-${index}`}
                hit={hit}
                index={index}
                state={hitState(hit, library, downloads)}
                playing={hit.id === playingId}
                actions={hitActions}
              />
            ))}
          </div>
          {hits.length > shown && (
            <div className="yt-more">
              <button className="ghost" onClick={() => setShown((count) => count + PLAYLIST_STEP)}>
                Show {Math.min(PLAYLIST_STEP, hits.length - shown)} more of {hits.length - shown}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
