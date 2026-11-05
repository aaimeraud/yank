# One persistent player with a Spotify-style queue, instead of tabs

Videos used to open in title-bar tabs, each tab its own player, and leaving the player screen unmounted it and stopped the video. People expect the YouTube and Spotify behaviour: one thing plays, it keeps playing while you browse (a mini player in the corner), and what comes next is visible and editable. Several tabs each with a player contradict that, so tabs are gone.

There is now one `<video>` element for the window. The player screen and the mini player are two frames around it; the element is never remounted, so switching frames costs nothing and loses nothing. What plays next is one pure state (`src/lib/playerQueue.ts`): history, current, the user's queue, then the context the video was started from (the folder as shown). Previous restarts a video that has played more than 3 seconds, as music players do.

The queue is in memory only. A queue restored after a restart would point at files that may have moved, and nobody expects yesterday's queue back.
