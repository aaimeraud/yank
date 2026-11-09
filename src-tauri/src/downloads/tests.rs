//! End-to-end tests of the queue with a shell script standing in for yt-dlp,
//! plus `#[ignore]`d live tests that hit real sites (`cargo test -- --ignored`).

use super::*;
use crate::db::fixtures::{temp_dir, video};
use crate::db::{folders, test_pool, videos};
use std::path::Path;
use std::time::{Duration, Instant};

/// The exact line YouTube's transient rejection produces.
const FORBIDDEN: &str = "ERROR: unable to download video data: HTTP Error 403: Forbidden";

/// A script that records each call's arguments, fails the first `fails` runs
/// with `error` on stderr, then prints progress and a `YANK_FILE:` line.
fn fake_ytdlp(dir: &Path, fails: u32, error: &str) -> Toolchain {
    use std::os::unix::fs::PermissionsExt;
    let script = dir.join("fake-yt-dlp.sh");
    let body = format!(
        r#"#!/bin/sh
case " $* " in
  *" --dump-single-json "*)
    echo '{{"_type":"playlist","title":"List","entries":[{{"id":"e1","title":"One","url":"https://example.com/e1"}},{{"id":"e2","title":"Two","url":"https://example.com/e2"}}]}}'
    exit 0;;
esac
printf '%s\n' "$@" > "{dir}/args"
n=$(cat "{dir}/attempts" 2>/dev/null || echo 0)
n=$((n+1))
echo "$n" > "{dir}/attempts"
if [ "$n" -le {fails} ]; then
  echo "{error}" >&2
  exit 1
fi
echo 'YANK_PROGRESS:{{"percent":50.0,"speed":"1000","eta":"1"}}'
: > "{dir}/fake.mp4"
echo "YANK_FILE:{dir}/fake.mp4"
"#,
        dir = dir.display()
    );
    std::fs::write(&script, body).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    Toolchain { ytdlp: Some(script), ffmpeg: None, deno: None }
}

struct Harness {
    manager: DownloadManager,
    dir: PathBuf,
    events: Arc<Mutex<Vec<ProgressEvent>>>,
}

impl Harness {
    async fn new(label: &str, fails: u32, error: &str) -> Self {
        let dir = temp_dir(label);
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let manager = DownloadManager::new(
            test_pool().await,
            fake_ytdlp(&dir, fails, error),
            dir.clone(),
            1,
            Arc::new(move |event| sink.lock().unwrap().push(event)),
        );
        Self { manager, dir, events }
    }

    /// Insert video `v1` (filed into `folder` when given) and start it.
    async fn start_in(&self, folder: Option<&str>) -> String {
        video(self.manager.pool(), "v1", None).await;
        if let Some(name) = folder {
            let folder = folders::create(self.manager.pool(), name).await.unwrap();
            videos::move_to_folder(self.manager.pool(), "v1", Some(&folder.id)).await.unwrap();
        }
        let job = queue::insert(self.manager.pool(), "v1", "https://example.com/v1", Format::Video)
            .await
            .unwrap();
        let id = job.queue_id.clone();
        self.manager.spawn(job);
        id
    }

    async fn start(&self) -> String {
        self.start_in(None).await
    }

    fn attempts(&self) -> u32 {
        std::fs::read_to_string(self.dir.join("attempts"))
            .ok()
            .and_then(|raw| raw.trim().parse().ok())
            .unwrap_or(0)
    }

    async fn wait_for(&self, queue_id: &str, want: QueueStatus) {
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            let status = queue::status(self.manager.pool(), queue_id).await;
            if status == Some(want) {
                return;
            }
            assert!(Instant::now() < deadline, "never reached {want:?}, last {status:?}");
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }

