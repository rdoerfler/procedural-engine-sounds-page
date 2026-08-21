#!/usr/bin/env python3
"""Fetch public download metrics for the Procedural Engine Sounds releases.

By default this writes ``dataset_download_metrics.json`` next to this script,
which a static-site build can read directly.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


SOURCES = {
    "Hugging Face (original)": {
        "url": (
            "https://huggingface.co/api/datasets/"
            "rdoerfler/procedural-engine-sounds"
            "?expand=downloads&expand=downloadsAllTime"
        ),
        "metrics": {
            "downloads_last_30_days": ("downloads",),
            "downloads_all_time": ("downloadsAllTime",),
        },
    },
    "Hugging Face (copy)": {
        "url": (
            "https://huggingface.co/api/datasets/"
            "huggingbear12/procedural-engine-sounds"
            "?expand=downloads&expand=downloadsAllTime"
        ),
        "metrics": {
            "downloads_last_30_days": ("downloads",),
            "downloads_all_time": ("downloadsAllTime",),
        },
    },
    "Zenodo": {
        "url": "https://zenodo.org/api/records/16883336",
        "metrics": {
            "downloads_all_time": ("stats", "downloads"),
            "unique_downloads_all_time": ("stats", "unique_downloads"),
            "views_all_time": ("stats", "views"),
            "unique_views_all_time": ("stats", "unique_views"),
        },
    },
}
DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "assets" / "metrics.json"


class SourceFetchError(Exception):
    """Raised when a metrics source cannot be read."""


def get_json(url: str) -> dict[str, Any]:
    request = Request(url, headers={"User-Agent": "dataset-download-total/1.0"})
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def get_nested_value(payload: dict[str, Any], path: tuple[str, ...]) -> int:
    value: Any = payload
    for key in path:
        value = value[key]
    if not isinstance(value, int):
        raise TypeError(f"Expected an integer at {'.'.join(path)}, got {value!r}")
    return value


def fetch_all_sources() -> dict[str, dict[str, Any]]:
    """Fetch every configured source, raising SourceFetchError on the first failure."""
    source_metrics: dict[str, dict[str, Any]] = {}
    for name, source in SOURCES.items():
        try:
            payload = get_json(source["url"])
            metrics = {
                metric_name: get_nested_value(payload, field_path)
                for metric_name, field_path in source["metrics"].items()
            }
            source_metrics[name] = {"url": source["url"], "metrics": metrics}
        except (HTTPError, URLError, KeyError, TypeError, json.JSONDecodeError) as error:
            raise SourceFetchError(f"Could not read {name}: {error}") from error
    return source_metrics


def build_payload(
    source_metrics: dict[str, dict[str, Any]],
    retrieved_at: str | None = None,
) -> dict[str, Any]:
    """Assemble the output document from already-fetched source metrics."""
    if retrieved_at is None:
        retrieved_at = datetime.now(timezone.utc).isoformat()

    all_time_downloads = sum(
        source["metrics"]["downloads_all_time"]
        for source in source_metrics.values()
    )
    hf_monthly_downloads = sum(
        source["metrics"]["downloads_last_30_days"]
        for name, source in source_metrics.items()
        if name.startswith("Hugging Face")
    )
    return {
        "retrieved_at": retrieved_at,
        "totals": {
            "downloads_all_time": all_time_downloads,
            "hugging_face_downloads_last_30_days": hf_monthly_downloads,
        },
        "metric_notes": {
            "downloads_all_time": (
                "Sum of the all-time download counters reported by each release "
                "platform. It is not deduplicated across platforms."
            ),
            "hugging_face_downloads_last_30_days": (
                "Rolling 30-day Hugging Face download count across the two "
                "Hugging Face datasets. Zenodo does not provide a matching "
                "30-day counter in this record response."
            ),
        },
        "sources": source_metrics,
    }


def content_unchanged(existing: dict[str, Any], candidate: dict[str, Any]) -> bool:
    """True if the meaningful content matches, ignoring the retrieved_at timestamp."""
    return (
        existing.get("totals") == candidate.get("totals")
        and existing.get("sources") == candidate.get("sources")
    )


def write_if_changed(output_path: Path, payload: dict[str, Any]) -> bool:
    """Write payload to output_path unless it only differs from what's on disk by
    ``retrieved_at``. Returns True if the file was (re)written, False if the
    existing file was left untouched.
    """
    if output_path.exists():
        try:
            existing = json.loads(output_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            existing = None
        if existing is not None and content_unchanged(existing, payload):
            print(f"counts unchanged since {existing.get('retrieved_at')}")
            return False

    output_path.parent.mkdir(parents=True, exist_ok=True)
    rendered_output = json.dumps(payload, indent=2) + "\n"
    output_path.write_text(rendered_output, encoding="utf-8")
    print(f"Wrote {output_path}")
    print(f"All-time downloads: {payload['totals']['downloads_all_time']:,}")
    return True


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"JSON output path (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--stdout",
        action="store_true",
        help="Write JSON to standard output instead of a file.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        source_metrics = fetch_all_sources()
    except SourceFetchError as error:
        print(str(error), file=sys.stderr)
        return 1

    payload = build_payload(source_metrics)

    if args.stdout:
        rendered_output = json.dumps(payload, indent=2) + "\n"
        print(rendered_output, end="")
    else:
        write_if_changed(args.output, payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
