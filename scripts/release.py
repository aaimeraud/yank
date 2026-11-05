# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Keep Yank's version in one place at a time, and cut releases.

The version lives in four files that must agree: package.json,
src-tauri/Cargo.toml, src-tauri/Cargo.lock and src-tauri/tauri.conf.json.

    uv run scripts/release.py check          # exit 1 if the four disagree
    uv run scripts/release.py bump 0.2.0     # rewrite all four, regenerate CHANGELOG.md
    uv run scripts/release.py bump --auto    # same, version picked by git-cliff
    uv run scripts/release.py bump 0.2.0 --ref <branch>   # under GitButler

`bump` never commits, tags or pushes. It prints the commands for that.
See docs/releasing.md.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEMVER = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")


@dataclass(frozen=True)
class VersionFile:
    """One file that carries the app version, and how to read and rewrite it."""

    path: str
    pattern: re.Pattern[str]

    def read(self, root: Path) -> str:
        text = (root / self.path).read_text()
        match = self.pattern.search(text)
        if not match:
            raise SystemExit(f"{self.path}: version field not found")
        return match.group("version")

    def write(self, root: Path, version: str) -> None:
        file = root / self.path
        text = file.read_text()
        new, count = self.pattern.subn(
            lambda m: m.group(0).replace(m.group("version"), version), text, count=1
        )
        if count != 1:
            raise SystemExit(f"{self.path}: version field not found")
        file.write_text(new)


# Each pattern anchors on the field that belongs to Yank itself, never a
# dependency's version: the first top-level "version" key in the JSON files,
# the [package] table in Cargo.toml, the `name = "yank"` entry in Cargo.lock.
FILES = (
    VersionFile("package.json", re.compile(r'^  "version": "(?P<version>[^"]+)"', re.M)),
    VersionFile(
        "src-tauri/tauri.conf.json", re.compile(r'^  "version": "(?P<version>[^"]+)"', re.M)
    ),
    VersionFile(
        "src-tauri/Cargo.toml",
        re.compile(r'^\[package\]\n(?:[^\[\n].*\n)*?version = "(?P<version>[^"]+)"', re.M),
    ),
    VersionFile(
        "src-tauri/Cargo.lock",
        re.compile(r'^name = "yank"\nversion = "(?P<version>[^"]+)"', re.M),
    ),
)


def versions(root: Path) -> dict[str, str]:
    found = {f.path: f.read(root) for f in FILES}
    # The JSON files are also parsed for real, so a regex that drifted onto
    # the wrong key fails loudly here instead of bumping a dependency.
    for path in ("package.json", "src-tauri/tauri.conf.json"):
        parsed = json.loads((root / path).read_text())["version"]
        if parsed != found[path]:
            raise SystemExit(f"{path}: regex read {found[path]}, JSON says {parsed}")
    return found


def check(root: Path) -> int:
    found = versions(root)
    distinct = set(found.values())
    for path, version in found.items():
        print(f"{version:>12}  {path}")
    if len(distinct) != 1:
        print("versions disagree", file=sys.stderr)
        return 1
    return 0


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout.strip()


def foreign_commits(ref: str) -> list[str]:
    """Commits HEAD reaches that `ref` does not.

    Under GitButler, HEAD is `gitbutler/workspace`, a merge of every applied
    branch, so a changelog rendered from HEAD would list other branches'
    work. git-cliff only takes `a..b` ranges, which would drop the root
    commit, so the extra commits are skipped one by one instead.
    """
    out = git("rev-list", "HEAD", f"^{ref}")
    return out.split() if out else []


def git_cliff(*args: str, ref: str = "HEAD") -> str:
    if not shutil.which("git-cliff"):
        raise SystemExit("git-cliff not found: brew install git-cliff")
    skips = [arg for sha in foreign_commits(ref) for arg in ("--skip-commit", sha)]
    return subprocess.run(
        ["git-cliff", *skips, *args], cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout.strip()


def bump(root: Path, version: str, changelog: bool = True, ref: str = "HEAD") -> None:
    version = version.removeprefix("v")
    if not SEMVER.match(version):
        raise SystemExit(f"not a semver version: {version}")
    if check(root) != 0:
        raise SystemExit("fix the disagreement before bumping")
    for f in FILES:
        f.write(root, version)
    if changelog:
        git_cliff("--tag", f"v{version}", "-o", "CHANGELOG.md", ref=ref)
    check(root)
    print(
        f"\nNext:\n"
        f'  but commit -b <branch> -m "chore(release): v{version}"\n'
        f"  git tag -a v{version} -m v{version}\n"
        f"  git push origin main v{version}"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check", help="verify the four version fields agree")
    bump_p = sub.add_parser("bump", help="set a new version everywhere")
    group = bump_p.add_mutually_exclusive_group(required=True)
    group.add_argument("version", nargs="?", help="e.g. 0.2.0")
    group.add_argument("--auto", action="store_true", help="let git-cliff pick it")
    bump_p.add_argument(
        "--ref",
        default="HEAD",
        help="branch being released; under GitButler pass it so other applied branches stay out",
    )
    args = parser.parse_args(argv)

    if args.command == "check":
        return check(ROOT)
    version = git_cliff("--bumped-version", ref=args.ref) if args.auto else args.version
    bump(ROOT, version, ref=args.ref)
    return 0


if __name__ == "__main__":
    sys.exit(main())