    /// Wait for the first (failing) run, then land inside the 2s backoff.
    async fn wait_for_first_attempt(&self) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while self.attempts() < 1 {
            assert!(Instant::now() < deadline, "the fake yt-dlp was never called");
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[tokio::test]
async fn a_403_is_retried_with_a_fresh_extraction_and_finishes() {
    let h = Harness::new("403", 1, FORBIDDEN).await;
    let id = h.start_in(Some("Sample/Folder 3.0")).await;

    h.wait_for(&id, QueueStatus::Done).await;
    assert_eq!(h.attempts(), 2, "one retry is enough here");
    let row = videos::get(h.manager.pool(), "v1").await.unwrap();
    assert_eq!(row.file_path.unwrap(), h.dir.join("fake.mp4").display().to_string());

    // The library folder, made safe for disk, decides where the file goes.
    let args = std::fs::read_to_string(h.dir.join("args")).unwrap();
    let template = args.lines().skip_while(|a| *a != "-o").nth(1).unwrap();
    assert_eq!(
        template,
        h.dir.join("Sample-Folder 3.0/%(title).150B [%(id)s].%(ext)s").display().to_string()
    );

    let events = h.events.lock().unwrap();
    assert!(events.iter().any(|e| e.progress == Some(50.0)), "progress reached the UI");
    assert_eq!(events.last().unwrap().status, QueueStatus::Done);
}

#[tokio::test]
async fn a_permanent_error_fails_after_one_attempt() {
    let h = Harness::new("permanent", 99, "ERROR: Unsupported URL: https://example.com/v1").await;
    let id = h.start().await;
    h.wait_for(&id, QueueStatus::Failed).await;
    assert_eq!(h.attempts(), 1, "a bad URL fails the same way every time");
    let entry = queue::get(h.manager.pool(), &id).await.unwrap();
    assert!(entry.error.unwrap().contains("Unsupported URL"));
}

#[tokio::test]
async fn pausing_during_the_backoff_stops_the_retry() {
    let h = Harness::new("pause-backoff", 1, FORBIDDEN).await;
    let id = h.start().await;
    h.wait_for_first_attempt().await;
    h.manager.pause(&id).await.unwrap();
    tokio::time::sleep(Duration::from_millis(2500)).await;
    assert_eq!(queue::status(h.manager.pool(), &id).await, Some(QueueStatus::Paused));
    assert_eq!(h.attempts(), 1, "a paused download must not keep retrying");
}

#[tokio::test]
async fn resuming_during_the_backoff_is_picked_up_by_the_live_worker() {
    let h = Harness::new("resume-backoff", 1, FORBIDDEN).await;
    let id = h.start().await;
    h.wait_for_first_attempt().await;
    // The first worker still holds the claim, so resume cannot spawn its own.
    h.manager.pause(&id).await.unwrap();
    h.manager.resume(&id).await.unwrap();
    h.wait_for(&id, QueueStatus::Done).await;
    assert_eq!(h.attempts(), 2);
}

#[tokio::test]
async fn retry_failed_requeues_every_failed_row() {
    let h = Harness::new("retry-all", 1, "ERROR: Unsupported URL").await;
    let id = h.start().await;
    h.wait_for(&id, QueueStatus::Failed).await;
    assert_eq!(h.manager.resume_all(QueueStatus::Failed).await.unwrap(), 1);
    h.wait_for(&id, QueueStatus::Done).await;
}

#[tokio::test]
async fn removing_a_paused_download_forgets_the_video() {
    let h = Harness::new("remove", 99, "ERROR: Unsupported URL").await;
    let id = h.start().await;
    h.wait_for(&id, QueueStatus::Failed).await;
    h.manager.remove(&id).await.unwrap();
    assert!(queue::status(h.manager.pool(), &id).await.is_none());
    assert!(videos::get(h.manager.pool(), "v1").await.is_err());
}

/// Regression: pause sent SIGTERM to yt-dlp only, leaving the ffmpeg it had
/// started still writing the file.
#[tokio::test]
async fn pausing_stops_the_whole_process_group() {
    use std::os::unix::fs::PermissionsExt;
    let h = Harness::new("group", 0, "").await;
    let script = h.dir.join("slow-yt-dlp.sh");
    let body = format!(
        "#!/bin/sh\nsleep 30 &\necho $! > \"{dir}/child\"\nwait\n",
        dir = h.dir.display()
    );
    std::fs::write(&script, body).unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let manager = DownloadManager::new(
        h.manager.pool().clone(),
        Toolchain { ytdlp: Some(script), ffmpeg: None, deno: None },
        h.dir.clone(),
        1,
        Arc::new(|_| {}),
    );
    video(manager.pool(), "v1", None).await;
    let job = queue::insert(manager.pool(), "v1", "https://example.com/v1", Format::Video).await.unwrap();
    let id = job.queue_id.clone();
    manager.spawn(job);

    let child_file = h.dir.join("child");
    let deadline = Instant::now() + Duration::from_secs(10);
    while !child_file.exists() {
        assert!(Instant::now() < deadline, "the slow fake never started");
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    tokio::time::sleep(Duration::from_millis(100)).await;
    let child = std::fs::read_to_string(&child_file).unwrap().trim().to_string();

    manager.pause(&id).await.unwrap();
    tokio::time::sleep(Duration::from_millis(500)).await;
    let alive = std::process::Command::new("kill").args(["-0", &child]).status().unwrap().success();
    assert!(!alive, "the child process {child} survived the pause");
    assert_eq!(queue::status(manager.pool(), &id).await, Some(QueueStatus::Paused));
}

/// Regression: two overlapping pastes of the same playlist both passed the
/// "already queued?" check and queued every video twice.
#[tokio::test]
async fn overlapping_enqueues_queue_each_video_once() {
    let h = Harness::new("double-enqueue", 0, "").await;
    let url = "https://example.com/playlist";
    let (first, second) = tokio::join!(h.manager.enqueue_url(url, None, false), h.manager.enqueue_url(url, None, false));
    let queued = first.unwrap().queued + second.unwrap().queued;
    assert_eq!(queued, 2, "two entries, queued once each");
    assert_eq!(queue::list(h.manager.pool()).await.unwrap().len(), 2);
}

// ---- live tests: real yt-dlp, real network --------------------------------

async fn live_manager(label: &str) -> (DownloadManager, PathBuf) {
    let dir = temp_dir(label);
    let manager = DownloadManager::new(test_pool().await, Toolchain::detect(), dir.clone(), 2, Arc::new(|_| {}));
    (manager, dir)
}

async fn wait_done(manager: &DownloadManager, limit: Duration) {
    let deadline = Instant::now() + limit;
    loop {
        let rows = queue::list(manager.pool()).await.unwrap();
        if !rows.is_empty() && rows.iter().all(|r| r.status == QueueStatus::Done) {
            return;
        }
        if let Some(failed) = rows.iter().find(|r| r.status == QueueStatus::Failed) {
            panic!("{} failed: {:?}", failed.url, failed.error);
        }
        assert!(Instant::now() < deadline, "not done in time: {rows:?}");
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

async fn assert_files_exist(manager: &DownloadManager) {
    for video in videos::list(manager.pool()).await.unwrap() {
        let path = video.file_path.expect("file_path recorded");
        assert!(Path::new(&path).is_file(), "missing {path}");
    }
}

#[tokio::test]
#[ignore = "network access"]
async fn live_youtube_video_downloads_as_mp4() {
    let (manager, dir) = live_manager("live-yt").await;
    let summary = manager.enqueue_url("https://www.youtube.com/watch?v=jNQXAC9IVRw", None, false).await.unwrap();
    assert_eq!((summary.queued, summary.is_playlist), (1, false));
    wait_done(&manager, Duration::from_secs(180)).await;
    assert_files_exist(&manager).await;
    let video = &videos::list(manager.pool()).await.unwrap()[0];
    assert!(video.file_path.as_deref().unwrap().ends_with(".mp4"));
    assert!(video.thumbnail_path.is_some(), "thumbnail written next to it");
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
#[ignore = "network access"]
async fn live_youtube_audio_keeps_its_real_extension() {
    let (manager, dir) = live_manager("live-audio").await;
    manager
        .enqueue_url("https://www.youtube.com/watch?v=jNQXAC9IVRw", Some(Format::Audio), false)
        .await
        .unwrap();
    wait_done(&manager, Duration::from_secs(180)).await;
    let video = &videos::list(manager.pool()).await.unwrap()[0];
    assert!(video.file_path.as_deref().unwrap().ends_with(".m4a"));
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
#[ignore = "network access"]
async fn live_pause_then_resume_completes() {
    let (manager, dir) = live_manager("live-pause").await;
    manager.enqueue_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ", None, false).await.unwrap();
    let id = queue::list(manager.pool()).await.unwrap()[0].id.clone();
    let deadline = Instant::now() + Duration::from_secs(90);
    while queue::get(manager.pool(), &id).await.unwrap().progress <= 0.0 {
        assert!(Instant::now() < deadline, "never started");
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    manager.pause(&id).await.unwrap();
    manager.resume(&id).await.unwrap();
    wait_done(&manager, Duration::from_secs(240)).await;
    assert_files_exist(&manager).await;
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn progress_events_are_throttled_but_the_last_one_arrives() {
    let h = Harness::new("throttle", 0, "").await;
    // Swap in a yt-dlp that floods 200 progress lines with no pause.
    std::fs::write(
        h.dir.join("fake-yt-dlp.sh"),
        format!(
            "#!/bin/sh\ni=0\nwhile [ $i -lt 200 ]; do\n  i=$((i+1))\n  \
             echo \"YANK_PROGRESS:{{\\\"percent\\\":$((i/2)).0}}\"\ndone\n\
             : > \"{dir}/fake.mp4\"\necho \"YANK_FILE:{dir}/fake.mp4\"\n",
            dir = h.dir.display()
        ),
    )
    .unwrap();
    let id = h.start_in(None).await;
    h.wait_for(&id, QueueStatus::Done).await;

    let events = h.events.lock().unwrap();
    let progress: Vec<f64> = events.iter().filter_map(|e| e.progress).collect();
    assert!(progress.len() < 20, "200 lines became {} events", progress.len());
    assert_eq!(progress.last(), Some(&100.0), "the full bar always reaches the UI");
}

#[tokio::test]
async fn download_on_a_paused_video_continues_that_row() {
    let h = Harness::new("paused-download", 0, "").await;
    video(h.manager.pool(), "v1", None).await;
    let job = queue::insert(h.manager.pool(), "v1", "https://example.com/v1", Format::Audio)
        .await
        .unwrap();
    queue::transition(h.manager.pool(), &job.queue_id, &[QueueStatus::Queued], QueueStatus::Paused)
        .await
        .unwrap();

    // The card offers "Download" for a paused video; it used to do nothing.
    h.manager.download_video("v1", None).await.unwrap();

    h.wait_for(&job.queue_id, QueueStatus::Done).await;
    let rows = queue::list(h.manager.pool()).await.unwrap();
    assert_eq!(rows.len(), 1, "no second row for the same video");
    assert_eq!(rows[0].format.as_deref(), Some("audio"), "the paused row keeps its format");
}

#[tokio::test]
async fn a_url_without_a_format_uses_the_settings_default() {
    let h = Harness::new("default-format", 0, "").await;
    crate::settings::set(h.manager.pool(), crate::settings::KEY_FORMAT, "audio").await.unwrap();

    // The URL box sends no format unless the user picked one in it.
    h.manager.enqueue_url("https://example.com/list", None, false).await.unwrap();

    let rows = queue::list(h.manager.pool()).await.unwrap();
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().all(|row| row.format.as_deref() == Some("audio")), "{rows:?}");
}

/// Re-downloading takes the old file and thumbnail out of the folder first,
/// so yt-dlp writes the new file instead of skipping it, then records the
/// new one. Regression: without the trash step yt-dlp kept the old file.
#[tokio::test]
async fn redownloading_trashes_the_old_file_and_downloads_again() {
    let h = Harness::new("redownload", 0, "").await;
    let old = h.dir.join("old.mp4");
    let old_thumb = h.dir.join("old.jpg");
    std::fs::write(&old, b"damaged").unwrap();
    std::fs::write(&old_thumb, b"thumb").unwrap();
    video(h.manager.pool(), "v1", Some(old.to_str().unwrap())).await;

    h.manager.redownload_video("v1", None).await.unwrap();
    wait_done(&h.manager, Duration::from_secs(10)).await;

    assert!(!old.exists(), "old file should have left the folder");
    assert!(!old_thumb.exists(), "old thumbnail should have left the folder");
    let video = videos::get(h.manager.pool(), "v1").await.unwrap();
    let path = video.file_path.expect("new file recorded");
    assert_eq!(Path::new(&path), h.dir.join("fake.mp4"));
    assert!(Path::new(&path).exists());
}

/// A video whose download is running cannot be replaced under it.
#[tokio::test]
async fn redownloading_refuses_while_a_download_is_running() {
    let h = Harness::new("redownload-busy", 99, "ERROR: Unsupported URL").await;
    video(h.manager.pool(), "v1", None).await;
    // A queued row counts as running: it is about to start yt-dlp.
    queue::insert(h.manager.pool(), "v1", "https://example.com/v1", Format::Video).await.unwrap();

    let err = h.manager.redownload_video("v1", None).await.unwrap_err();
    assert!(err.to_string().contains("Cancel this download"), "{err}");
}
