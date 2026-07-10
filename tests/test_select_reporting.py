from custom_components.bytewatt.select import _reporting_payload


def test_reporting_payload_keeps_daily_chart_series():
    payload = _reporting_payload(
        {
            "soc": 48.5,
            "pbat": 120,
            "pload": 340,
            "pgrid": -80,
            "ppv": 260,
            "powerSource": "Solar",
            "Power_Diagram": {
                "date": "2026-07-10",
                "time": ["00:00", "00:15"],
                "series": {
                    "bat": [10, 11],
                    "load": [3, 4],
                    "solar": [2, 5],
                    "feed_in": [0, 1],
                    "consumed": [1, 2],
                },
                "summary": {"soc": 48.5},
                "meta": {"power_source": "Solar"},
            },
        },
        aggregate=False,
        label="All systems",
    )

    power_diagram = payload["power_diagram"]
    assert power_diagram["date"] == "2026-07-10"
    assert power_diagram["time"] == ["00:00", "00:15"]
    assert power_diagram["series"]["bat"] == [10, 11]
    assert power_diagram["series"]["solar"] == [2, 5]
    assert power_diagram["summary"]["soc"] == 48.5
