import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { api } from "../api";
import { errorMessage } from "../lib/notify";
import { usePref } from "../lib/prefs";
import { IDLE_SEARCH, canLoadMore, pendingPage, rememberSearch, searchReducer } from "../lib/youtube";
import type { SearchKind, SearchResult, UrlInfo } from "../types";

/** A playlist opened from the results: its hit, then what yt-dlp listed. */
export interface OpenPlaylist {
  hit: SearchResult;
  info: UrlInfo | null;
  error: string | null;
}

/**
 * The YouTube screen's state. It lives with the app, not the screen, so a
 * search is still there after a trip to the library or the player.
 *
 * Every request goes through the reducer (lib/youtube.ts), which numbers
 * it; the effect below runs the one the state asks for and reports back
 * with that number, so a slow answer to an old search is dropped there.
 */
export function useYoutube() {
  const [search, dispatch] = useReducer(searchReducer, IDLE_SEARCH);
  const [draft, setDraft] = useState("");
  const [recent, setRecent] = usePref<string[]>("youtubeRecent", []);
  const [playlist, setPlaylist] = useState<OpenPlaylist | null>(null);
  const playlistToken = useRef(0);

  useEffect(() => {
    const page = pendingPage(search);
    if (page === null) return;
    const { request, query, kind } = search;
    // A run whose effect was torn down (React's dev double run) reports
    // nothing: the backend stops its yt-dlp for the run that replaced it.
    let live = true;
    api
      .searchYoutube(query, kind, page)
      .then((data) => live && dispatch({ type: "page", request, page, data }))
      .catch((error) => live && dispatch({ type: "failed", request, error: errorMessage(error) }));
    return () => {
      live = false;
    };
    // One run per request number: the request is what changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.request]);

  const run = useCallback(
    (query: string, kind: SearchKind) => {
      setDraft(query);
      setPlaylist(null);
      playlistToken.current += 1;
      dispatch({ type: "search", query, kind });
      setRecent((past) => rememberSearch(past, query));
    },
    [setRecent],
  );

  const openPlaylist = useCallback((hit: SearchResult) => {
    const token = ++playlistToken.current;
    setPlaylist({ hit, info: null, error: null });
    api
      .inspectUrl(hit.url)
      .then((info) => token === playlistToken.current && setPlaylist({ hit, info, error: null }))
      .catch((error) => token === playlistToken.current && setPlaylist({ hit, info: null, error: errorMessage(error) }));
  }, []);

  return {
    search,
    draft,
    setDraft,
    recent,
    forgetRecent: () => setRecent([]),
    /** Search `query` (the field's text by default) in `kind`. */
    run,
    /** After an error, ask for the page that failed again. */
    retry: () => dispatch({ type: "retry" }),
    loadMore: () => {
      if (canLoadMore(search)) dispatch({ type: "more" });
    },
    clear: () => {
      setDraft("");
      setPlaylist(null);
      playlistToken.current += 1;
      dispatch({ type: "clear" });
    },
    playlist,
    openPlaylist,
    closePlaylist: () => {
      playlistToken.current += 1;
      setPlaylist(null);
    },
  };
}

export type Youtube = ReturnType<typeof useYoutube>;
