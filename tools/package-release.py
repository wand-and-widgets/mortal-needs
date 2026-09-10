"""Build a runtime-only Foundry archive from the reviewed release allowlist.

Run with Python 3.11+. Outputs are local and are never added to the package.
Use --write-allowlist only when intentionally reviewing changed dependencies.
"""
import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent.parent
ALLOWLIST = ROOT / "tools/release-files.json"
ICONS = "cold comfort corruption environmental exhaustion fatigue fear heat hunger morale pain radiation sanity seal thirst".split()
FONT_LICENSES = [f"assets/fonts/{name}-OFL.txt" for name in ("barlowcondensed", "cinzel", "pirataone")]


def local_path(path):
    resolved = (ROOT / unquote(path)).resolve()
    if not resolved.is_relative_to(ROOT) or not resolved.is_file():
        raise ValueError(f"Missing or unsafe package dependency: {path}")
    return resolved.relative_to(ROOT).as_posix()


def dependencies(manifest):
    pending = ["module.json", "LICENSE", *manifest["esmodules"], *manifest["styles"],
               *(item["path"] for item in manifest["languages"]), *FONT_LICENSES,
               *(f"assets/icons/{icon}.svg" for icon in ICONS)]
    selected = set()
    while pending:
        name = local_path(pending.pop())
        if name in selected:
            continue
        selected.add(name)
        path = ROOT / name
        if path.suffix not in (".js", ".css", ".hbs"):
            continue
        source = path.read_text(encoding="utf-8-sig")
        if path.suffix == ".js":
            imports = re.findall(r"(?:from\s*|import\s*(?:\(\s*)?)[\"'](\.[^\"']+\.js)[\"']", source)
            pending.extend((path.parent / value).relative_to(ROOT).as_posix() for value in imports)
        if path.suffix == ".css":
            for value in re.findall(r"url\(\s*['\"]?([^)'\"]+)", source):
                if not re.match(r"(?:data:|https?:|#)", value):
                    pending.append((path.parent / unquote(value)).relative_to(ROOT).as_posix())
        pending.extend(re.findall(r"templates/[A-Za-z0-9_./-]+\.hbs", source))
    return sorted(selected)


def permitted(name):
    if name in ("module.json", "LICENSE", *FONT_LICENSES):
        return True
    return bool(re.fullmatch(r"(?:scripts/[\w/-]+\.js|styles/[\w/-]+\.css|templates/[\w/-]+\.hbs|languages/[\w-]+\.json|assets/icons/[\w-]+\.svg|assets/fonts/[\w\[\]-]+\.ttf)", name))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write-allowlist", action="store_true")
    args = parser.parse_args()
    manifest = json.loads((ROOT / "module.json").read_text(encoding="utf-8-sig"))
    version = manifest["version"]
    assert manifest["id"] == "mortal-needs" and manifest["protected"] is False
    assert re.fullmatch(r"\d+\.\d+\.\d+", version), "Expected a stable semantic version"
    base = "https://github.com/wand-and-widgets/mortal-needs"
    assert manifest["download"] == f"{base}/releases/download/v{version}/mortal-needs.zip"
    assert manifest["manifest"] == f"{base}/releases/latest/download/module.json"
    assert manifest["readme"] == f"{base}/blob/v{version}/README.md"
    assert manifest["changelog"] == f"{base}/releases/tag/v{version}"
    required = dependencies(manifest)
    if args.write_allowlist:
        ALLOWLIST.write_text(json.dumps(required, indent=2) + "\n", encoding="utf-8")
        print(f"Review {ALLOWLIST}: {len(required)} runtime and license files")
        return
    files = json.loads(ALLOWLIST.read_text(encoding="utf-8"))
    assert files == sorted(set(files)), "Allowlist must be sorted and unique"
    assert files == required, f"Review dependencies. Missing: {set(required)-set(files)}; unused: {set(files)-set(required)}"
    assert all(permitted(name) for name in files), "Non-runtime file found in allowlist"
    payloads = {name: (ROOT / local_path(name)).read_bytes() for name in files}
    out = ROOT / "releases" / version
    out.mkdir(parents=True, exist_ok=True)
    archive = out / "mortal-needs.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for name, data in payloads.items():
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            bundle.writestr(info, data, compresslevel=9)
    with zipfile.ZipFile(archive) as bundle:
        assert bundle.namelist() == files and bundle.testzip() is None
        for name, data in payloads.items():
            assert bundle.read(name) == data, f"Archive content mismatch: {name}"
        assert json.loads(bundle.read("module.json")) == manifest
    (out / "module.json").write_bytes(payloads["module.json"])
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    inventory = {"version": version, "archive": archive.name, "bytes": archive.stat().st_size,
                 "sha256": digest, "fileCount": len(files), "files": [
                     {"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
                     for name, data in payloads.items()]}
    (out / "inventory.json").write_text(json.dumps(inventory, indent=2) + "\n", encoding="utf-8")
    (out / "SHA256SUMS.txt").write_text(f"{digest}  mortal-needs.zip\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in inventory.items() if k != "files"}, indent=2))


if __name__ == "__main__":
    main()
