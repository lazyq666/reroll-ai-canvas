#!/usr/bin/env python3
"""Synchronize local frontend URL fingerprints; --check never writes files.

Literal local URLs are the dependency interface, including import(), Worker,
new URL(), CSS url()/@import and loader arrays. Computed executable paths must
be replaced with literal URL tables. The avatar image set is the one explicit
runtime-generated URL group. No runtime build, mtime or release number is used.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import posixpath
import re
from pathlib import Path
from urllib.parse import unquote, unquote_plus

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = "static/frontend-assets.json"
POLICY = "scripts/frontend-assets-policy.json"
TEXT = {".js", ".mjs", ".css", ".html", ".json"}
SUFFIX = r"(?:m?js|css|json|png|svg|jpe?g|webp|gif|ico|woff2?|ttf|wasm)"
# Start at a URL delimiter, never inside an external URL, prose or regex.
URL = re.compile(
    rf'''(?<=["'`(\s])(?P<path>(?:/static/|\./|\.\./)[\w./%+@-]+\.{SUFFIX})(?![\w.])'''
    r'''(?P<query>\?[^"'`\\\s<>\)\#]*)?(?P<fragment>\#[^"'`\\\s<>\)]*)?'''
)
BARE_URL = re.compile(
    r'''(?P<prefix>\b(?:src|href)\s*=\s*["']|\burl\(\s*["']?|@import\s*["']|\bnew\s+URL\(\s*["'`])'''
    rf'''(?P<path>[\w@-][\w./%+@-]*\.{SUFFIX})(?![\w.])'''
    r'''(?P<query>\?[^"'`\\\s<>\)\#]*)?(?P<fragment>\#[^"'`\\\s<>\)]*)?'''
)
AVATAR = "static/js/account-avatar.js"
AVATAR_VERSION = re.compile(r"(?P<prefix>const ASSET_VERSION = ['\"])[^'\"]+(?P<suffix>['\"])")


def fingerprint(data: bytes) -> str:
    return "asset-" + hashlib.sha256(data).hexdigest()[:12]


def tree_digest(root: Path, prefix: str) -> str:
    digest = hashlib.sha256()
    for path in sorted((root / prefix).rglob("*")):
        if path.is_file():
            digest.update(path.relative_to(root).as_posix().encode() + b"\0")
            digest.update(path.read_bytes() + b"\0")
    return digest.hexdigest()


def with_version(match, version: str) -> str:
    # Preserve non-version parameters and fragments verbatim (including &amp;).
    query = (match["query"] or "")[1:]
    separator = "&amp;" if "&amp;" in query else "&"
    parts = [part for part in query.split(separator) if part
             and unquote_plus(part.partition("=")[0]) != "v"]
    return (match.groupdict().get('prefix') or '') + match["path"] + "?" + separator.join([f"v={version}", *parts]) + (match["fragment"] or "")


class AssetGraph:
    """Discover once, calculate the whole graph, then check or write a plan."""

    def __init__(self, root: Path):
        self.root = root.resolve()
        self.policy = json.loads((self.root / POLICY).read_text())
        self.sources: dict[str, str] = {}
        self.contents: dict[str, bytes] = {}
        self.refs: dict[str, list] = {}
        self.edges: dict[str, set[str]] = {}
        self.errors: list[str] = []
        self.versions: dict[str, str] = {}
        self.outputs: dict[str, bytes] = {}
        for exclusion in self.policy["pinned_trees"]:
            actual = tree_digest(self.root, exclusion["path"])
            if actual != exclusion["sha256"]:
                self.errors.append(f"{exclusion['path']}: pinned vendor tree changed; verify its release and update {POLICY}")
        self.discover()
        if not self.errors:
            self.calculate()

    def excluded(self, name: str) -> bool:
        return (name == MANIFEST or name in self.policy["excluded_files"]
                or any(name.startswith(item["path"].rstrip("/") + "/")
                       for item in self.policy["pinned_trees"])
                or any(name.startswith(prefix) for prefix in self.policy["excluded_directories"]))

    def target(self, owner: str, match) -> str | None:
        path = unquote(match["path"])
        if path.startswith("/static/"):
            target = posixpath.normpath(path.lstrip("/"))
        elif owner.startswith("static/"):
            target = posixpath.normpath(posixpath.join(posixpath.dirname(owner), path))
        else:
            return None
        location = f"{owner}:{self.sources[owner].count(chr(10), 0, match.start()) + 1}"
        resolved = (self.root / target).resolve()
        if not target.startswith("static/") or not resolved.is_relative_to(self.root / "static"):
            self.errors.append(f"{location}: asset escapes static directory: {path}")
            return None
        if not resolved.is_file():
            self.errors.append(f"{location}: missing asset {target}")
            return None
        if self.excluded(target):
            if not any(target.startswith(item["path"].rstrip("/") + "/") for item in self.policy["pinned_trees"]):
                self.errors.append(f"{location}: production reference to excluded asset {target}")
            return None
        return target

    def discover(self):
        # Inventory every local executable/style, even if nothing imports it yet.
        pending = {path.relative_to(self.root).as_posix()
                   for path in (self.root / "static").rglob("*")
                   if path.is_file() and path.suffix in TEXT
                   and not self.excluded(path.relative_to(self.root).as_posix())}
        pending.update(self.policy["embedded_sources"])
        # New server-rendered pages must not require adding another allowlist.
        pending.update(path.relative_to(self.root).as_posix()
                       for path in (self.root / 'backend').rglob('*.py')
                       if re.search(r'/static/[^\s"\'`<>]+\.(?:js|css)', path.read_text()))
        avatars = {path.relative_to(self.root).as_posix()
                   for path in (self.root / "static/images/avatars").glob("*.png")}
        pending.update(avatars)
        while pending:
            owner = min(pending)
            pending.remove(owner)
            if owner in self.contents:
                continue
            path = self.root / owner
            self.contents[owner] = path.read_bytes()
            self.edges[owner] = set()
            self.refs[owner] = []
            if path.suffix not in TEXT | {".py"}:
                continue
            self.sources[owner] = self.contents[owner].decode("utf-8")
            for literal in re.finditer(r'''["'`](/static/(?:js|css)/[^"'`\n]*)["'`]''', self.sources[owner]):
                value = literal[1].split('?', 1)[0].split('#', 1)[0]
                if '${' in value or not value.endswith(('.js', '.mjs', '.css')):
                    line = self.sources[owner].count('\n', 0, literal.start()) + 1
                    self.errors.append(f'{owner}:{line}: computed/incomplete local code URL {value}; use complete literal URLs')
            # Nonliteral module/worker URLs cannot have a statically verified
            # dependency identity. Fail instead of silently missing an edge.
            if path.suffix in {".js", ".mjs", ".html"}:
                for call in re.finditer(r'\b(?:import\s*\(|new\s+(?:Shared)?Worker\s*\()', self.sources[owner]):
                    tail = self.sources[owner][call.end():]
                    if 'Worker' in call[0]:
                        tail = re.sub(r'^\s*new\s+URL\s*\(', '', tail)
                    literal = re.match(r'''\s*(["'`])([^"'`\n]*)\1\s*([,)])''', tail)
                    if not literal or '${' in literal[2]:
                        line = self.sources[owner].count('\n', 0, call.start()) + 1
                        self.errors.append(f'{owner}:{line}: computed module/Worker URL; use a literal URL table')
            matches = sorted([*URL.finditer(self.sources[owner]), *BARE_URL.finditer(self.sources[owner])], key=lambda match: match.start())
            for match in matches:
                prefix = self.sources[owner][max(0, match.start() - 100):match.start()]
                if re.search(r'''\brequire\(\s*["']$''', prefix):
                    # CommonJS fallback is a filesystem path used only in Node,
                    # not a URL loaded by the browser.
                    continue
                target = self.target(owner, match)
                if target is None:
                    continue
                if "${" in match[0]:
                    self.errors.append(f"{owner}: computed asset URL must use a literal URL table: {match[0]}")
                    continue
                self.refs[owner].append((match, target))
                self.edges[owner].add(target)
                pending.add(target)
            if owner == AVATAR:
                self.edges[owner].update(avatars)
        self.avatar_version = fingerprint(b"".join(name.encode() + b"\0" + self.contents[name] + b"\0" for name in sorted(avatars)))

    def rewrite(self, owner: str, versions: dict[str, str]) -> bytes:
        if owner not in self.sources:
            return self.contents[owner]
        source = self.sources[owner]
        for match, target in reversed(self.refs[owner]):
            source = source[:match.start()] + with_version(match, versions[target]) + source[match.end():]
        if owner == AVATAR:
            source = AVATAR_VERSION.sub(lambda m: m["prefix"] + self.avatar_version + m["suffix"], source)
        return source.encode("utf-8")

    def components(self):
        # Tarjan: mutually importing modules share a stable normalized fingerprint.
        index, low, stack, active, groups = {}, {}, [], set(), []

        def visit(node):
            index[node] = low[node] = len(index)
            stack.append(node)
            active.add(node)
            for child in sorted(self.edges[node]):
                if child not in index:
                    visit(child)
                    low[node] = min(low[node], low[child])
                elif child in active:
                    low[node] = min(low[node], index[child])
            if low[node] == index[node]:
                group = []
                while True:
                    child = stack.pop()
                    active.remove(child)
                    group.append(child)
                    if child == node:
                        break
                groups.append(sorted(group))

        for node in sorted(self.contents):
            if node not in index:
                visit(node)
        return groups  # dependencies precede their importers

    def calculate(self):
        for group in self.components():
            if len(group) == 1 and group[0] not in self.edges[group[0]]:
                name = group[0]
                self.outputs[name] = self.rewrite(name, self.versions)
                self.versions[name] = fingerprint(self.outputs[name])
            else:
                normalized = dict(self.versions, **{name: "ASSET_CYCLE" for name in group})
                content = b"".join(name.encode() + b"\0" + self.rewrite(name, normalized) + b"\0" for name in group)
                for name in group:
                    self.versions[name] = fingerprint(content + name.encode())
                for name in group:
                    self.outputs[name] = self.rewrite(name, self.versions)
        # Compatibility markers are generated by this owner, never separate hashes.
        for marker, target in self.policy["version_markers"].items():
            if target in self.versions:
                self.outputs[marker] = (self.versions[target] + "\n").encode()
        if AVATAR in self.versions:
            self.outputs["static/images/avatars/VERSION"] = (self.avatar_version + "\n").encode()
        manifest = {
            "schema_version": 1,
            "assets": {name: {"version": self.versions[name], "dependencies": sorted(self.edges[name])}
                       for name in sorted(self.versions) if name.startswith("static/")},
        }
        self.outputs[MANIFEST] = (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode()
        # Test harnesses are consumers, not inputs to the production graph.
        # Only refresh already-versioned absolute URLs; never rewrite test data
        # filenames or assertions which deliberately exercise unversioned inputs.
        for path in sorted((self.root / "tests").rglob("*")):
            if not path.is_file() or path.suffix not in {".html", ".cjs", ".mjs"}:
                continue
            source = path.read_text()
            def replace(match):
                target = match["path"].lstrip("/")
                if target in self.versions and match["path"].startswith("/static/") and match["query"]:
                    return with_version(match, self.versions[target])
                return match[0]
            updated = URL.sub(replace, source)
            if updated != source:
                self.outputs[path.relative_to(self.root).as_posix()] = updated.encode()

    def run(self, check: bool = False) -> int:
        errors = list(self.errors)
        if errors:
            print("\n".join(errors))
            print("Fix the referenced paths/policy, then run: python3 scripts/sync_frontend_assets.py")
            return 1
        changed = [name for name, value in sorted(self.outputs.items())
                   if not (self.root / name).exists() or (self.root / name).read_bytes() != value]
        if check and changed:
            try:
                previous = json.loads((self.root / MANIFEST).read_text()).get('assets', {})
            except (FileNotFoundError, ValueError):
                previous = {}
            for name in sorted(set(previous) | set(self.versions)):
                if not name.startswith('static/'):
                    continue
                if name not in previous:
                    errors.append(f'{MANIFEST}: unmanaged/new resource {name}')
                elif name not in self.versions:
                    errors.append(f'{MANIFEST}: removed resource {name}')
                elif previous[name].get('version') != self.versions[name]:
                    errors.append(f'{MANIFEST}: {name}: content fingerprint is out of date')
            for name in changed:
                if name in self.refs:
                    for match, target in self.refs[name]:
                        expected = with_version(match, self.versions[target])
                        if expected != match[0]:
                            line = self.sources[name].count("\n", 0, match.start()) + 1
                            errors.append(f"{name}:{line}: {target}: expected {expected}, found {match[0]}")
                if not any(error.startswith(name + ":") for error in errors):
                    errors.append(f"{name}: content fingerprint/inventory is out of date")
            print("\n".join(errors))
            print("Run: python3 scripts/sync_frontend_assets.py")
            return 1
        for name in changed:
            (self.root / name).write_bytes(self.outputs[name])
        print(f"Frontend assets: {len(self.versions)} managed, {len(changed)} updated; {'check passed' if check else 'synchronized'}.")
        return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--root", type=Path, default=ROOT, help="source tree (also used by isolated upgrade fixtures)")
    args = parser.parse_args()
    return AssetGraph(args.root).run(args.check)


if __name__ == "__main__":
    raise SystemExit(main())
