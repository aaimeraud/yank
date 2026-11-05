# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Gate tests for scripts/release.py. Run: uv run scripts/test_release.py"""

from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import release  # noqa: E402

TRACKED = [f.path for f in release.FILES]


class ReleaseTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        for path in TRACKED:
            (self.tmp / path).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(release.ROOT / path, self.tmp / path)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp)

    def test_real_repo_versions_agree(self) -> None:
        self.assertEqual(release.check(release.ROOT), 0)

    def test_bump_rewrites_all_four_and_nothing_else(self) -> None:
        before = {p: (self.tmp / p).read_text() for p in TRACKED}
        release.bump(self.tmp, "v9.8.7", changelog=False)
        self.assertEqual(set(release.versions(self.tmp).values()), {"9.8.7"})
        for path in TRACKED:
            old, new = before[path].splitlines(), (self.tmp / path).read_text().splitlines()
            changed = [(a, b) for a, b in zip(old, new) if a != b]
            self.assertEqual(len(old), len(new), path)
            self.assertEqual(len(changed), 1, f"{path}: {changed}")

    def test_cargo_lock_bump_skips_dependencies(self) -> None:
        lock = self.tmp / "src-tauri/Cargo.lock"
        other_versions = lock.read_text().count('version = "')
        release.bump(self.tmp, "9.8.7", changelog=False)
        text = lock.read_text()
        self.assertEqual(text.count('version = "9.8.7"'), 1)
        self.assertEqual(text.count('version = "'), other_versions)

    def test_disagreement_fails_check_and_blocks_bump(self) -> None:
        release.FILES[0].write(self.tmp, "0.0.1")
        self.assertEqual(release.check(self.tmp), 1)
        with self.assertRaises(SystemExit):
            release.bump(self.tmp, "1.0.0", changelog=False)

    def test_rejects_non_semver(self) -> None:
        for bad in ("1.0", "one", "1.0.0.0"):
            with self.assertRaises(SystemExit, msg=bad):
                release.bump(self.tmp, bad, changelog=False)

    def test_head_has_no_commits_foreign_to_itself(self) -> None:
        self.assertEqual(release.foreign_commits("HEAD"), [])

    def test_accepts_prerelease(self) -> None:
        release.bump(self.tmp, "1.0.0-rc.1", changelog=False)
        self.assertEqual(set(release.versions(self.tmp).values()), {"1.0.0-rc.1"})


if __name__ == "__main__":
    unittest.main()
