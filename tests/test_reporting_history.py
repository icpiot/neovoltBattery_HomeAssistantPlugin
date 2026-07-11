from __future__ import annotations

import json
from pathlib import Path

from custom_components.bytewatt.reporting import ByteWattReportHistory


class _FakeConfig:
    def __init__(self, base_dir: Path) -> None:
        self._base_dir = base_dir

    def path(self, *parts: str) -> str:
        return str(self._base_dir.joinpath(*parts))


class _FakeHass:
    def __init__(self, base_dir: Path) -> None:
        self.config = _FakeConfig(base_dir)


def _valid_reporting_payload() -> dict[str, object]:
    return {
        "aggregate": True,
        "label": "All systems",
        "meta": {"saved_at": "2026-07-10T00:00:00+00:00"},
        "power_diagram": {
            "date": "2026-07-08",
            "time": ["00:00", "00:05"],
            "series": {
                "bat": [1, 2],
                "load": [3, 4],
                "solar": [5, 6],
                "feed_in": [7, 8],
                "consumed": [9, 10],
            },
            "summary": {"soc": 42},
            "meta": {},
        },
    }


def test_mark_missing_date_keeps_existing_valid_record(tmp_path):
    history = ByteWattReportHistory(_FakeHass(tmp_path), "entry-1")
    history._store_snapshot_sync(
        scope_key="all",
        label="All systems",
        record_date="2026-07-08",
        reporting=_valid_reporting_payload(),
    )

    history._mark_missing_date_sync(
        scope_key="all",
        label="All systems",
        record_date="2026-07-08",
        reason="no_reporting_data",
    )

    payload = json.loads((tmp_path / "www" / "bytewatt-history" / "entry-1" / "history.json").read_text(encoding="utf-8"))
    scope = payload["scopes"]["all"]
    assert "2026-07-08" in scope["records"]
    assert "2026-07-08" not in scope.get("missing_dates", {})


def test_mark_missing_date_removes_blank_record(tmp_path):
    history_dir = tmp_path / "www" / "bytewatt-history" / "entry-1"
    history_dir.mkdir(parents=True, exist_ok=True)
    history_file = history_dir / "history.json"
    history_file.write_text(
        json.dumps(
            {
                "version": 1,
                "scopes": {
                    "all": {
                        "label": "All systems",
                        "records": {
                            "2026-07-08": {
                                "aggregate": True,
                                "label": "All systems",
                                "reporting_date": "2026-07-08",
                                "meta": {},
                                "power_diagram": {
                                    "date": "2026-07-08",
                                    "meta": {},
                                    "summary": {},
                                    "time": [],
                                    "series": {},
                                },
                            }
                        },
                        "missing_dates": {},
                    }
                },
            }
        ),
        encoding="utf-8",
    )

    history = ByteWattReportHistory(_FakeHass(tmp_path), "entry-1")
    history._mark_missing_date_sync(
        scope_key="all",
        label="All systems",
        record_date="2026-07-08",
        reason="no_reporting_data",
    )

    payload = json.loads(history_file.read_text(encoding="utf-8"))
    scope = payload["scopes"]["all"]
    assert "2026-07-08" not in scope["records"]
    assert "2026-07-08" in scope["missing_dates"]
