const BYTEWATT_REPORT_CARD_BUILD = "117";

class ByteWattReportCard extends HTMLElement {
  setConfig(config) {
    const prefix = config?.entity_prefix || "house_bytewatt_battery_system";
    this._config = {
      entity_prefix: prefix,
      settings_target: config?.settings_target || `select.${prefix}_settings_target`,
      ...config,
    };
    this._view = this._view || "power";
      this._activeSeries = this._activeSeries || {
      bat: true,
      load: true,
      solar: true,
      feed_in: true,
      consumed: true,
    };
    this._reportPeriod = this._reportPeriod || "day";
    this._reportAnchorDate = this._reportAnchorDate || "";
    this._historyPeriod = this._historyPeriod || "7d";
    this._historyLoading = false;
    this._historyData = this._historyData || null;
    this._historyLoadError = this._historyLoadError || "";
    this._historyAttempted = this._historyAttempted || false;
    this._historySourceKey = this._historySourceKey || "";
  }

  set hass(hass) {
    this._hass = hass;
    this.render();
  }

  getCardSize() {
    return 20;
  }

  _stateObj(entityId) {
    return entityId ? this._hass?.states?.[entityId] : null;
  }

  _selectorState() {
    return this._stateObj(this._config.settings_target);
  }

  _reporting() {
    return this._selectorState()?.attributes?.reporting || null;
  }

  _systemSummaries() {
    return this._selectorState()?.attributes?.all_system_summaries || [];
  }

  _selectionMeta() {
    const attrs = this._selectorState()?.attributes || {};
    return {
      system_id: attrs.system_id || "",
      sys_sn: attrs.sys_sn || "",
      remark: attrs.remark || "",
    };
  }

  _historyMeta() {
    return this._selectorState()?.attributes?.history || {};
  }

  _historyScopeKey() {
    const history = this._historyMeta();
    const currentScope = String(history.current_scope || "").trim();
    return currentScope || "all";
  }

  _historyUrl() {
    const history = this._historyMeta();
    if (!history.enabled || !history.base_url) return "";
    const base = String(history.base_url).replace(/\/+$/, "");
    return `${base}/history.json`;
  }

  _historyPeriodDays() {
    return this._historyPeriod === "30d" ? 30 : this._historyPeriod === "all" ? 3650 : 7;
  }

  _historyRecordWindow(recordDates) {
    const dates = (recordDates || [])
      .map((item) => new Date(`${item}T00:00:00`))
      .filter((item) => !Number.isNaN(item.getTime()))
      .sort((a, b) => a - b);
    if (!dates.length) return [];
    if (this._historyPeriod === "all") return dates;
    const end = dates[dates.length - 1];
    const start = new Date(end.getTime());
    start.setDate(start.getDate() - (this._historyPeriodDays() - 1));
    return dates.filter((item) => item >= start && item <= end);
  }

  _parseFloat(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  _aggregateHistoryRecords(records) {
    const aggregate = {
      count: 0,
      first_date: "",
      latest_date: "",
      latest_saved_at: "",
      live_soc: 0,
      solar_generation_today: 0,
      load_consumption_today: 0,
      feed_in_today: 0,
      grid_consumption_today: 0,
      battery_charged_today: 0,
      battery_discharged_today: 0,
      total_solar_generation: 0,
      total_feed_in: 0,
      total_battery_charge: 0,
      total_battery_discharge: 0,
      total_house_consumption: 0,
      total_grid_consumption: 0,
      pv_power_house: 0,
      pv_charging_battery: 0,
      grid_battery_charge: 0,
    };

    const firstRecord = records[0] || {};
    const latestRecord = records[records.length - 1] || {};

    records.forEach((record) => {
      aggregate.count += 1;
      if (!aggregate.first_date) {
        aggregate.first_date = record.reporting_date || record.record_date || "";
      }
      aggregate.latest_date = record.reporting_date || record.record_date || aggregate.latest_date;
      aggregate.latest_saved_at = record.saved_at || aggregate.latest_saved_at;
      aggregate.solar_generation_today += this._parseFloat(record.solar_generation_today);
      aggregate.load_consumption_today += this._parseFloat(record.load_consumption_today);
      aggregate.feed_in_today += this._parseFloat(record.feed_in_today);
      aggregate.grid_consumption_today += this._parseFloat(record.grid_consumption_today);
      aggregate.battery_charged_today += this._parseFloat(record.battery_charged_today);
      aggregate.battery_discharged_today += this._parseFloat(record.battery_discharged_today);
    });

    const periodDelta = (key) => {
      const start = this._parseFloat(firstRecord?.[key]);
      const end = this._parseFloat(latestRecord?.[key]);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        return Math.max(end - start, 0);
      }
      return end || 0;
    };

    aggregate.live_soc = this._parseFloat(latestRecord.live_soc);
    aggregate.total_solar_generation = periodDelta("total_solar_generation");
    aggregate.total_feed_in = periodDelta("total_feed_in");
    aggregate.total_battery_charge = periodDelta("total_battery_charge");
    aggregate.total_battery_discharge = periodDelta("total_battery_discharge");
    aggregate.total_house_consumption = periodDelta("total_house_consumption");
    aggregate.total_grid_consumption = periodDelta("total_grid_consumption");
    aggregate.pv_power_house = periodDelta("pv_power_house");
    aggregate.pv_charging_battery = periodDelta("pv_charging_battery");
    aggregate.grid_battery_charge = periodDelta("grid_battery_charge");

    return aggregate;
  }

  async _ensureHistoryLoaded() {
    const url = this._historyUrl();
    if (!url || this._historyLoading || this._historyData || this._historyAttempted) return;
    this._historyLoading = true;
    this._historyAttempted = true;
    this._historyLoadError = "";
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      this._historyData = data;
    } catch (error) {
      this._historyLoadError = String(error?.message || error);
      this._historyData = null;
    } finally {
      this._historyLoading = false;
      this.render();
    }
  }

  _historyRecords() {
    const data = this._historyData?.scopes?.[this._historyScopeKey()]?.records || {};
    return Object.entries(data).map(([recordDate, reporting]) => ({
      record_date: recordDate,
      ...(reporting || {}),
    }));
  }

  _selectedHistoryRecords() {
    const records = this._historyRecords().sort((a, b) => String(a.record_date).localeCompare(String(b.record_date)));
    if (!records.length) return [];
    const windowDates = this._historyRecordWindow(records.map((record) => record.record_date));
    if (!windowDates.length) return records;
    const allowed = new Set(windowDates.map((date) => date.toISOString().slice(0, 10)));
    return records.filter((record) => allowed.has(record.record_date));
  }

  _reportPeriodLabel(value = this._reportPeriod) {
    return { today: "Today", day: "Day", week: "Week", month: "Month" }[value] || "Day";
  }

  _isDailyPeriod(period = this._reportPeriod) {
    return period === "day" || period === "today";
  }

  _parseLocalDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }
    const text = String(value).trim();
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  _formatLocalDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    const pad = (number) => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  _formatDisplayDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    const pad = (number) => String(number).padStart(2, "0");
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
  }

  _historyRange(records) {
    const dates = (records || [])
      .map((record) => this._parseLocalDate(record?.record_date))
      .filter(Boolean)
      .sort((a, b) => a - b);
    if (!dates.length) return { first: "", latest: "" };
    return {
      first: this._formatLocalDate(dates[0]),
      latest: this._formatLocalDate(dates[dates.length - 1]),
    };
  }

  _periodWindow(anchor, period = this._reportPeriod) {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    const end = new Date(start.getTime());
    if (period === "week") {
      const mondayOffset = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - mondayOffset);
      end.setDate(start.getDate() + 6);
    } else if (period === "month") {
      start.setDate(1);
      end.setMonth(start.getMonth() + 1, 0);
    }
    return { start, end };
  }

  _shiftAnchor(anchor, period, step) {
    const shifted = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    if (period === "week") {
      shifted.setDate(shifted.getDate() + step * 7);
    } else if (period === "month") {
      shifted.setMonth(shifted.getMonth() + step);
    } else {
      shifted.setDate(shifted.getDate() + step);
    }
    return shifted;
  }

  _clampAnchor(anchor, records) {
    const dates = (records || [])
      .map((record) => this._parseLocalDate(record?.record_date))
      .filter(Boolean)
      .sort((a, b) => a - b);
    if (!dates.length) return anchor;
    const earliest = dates[0];
    const latest = dates[dates.length - 1];
    if (anchor < earliest) return earliest;
    if (anchor > latest) return latest;
    return anchor;
  }

  _recordsForPeriod(records, anchor, period = this._reportPeriod) {
    if (!anchor) return records || [];
    const window = this._periodWindow(anchor, period);
    return (records || []).filter((record) => {
      const date = this._parseLocalDate(record?.record_date);
      return date && date >= window.start && date <= window.end;
    });
  }

  _periodSummary(records) {
    return this._aggregateHistoryRecords(records || []);
  }

  _periodStatus(records, loading, error) {
    if (loading) return "Downloading local archive...";
    if (error) return `Archive unavailable: ${error}`;
    const range = this._historyRange(records);
    const first = range.first ? this._formatDisplayDate(this._parseLocalDate(range.first)) : "";
    const latest = range.latest ? this._formatDisplayDate(this._parseLocalDate(range.latest)) : "";
    if (first && latest) return `Archive ready (${first} to ${latest})`;
    if (latest) return `Archive ready (${latest})`;
    return "Archive ready";
  }

  _buildPeriodPowerDiagram(records, summary, latestReporting, period, anchor, window) {
    if (this._isDailyPeriod(period)) {
      const source = latestReporting?.power_diagram || {};
      return {
        ...source,
        date: source.date || this._formatDisplayDate(anchor) || "",
      };
    }

    const rows = (records || []).slice().sort((a, b) => String(a.record_date).localeCompare(String(b.record_date)));
    const time = rows.map((record) => record.record_date || "");
    const series = {
      bat: rows.map((record) => this._parseFloat(record.live_soc)),
      load: rows.map((record) => this._parseFloat(record.load_consumption_today)),
      solar: rows.map((record) => this._parseFloat(record.solar_generation_today)),
      feed_in: rows.map((record) => this._parseFloat(record.feed_in_today)),
      consumed: rows.map((record) => this._parseFloat(record.grid_consumption_today)),
    };
    const latest = rows[rows.length - 1] || {};
    return {
      date: `${this._formatDisplayDate(window.start)} -> ${this._formatDisplayDate(window.end)}`,
      time,
      series,
      summary: {
        soc: this._parseFloat(latest.live_soc),
        solar_generation: summary.total_solar_generation,
        load_consumption: summary.total_house_consumption,
        feed_in: summary.total_feed_in,
        grid_consumption: summary.total_grid_consumption,
        battery_charge: summary.total_battery_charge,
        battery_discharge: summary.total_battery_discharge,
      },
    };
  }

  _buildPeriodReporting(baseReporting) {
    const records = this._historyRecords();
    const sorted = records.slice().sort((a, b) => String(a.record_date).localeCompare(String(b.record_date)));
    const availableRange = this._historyRange(sorted);
    const fallbackDate = baseReporting?.power_diagram?.date || availableRange.latest || availableRange.first || "";
    if (!this._reportAnchorDate && fallbackDate) {
      this._reportAnchorDate = fallbackDate;
    }

    const anchor = this._clampAnchor(this._parseLocalDate(this._reportAnchorDate || fallbackDate) || new Date(), sorted);
    this._reportAnchorDate = this._formatLocalDate(anchor);
    const period = this._reportPeriod || "day";
    const selected = this._recordsForPeriod(sorted, anchor, period);
    if (!selected.length) {
      const fallbackWindow = this._periodWindow(anchor, period);
      const periodLabel = this._reportPeriodLabel(period);
      this._reportAnchorDate = this._formatLocalDate(this._isDailyPeriod(period) ? anchor : fallbackWindow.start);
      return {
        reporting: {
          ...(baseReporting || {}),
          aggregate: !this._isDailyPeriod(period),
          label: baseReporting?.label || "ByteWatt",
          meta: {
            ...(baseReporting?.meta || {}),
            aggregate: !this._isDailyPeriod(period),
            label: baseReporting?.label || "ByteWatt",
            period,
            period_label: periodLabel,
            period_start: this._formatLocalDate(fallbackWindow.start),
            period_end: this._formatLocalDate(fallbackWindow.end),
            saved_at: baseReporting?.meta?.saved_at || "",
          },
          power_diagram: {
            ...(baseReporting?.power_diagram || {}),
            date:
              this._isDailyPeriod(period)
                ? this._formatLocalDate(anchor)
                : `${this._formatLocalDate(fallbackWindow.start)} -> ${this._formatLocalDate(fallbackWindow.end)}`,
          },
        },
        records: sorted,
        anchor,
        period,
        window: fallbackWindow,
        availableRange,
      };
    }

    const summary = this._periodSummary(selected);
    const latest = selected[selected.length - 1] || {};
    const window = this._periodWindow(anchor, period);
    this._reportAnchorDate = this._formatLocalDate(this._isDailyPeriod(period) ? anchor : window.start);
    const live = latest.live || baseReporting?.live || {};
    const baseToday = baseReporting?.today || {};
    const totalSolar = summary.total_solar_generation || 0;
    const totalLoad = summary.total_house_consumption || 0;
    const totalFeed = summary.total_feed_in || 0;
    const periodToday = {
      solar_generation: summary.solar_generation_today,
      load_consumption: summary.load_consumption_today,
      feed_in: summary.feed_in_today,
      grid_consumption: summary.grid_consumption_today,
      battery_charge: summary.battery_charged_today,
      battery_discharge: summary.battery_discharged_today,
      self_consumption: totalSolar > 0 ? Math.max(((totalSolar - totalFeed) / totalSolar) * 100, 0) : baseToday.self_consumption,
      self_sufficiency:
        totalLoad > 0 ? Math.max(((totalLoad - summary.total_grid_consumption) / totalLoad) * 100, 0) : baseToday.self_sufficiency,
      trees_planted: latest.trees_planted ?? baseToday.trees_planted,
      co2_reduction_tons: latest.co2_reduction_tons ?? baseToday.co2_reduction_tons,
      today_income: selected.reduce((acc, record) => acc + this._parseFloat(record.today_income), 0),
      total_income: latest.total_income ?? baseToday.total_income,
    };
    const periodTotals = {
      solar_generation: summary.total_solar_generation,
      feed_in: summary.total_feed_in,
      battery_charge: summary.total_battery_charge,
      battery_discharge: summary.total_battery_discharge,
      house_consumption: summary.total_house_consumption,
      grid_consumption: summary.total_grid_consumption,
      pv_power_house: summary.pv_power_house,
      pv_charging_battery: summary.pv_charging_battery,
      grid_battery_charge: summary.grid_battery_charge,
    };
    const powerDiagram = this._buildPeriodPowerDiagram(selected, summary, latest, period, anchor, window);

    return {
      reporting: {
        ...(baseReporting || {}),
        aggregate: !this._isDailyPeriod(period),
        label: latest.label || baseReporting?.label || "ByteWatt",
        meta: {
          ...(latest.meta || baseReporting?.meta || {}),
          aggregate: !this._isDailyPeriod(period),
          label: latest.label || baseReporting?.label || "ByteWatt",
          period,
          period_label: this._reportPeriodLabel(period),
          period_start: this._formatLocalDate(window.start),
          period_end: this._formatLocalDate(window.end),
          saved_at: latest.saved_at || baseReporting?.meta?.saved_at || "",
        },
        live,
        today: periodToday,
        totals: periodTotals,
        power_diagram: powerDiagram,
      },
      records: selected,
      anchor,
      period,
      window,
      availableRange,
      summary,
    };
  }

  _renderHistoryPanel() {
    const history = this._historyMeta();
    if (!history.enabled) return "";
    const records = this._selectedHistoryRecords();
    const summary = this._aggregateHistoryRecords(records);
    const loading = this._historyLoading && !this._historyData;
    const error = this._historyLoadError;
    return `
      <section class="history-panel">
        <div class="panel-header">
          <div class="panel-title">Local Archive</div>
          <div class="panel-date">
            ${this._escape(summary.first_date ? `${summary.first_date} â†’ ${summary.latest_date || summary.first_date}` : history.base_url || "")}
          </div>
        </div>
        <div class="history-controls">
          ${this._historyButton("7 days", "7d")}
          ${this._historyButton("30 days", "30d")}
          ${this._historyButton("All", "all")}
        </div>
        ${
          loading
            ? `<div class="empty">Loading local history from ${this._escape(this._historyUrl())}...</div>`
            : error
              ? `<div class="empty">Local history unavailable: ${this._escape(error)}</div>`
              : records.length
                ? `
                  <div class="history-summary">
                    ${this._metric("Records", summary.count)}
                    ${this._metric("Latest Date", this._escape(summary.latest_date || "Unavailable"))}
                    ${this._metric("Solar", this._fmtEnergy(summary.solar_generation_today))}
                    ${this._metric("Load", this._fmtEnergy(summary.load_consumption_today))}
                    ${this._metric("Feed-in", this._fmtEnergy(summary.feed_in_today))}
                    ${this._metric("Grid", this._fmtEnergy(summary.grid_consumption_today))}
                  </div>
                  <div class="history-summary">
                    ${this._metric("Battery Charge", this._fmtEnergy(summary.battery_charged_today))}
                    ${this._metric("Battery Discharge", this._fmtEnergy(summary.battery_discharged_today))}
                    ${this._metric("PV to House", this._fmtEnergy(summary.pv_power_house))}
                    ${this._metric("PV to Battery", this._fmtEnergy(summary.pv_charging_battery))}
                    ${this._metric("Grid to Battery", this._fmtEnergy(summary.grid_battery_charge))}
                    ${this._metric("SOC", this._fmtPercent(summary.live_soc))}
                  </div>
                `
                : `<div class="empty">No local history records found yet for this scope.</div>`
        }
      </section>
    `;
  }

  _historyButton(label, value) {
    return `<button class="history-pill ${this._historyPeriod === value ? "active" : ""}" data-history-period="${value}">${label}</button>`;
  }

  _fmtNumber(value, digits = 1) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "Unavailable";
    return number
      .toFixed(digits)
      .replace(/\.0+$/, "")
      .replace(/(\.\d*[1-9])0+$/, "$1");
  }

  _fmtPower(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "Unavailable";
    return `${this._fmtNumber(number, 1)} W`;
  }

  _fmtEnergy(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "Unavailable";
    return `${this._fmtNumber(number, 2)} kWh`;
  }

  _fmtPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "Unavailable";
    return `${this._fmtNumber(number, 2)} %`;
  }

  _fmtCurrency(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "Unavailable";
    return `${this._fmtNumber(number, 2)} AUD`;
  }

  _fmtTrees(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "Unavailable";
    return this._fmtNumber(number, 2);
  }

  _fmtTons(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "Unavailable";
    return `${this._fmtNumber(number, 2)} t`;
  }

  _batteryDirection(powerValue) {
    const power = Number(powerValue);
    if (!Number.isFinite(power) || power === 0) return "Idle";
    return power > 0 ? "Discharging" : "Charging";
  }

  _gridDirection(powerValue) {
    const power = Number(powerValue);
    if (!Number.isFinite(power) || power === 0) return "Balanced";
    return power > 0 ? "Importing" : "Exporting";
  }

  _csvSafe(value) {
    const text = String(value ?? "");
    if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
      return `"${text.replaceAll("\"", "\"\"")}"`;
    }
    return text;
  }

  _buildCsv(reporting, periodContext = null) {
    const powerDiagram = reporting?.power_diagram || {};
    const summary = powerDiagram.summary || {};
    const live = reporting?.live || {};
    const today = reporting?.today || {};
    const totals = reporting?.totals || {};
    const series = powerDiagram.series || {};
    const times = powerDiagram.time || [];
    const period = reporting?.meta?.period || periodContext?.period || this._reportPeriod || "day";
    const records = periodContext?.records || [];
    const periodLabel = this._reportPeriodLabel(period);

    const rows = [
      ["Label", reporting?.label || "ByteWatt"],
      ["Period", this._reportPeriodLabel(period)],
      ["Date", powerDiagram.date || ""],
      ["Live SOC", live.soc ?? ""],
      ["Live Battery Power", live.battery_power ?? ""],
      ["Live Load Power", live.house_consumption ?? ""],
      ["Live Grid Power", live.grid_power ?? ""],
      ["Live PV Power", live.pv_power ?? ""],
      ["Power Source", live.power_source ?? ""],
      [],
      ["Summary"],
      ["Solar Generation", today.solar_generation ?? ""],
      ["Load Consumption", today.load_consumption ?? ""],
      ["Battery Charged", today.battery_charge ?? ""],
      ["Battery Discharged", today.battery_discharge ?? ""],
      ["Feed-in", today.feed_in ?? ""],
      ["Grid Consumption", today.grid_consumption ?? ""],
      ["Self Consumption", today.self_consumption ?? ""],
      ["Self Sufficiency", today.self_sufficiency ?? ""],
      [`${periodLabel} Income`, today.today_income ?? ""],
      ["Cumulative Income", today.total_income ?? ""],
      [],
      ["Totals"],
      ["Solar Generation", totals.solar_generation ?? ""],
      ["House Consumption", totals.house_consumption ?? ""],
      ["Battery Charge", totals.battery_charge ?? ""],
      ["Battery Discharge", totals.battery_discharge ?? ""],
      ["Feed-in", totals.feed_in ?? ""],
      ["Grid Consumption", totals.grid_consumption ?? ""],
      ["PV to House", totals.pv_power_house ?? ""],
      ["PV to Battery", totals.pv_charging_battery ?? ""],
      ["Grid -> Battery", totals.grid_battery_charge ?? ""],
      [],
      ["Power Diagram Summary"],
      ["SOC", summary.soc ?? ""],
      ["Solar Generation", summary.solar_generation ?? ""],
      ["Load Consumption", summary.load_consumption ?? ""],
      ["Feed-in", summary.feed_in ?? ""],
      ["Grid Consumption", summary.grid_consumption ?? ""],
      ["Battery Charge", summary.battery_charge ?? ""],
      ["Battery Discharge", summary.battery_discharge ?? ""],
      [],
    ];

    if (this._isDailyPeriod(period)) {
      rows.push(["Time", "BAT", "Load", "Solar", "Feed-in", "Consumed"]);
      times.forEach((time, index) => {
        rows.push([
          time,
          series.bat?.[index] ?? "",
          series.load?.[index] ?? "",
          series.solar?.[index] ?? "",
          series.feed_in?.[index] ?? "",
          series.consumed?.[index] ?? "",
        ]);
      });
    } else {
      rows.push([
        "Date",
        "SOC",
        "Solar Generation",
        "Load Consumption",
        "Battery Charged",
        "Battery Discharged",
        "Feed-in",
        "Grid Consumption",
        "PV to House",
        "PV to Battery",
        "Grid to Battery",
        `${periodLabel} Income`,
      ]);
      records.forEach((record) => {
        rows.push([
          record.record_date || "",
          record.live_soc ?? "",
          record.solar_generation_today ?? "",
          record.load_consumption_today ?? "",
          record.battery_charged_today ?? "",
          record.battery_discharged_today ?? "",
          record.feed_in_today ?? "",
          record.grid_consumption_today ?? "",
          record.pv_power_house ?? "",
          record.pv_charging_battery ?? "",
          record.grid_battery_charge ?? "",
          record.today_income ?? "",
        ]);
      });
    }

    return rows
      .map((row) => row.map((value) => this._csvSafe(value)).join(","))
      .join("\r\n");
  }

  _downloadCsv() {
    const periodContext = this._buildPeriodReporting(this._reporting());
    const reporting = periodContext.reporting;
    if (!reporting) return;
    const csv = this._buildCsv(reporting, periodContext);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = (reporting?.meta?.period_start && reporting?.meta?.period_end)
      ? `${reporting.meta.period_start}_to_${reporting.meta.period_end}`
      : (reporting?.power_diagram?.date || "day").replaceAll("/", "-");
    const label = (reporting?.label || "bytewatt").replaceAll(/[^a-zA-Z0-9_-]+/g, "_");
    link.href = url;
    link.download = `bytewatt-report-${label}-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  _renderSelector() {
    const selector = this._selectorState();
    const options = selector?.attributes?.options || [];
    const current = selector?.state || "";
    return `
      <div class="selector-row">
        <div class="label">Battery Selection</div>
        <select data-select-target>
          ${options
            .map(
              (option) =>
                `<option value="${this._escape(option)}" ${option === current ? "selected" : ""}>${this._escape(option)}</option>`
            )
            .join("")}
        </select>
      </div>
    `;
  }

  _renderReportControls(periodContext) {
    const period = periodContext?.period || this._reportPeriod || "day";
    const anchor = periodContext?.anchor || this._parseLocalDate(this._reportAnchorDate || "") || null;
    const status = this._periodStatus(periodContext?.records || [], this._historyLoading && !this._historyData, this._historyLoadError);
    const statusClass = this._historyLoading && !this._historyData ? "loading" : this._historyLoadError ? "error" : "loaded";
    const windowStart = periodContext?.window?.start || anchor;
    const displayDate = this._formatLocalDate(windowStart);
    const startLabel = periodContext?.window?.start ? this._formatDisplayDate(periodContext.window.start) : "";
    const endLabel = periodContext?.window?.end ? this._formatDisplayDate(periodContext.window.end) : "";
    return `
      <div class="report-controls">
        <div class="report-control-row">
          <div class="report-control-label">Period</div>
          <div class="report-period-group">
            ${this._reportPeriodButton("Today", "today", period)}
            ${this._reportPeriodButton("Day", "day", period)}
            ${this._reportPeriodButton("Week", "week", period)}
            ${this._reportPeriodButton("Month", "month", period)}
          </div>
        </div>
        <div class="report-control-row">
          <button class="report-shift-button" type="button" data-report-shift="-1" aria-label="Previous period">&lt;</button>
          <input class="report-date-input" type="date" data-report-date value="${this._escape(displayDate)}" />
          <button class="report-shift-button" type="button" data-report-shift="1" aria-label="Next period">&gt;</button>
          <div class="report-status ${statusClass}">
            ${this._escape(status)}
            ${startLabel && endLabel ? ` <span>(${this._escape(startLabel)} to ${this._escape(endLabel)})</span>` : ""}
          </div>
        </div>
      </div>
    `;
  }

  _reportPeriodButton(label, value, current) {
    return `
      <button
        class="report-period-button ${value === current ? "active" : ""}"
        type="button"
        data-report-period="${value}"
      >
        ${label}
      </button>
    `;
  }

  _renderAggregateStrip(reporting) {
    const summaries = this._systemSummaries();
    if (!summaries.length) return "";
    return `
      <div class="aggregate-strip">
        ${summaries
          .map(
            (item) => `
              <div class="aggregate-card">
                <div class="aggregate-title">${this._escape(item.label || item.sys_sn || "Battery")}</div>
                <div class="aggregate-metric">SOC ${this._fmtPercent(item.soc)}</div>
                <div class="aggregate-metric">Battery ${this._fmtPower(item.battery_power)}</div>
                <div class="aggregate-metric">Load ${this._fmtPower(item.house_consumption)}</div>
                <div class="aggregate-metric">Grid ${this._fmtPower(item.grid_power)}</div>
              </div>
            `
          )
          .join("")}
      </div>
    `;
  }

  _renderAggregateTable(reporting) {
    const summaries = this._systemSummaries();
    if (!summaries.length) return "";
    return `
      <section class="aggregate-table-panel">
        <div class="aggregate-table-head">
          <div class="aggregate-table-title">System Comparison</div>
          <div class="aggregate-table-subtitle">Live per-battery snapshot</div>
        </div>
        <div class="aggregate-table">
          <div class="aggregate-row aggregate-header">
            <div>Battery</div>
            <div>SOC</div>
            <div>Battery</div>
            <div>Load</div>
            <div>Grid</div>
            <div>Mode</div>
          </div>
          ${summaries
            .map(
              (item) => `
                <div class="aggregate-row">
                  <div class="aggregate-cell-title">${this._escape(item.label || item.sys_sn || "Battery")}</div>
                  <div>${this._fmtPercent(item.soc)}</div>
                  <div>${this._fmtPower(item.battery_power)}</div>
                  <div>${this._fmtPower(item.house_consumption)}</div>
                  <div>${this._fmtPower(item.grid_power)}</div>
                  <div>${this._escape(item.power_source || "Idle")}</div>
                </div>
              `
            )
            .join("")}
        </div>
      </section>
    `;
  }

  _renderHeroBanner(reporting) {
    const live = reporting?.live || {};
    const meta = this._selectionMeta();
    const history = this._selectorState()?.attributes?.history || {};
    const direction = this._batteryDirection(live.battery_power);
    const gridDirection = this._gridDirection(live.grid_power);
    const systemCount = this._systemSummaries().length;
    const scopeLabel = reporting?.aggregate
      ? `All systems${systemCount ? ` (${systemCount})` : ""}`
      : reporting?.label || meta.sys_sn || "Battery";
    return `
      <section class="hero-banner">
        <div class="hero-main">
          <div class="hero-kicker">At A Glance</div>
          <div class="hero-title">${this._escape(scopeLabel)}</div>
          <div class="hero-subtitle">${this._escape(live.power_source || "Idle")} | ${direction} | ${gridDirection}</div>
          ${
            history.enabled
              ? `<div class="hero-history">Local archive: ${this._escape(history.base_url || "")}</div>`
              : ""
          }
        </div>
        <div class="hero-metrics">
          ${this._heroChip("SOC", this._fmtPercent(live.soc))}
          ${this._heroChip("Battery", this._fmtPower(live.battery_power))}
          ${this._heroChip("Load", this._fmtPower(live.house_consumption))}
          ${this._heroChip("Grid", this._fmtPower(live.grid_power))}
        </div>
      </section>
    `;
  }

  _heroChip(label, value) {
    return `
      <div class="hero-chip">
        <div class="hero-chip-label">${label}</div>
        <div class="hero-chip-value">${value}</div>
      </div>
    `;
  }

  _renderOverviewBands(reporting) {
    const today = reporting?.today || {};
    const totals = reporting?.totals || {};
    const periodLabel = reporting?.meta?.period_label || "Day";
    const incomeLabel = `${periodLabel} Income`;
    return `
      <div class="overview-grid">
        <section class="overview-panel">
          <div class="overview-kicker">${this._escape(periodLabel)}</div>
          <div class="overview-metrics">
            ${this._metric("Home & Solar Consumed", this._fmtEnergy(today.load_consumption))}
            ${this._metric("Generation", this._fmtEnergy(today.solar_generation))}
            ${this._metric("Battery Charged", this._fmtEnergy(today.battery_charge))}
            ${this._metric("Battery Discharge", this._fmtEnergy(today.battery_discharge))}
            ${this._metric("Grid Feed-in", this._fmtEnergy(today.feed_in))}
            ${this._metric("Grid Consumed", this._fmtEnergy(today.grid_consumption))}
          </div>
        </section>
        <section class="overview-panel">
          <div class="overview-kicker">Total</div>
          <div class="overview-metrics">
            ${this._metric("Solar Generation", this._fmtEnergy(totals.solar_generation))}
            ${this._metric("House Consumption", this._fmtEnergy(totals.house_consumption))}
            ${this._metric("Battery Charge", this._fmtEnergy(totals.battery_charge))}
            ${this._metric("Battery Discharge", this._fmtEnergy(totals.battery_discharge))}
            ${this._metric("Feed-in", this._fmtEnergy(totals.feed_in))}
            ${this._metric("Grid Consumption", this._fmtEnergy(totals.grid_consumption))}
          </div>
        </section>
        <section class="overview-panel">
          <div class="overview-kicker">Economic</div>
          <div class="overview-metrics">
            ${this._metric("Self-Consumed", this._fmtPercent(today.self_consumption))}
            ${this._metric("Self-Sufficiency", this._fmtPercent(today.self_sufficiency))}
            ${this._metric(incomeLabel, this._fmtCurrency(today.today_income))}
            ${this._metric("Cumulative Income", this._fmtCurrency(today.total_income))}
          </div>
        </section>
        <section class="overview-panel">
          <div class="overview-kicker">Green</div>
          <div class="overview-metrics">
            ${this._metric("Trees Planted", this._fmtTrees(today.trees_planted))}
            ${this._metric("CO2 Reduction", this._fmtTons(today.co2_reduction_tons))}
            ${this._metric("PV to House", this._fmtEnergy(totals.pv_power_house))}
            ${this._metric("PV to Battery", this._fmtEnergy(totals.pv_charging_battery))}
            ${this._metric("Grid to Battery", this._fmtEnergy(totals.grid_battery_charge))}
          </div>
        </section>
      </div>
    `;
  }

  _metric(label, value) {
    return `
      <div class="metric">
        <div class="metric-label">${label}</div>
        <div class="metric-value">${value}</div>
      </div>
    `;
  }

  _renderSummaryTiles(reporting) {
    const today = reporting?.today || {};
    const periodLabel = reporting?.meta?.period_label || "Day";
    return `
      <div class="summary-grid">
        ${this._summaryTile(`${periodLabel} Generation`, this._fmtEnergy(today.solar_generation), "solar")}
        ${this._summaryTile(`${periodLabel} Consumption`, this._fmtEnergy(today.load_consumption), "load")}
        ${this._summaryTile("BAT SOC", this._fmtPercent(reporting?.live?.soc), "bat")}
        ${this._summaryTile(`${periodLabel} Feed-in`, this._fmtEnergy(today.feed_in), "feed")}
        ${this._summaryTile(`${periodLabel} Grid Consumption`, this._fmtEnergy(today.grid_consumption), "grid")}
      </div>
    `;
  }

  _summaryTile(label, value, kind) {
    return `
      <div class="summary-tile summary-${kind}">
        <div class="summary-label">${label}</div>
        <div class="summary-value">${value}</div>
      </div>
    `;
  }

  _renderLiveStrip(reporting) {
    const live = reporting?.live || {};
    const powerSource = live.power_source || "Idle";
    return `
      <div class="live-grid">
        ${this._liveTile("Solar", this._fmtPower(live.pv_power), "solar")}
        ${this._liveTile("Battery", this._fmtPower(live.battery_power), "battery")}
        ${this._liveTile("Load", this._fmtPower(live.house_consumption), "load")}
        ${this._liveTile("Grid", this._fmtPower(live.grid_power), "grid")}
        ${this._liveTile("Mode", this._escape(powerSource), "mode")}
      </div>
    `;
  }

  _liveTile(label, value, kind = "") {
    return `
      <div class="live-tile ${kind ? `live-${kind}` : ""}">
        <div class="live-label">${label}</div>
        <div class="live-value">${value}</div>
      </div>
    `;
  }

  _renderEnergyDiagram(reporting) {
    const today = reporting?.today || {};
    return `
      <section class="panel">
        <div class="panel-header">
          <div class="panel-title">Energy Diagram</div>
          <div class="panel-date">${this._escape(reporting?.power_diagram?.date || "")}</div>
        </div>
        <div class="energy-layout">
          <div class="energy-node">
            <div class="energy-node-title">Solar</div>
            <div class="energy-node-value">${this._fmtEnergy(today.solar_generation)}</div>
          </div>
          <div class="energy-node battery">
            <div class="energy-node-title">Battery</div>
            <div class="energy-node-value">${this._fmtPercent(reporting?.live?.soc)}</div>
            <div class="energy-node-sub">Charged ${this._fmtEnergy(today.battery_charge)}</div>
            <div class="energy-node-sub">Discharge ${this._fmtEnergy(today.battery_discharge)}</div>
          </div>
          <div class="energy-node">
            <div class="energy-node-title">Grid</div>
            <div class="energy-node-value">${this._fmtEnergy(today.grid_consumption)}</div>
          </div>
          <div class="energy-node">
            <div class="energy-node-title">Load</div>
            <div class="energy-node-value">${this._fmtEnergy(today.load_consumption)}</div>
          </div>
          <div class="energy-bridge solar-battery">Charge ${this._fmtEnergy(today.battery_charge)}</div>
          <div class="energy-bridge battery-load">Use ${this._fmtEnergy(today.battery_discharge)}</div>
          <div class="energy-bridge solar-grid">Feed-in ${this._fmtEnergy(today.feed_in)}</div>
          <div class="energy-bridge grid-load">Consumed ${this._fmtEnergy(today.grid_consumption)}</div>
        </div>
      </section>
    `;
  }

  _renderSankeyPanel(reporting) {
    const today = reporting?.today || {};
    const totals = reporting?.totals || {};
    const solar = Number(today.solar_generation) || 0;
    const load = Number(today.load_consumption) || 0;
    const grid = Number(today.grid_consumption) || 0;
    const feedIn = Number(today.feed_in) || 0;
    const batteryCharge = Number(today.battery_charge) || 0;
    const batteryDischarge = Number(today.battery_discharge) || 0;
    const pvToHouse =
      Number(today.pv_power_house) ||
      Number(totals.pv_power_house) ||
      Math.max(load - grid - batteryDischarge, 0);
    const pvToBattery =
      Number(today.pv_charging_battery) ||
      Number(totals.pv_charging_battery) ||
      Math.max(batteryCharge - grid, 0);
    const gridToBattery =
      Number(today.grid_battery_charge) ||
      Number(totals.grid_battery_charge) ||
      0;
    const sourceTotal = Math.max(solar + batteryDischarge + grid, 1);
    const sinkTotal = Math.max(load + batteryCharge + feedIn, 1);
    const flowScale = Math.max(solar, load, grid, feedIn, batteryCharge, batteryDischarge, pvToHouse, pvToBattery, gridToBattery, 1);
    const thickness = (value) => {
      const ratio = Math.max(value, 0) / Math.max(flowScale, 1);
      return Math.max(8, Math.round(Math.sqrt(ratio) * 48));
    };
    const curve = (x1, y1, x2, y2) => `M ${x1} ${y1} C ${x1 + 140} ${y1}, ${x2 - 140} ${y2}, ${x2} ${y2}`;
    const pct = (value, total) => `${Math.max(0, Math.round((Math.max(value, 0) / Math.max(total, 1)) * 1000) / 10).toFixed(1)}%`;

    const cards = {
      solar: { x: 18, y: 24, w: 176, h: 190, accent: "var(--bw-solar)", title: "SOLAR", value: this._fmtEnergy(solar), sub: pct(solar, sourceTotal), meta: "Produced" },
      batteryOut: { x: 18, y: 228, w: 176, h: 128, accent: "var(--bw-battery)", title: "BATTERY", value: this._fmtEnergy(batteryDischarge), sub: pct(batteryDischarge, sourceTotal), meta: "Discharged" },
      grid: { x: 18, y: 370, w: 176, h: 118, accent: "var(--bw-grid)", title: "GRID", value: this._fmtEnergy(grid), sub: pct(grid, sourceTotal), meta: "Imported" },
      batteryIn: { x: 746, y: 24, w: 176, h: 128, accent: "var(--bw-battery)", title: "BATTERY", value: this._fmtEnergy(batteryCharge), sub: pct(batteryCharge, sinkTotal), meta: "Charged" },
      load: { x: 746, y: 166, w: 176, h: 190, accent: "var(--bw-load)", title: "LOAD", value: this._fmtEnergy(load), sub: pct(load, sinkTotal), meta: "Consumed" },
      feed: { x: 746, y: 370, w: 176, h: 118, accent: "var(--bw-feed)", title: "GRID", value: this._fmtEnergy(feedIn), sub: pct(feedIn, sinkTotal), meta: "Feed-in" },
    };

    const cardHtml = (card) => `
      <g class="sankey-node-group" transform="translate(${card.x}, ${card.y})">
        <rect width="${card.w}" height="${card.h}" rx="16" ry="16" fill="rgba(255,255,255,0.92)" stroke="${card.accent}" stroke-width="2"></rect>
        <rect x="0" y="0" width="${card.w}" height="6" rx="16" ry="16" fill="${card.accent}" opacity="0.92"></rect>
        <rect x="10" y="12" width="92" height="28" rx="10" ry="10" fill="rgba(255,255,255,0.80)" stroke="rgba(15,23,42,0.05)" stroke-width="1"></rect>
        <text x="56" y="31" text-anchor="middle" class="sankey-chip">${this._escape(card.title)}</text>
        <text x="16" y="74" class="sankey-node-value">${this._escape(card.value)}</text>
        <text x="16" y="108" class="sankey-node-unit">kWh</text>
        <text x="16" y="${card.h - 18}" class="sankey-node-sub">${this._escape(card.sub)}</text>
        <text x="16" y="${card.h - 4}" class="sankey-node-meta">${this._escape(card.meta)}</text>
      </g>
    `;

    const pathHtml = (source, target, value, sourceY, targetY, gradientId) => {
      if (!(value > 0)) return "";
      const startX = cards[source].x + cards[source].w;
      const endX = cards[target].x;
      const startY = cards[source].y + sourceY;
      const endY = cards[target].y + targetY;
      return `
        <path class="sankey-link" d="${curve(startX, startY, endX, endY)}" stroke="url(#${gradientId})" stroke-width="${thickness(value)}" opacity="0.92"></path>
      `;
    };

    const defs = `
      <defs>
        <linearGradient id="sankey-solar-load" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#f0c419" stop-opacity="0.95"></stop>
          <stop offset="100%" stop-color="#2f9be8" stop-opacity="0.72"></stop>
        </linearGradient>
        <linearGradient id="sankey-solar-battery" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#f0c419" stop-opacity="0.88"></stop>
          <stop offset="100%" stop-color="#2fc96e" stop-opacity="0.86"></stop>
        </linearGradient>
        <linearGradient id="sankey-solar-feed" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#f0c419" stop-opacity="0.88"></stop>
          <stop offset="100%" stop-color="#f08a24" stop-opacity="0.86"></stop>
        </linearGradient>
        <linearGradient id="sankey-grid-battery" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#98a2a8" stop-opacity="0.84"></stop>
          <stop offset="100%" stop-color="#2fc96e" stop-opacity="0.84"></stop>
        </linearGradient>
        <linearGradient id="sankey-battery-load" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#2fc96e" stop-opacity="0.92"></stop>
          <stop offset="100%" stop-color="#2f9be8" stop-opacity="0.92"></stop>
        </linearGradient>
      </defs>
    `;

    const periodRecords = Number(reporting?.records?.length) || 0;
    const periodLabel = reporting?.meta?.period_label || "Day";
    const periodRange =
      reporting?.meta?.period_start && reporting?.meta?.period_end
        ? `${reporting.meta.period_start} -> ${reporting.meta.period_end}`
        : reporting?.power_diagram?.date || "";
    const summaryCards = [
      ["Solar -> Load", this._fmtEnergy(pvToHouse), "solar"],
      ["Solar -> Battery", this._fmtEnergy(pvToBattery), "battery"],
      ["Solar -> Feed-in", this._fmtEnergy(feedIn), "feed"],
      ["Grid -> Battery", this._fmtEnergy(gridToBattery), "grid"],
      ["Battery -> Load", this._fmtEnergy(batteryDischarge), "load"],
    ];

    return `
      <section class="panel sankey-panel">
        <div class="panel-header">
          <div class="panel-title">Energy Flow Sankey</div>
          <div class="panel-date">${this._escape(periodLabel)}${periodRange ? ` â€¢ ${this._escape(periodRange)}` : ""}${periodRecords ? ` â€¢ ${periodRecords} records` : ""}</div>
        </div>
        <div class="sankey-stage">
          <svg class="sankey-svg" viewBox="0 0 940 520" preserveAspectRatio="xMidYMid meet" role="img" aria-label="ByteWatt energy Sankey diagram">
            <defs>
              <filter id="sankeyShadow" x="-10%" y="-10%" width="120%" height="120%">
                <feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#0f172a" flood-opacity="0.08"></feDropShadow>
              </filter>
            </defs>
            ${defs}
            <g class="sankey-links">
              ${pathHtml("solar", "load", pvToHouse, 98, 88, "sankey-solar-load")}
              ${pathHtml("solar", "batteryIn", pvToBattery, 132, 54, "sankey-solar-battery")}
              ${pathHtml("solar", "feed", feedIn, 156, 42, "sankey-solar-feed")}
              ${pathHtml("grid", "batteryIn", gridToBattery, 50, 80, "sankey-grid-battery")}
              ${pathHtml("batteryOut", "load", batteryDischarge, 62, 138, "sankey-battery-load")}
            </g>
            ${cardHtml(cards.solar)}
            ${cardHtml(cards.batteryOut)}
            ${cardHtml(cards.grid)}
            ${cardHtml(cards.batteryIn)}
            ${cardHtml(cards.load)}
            ${cardHtml(cards.feed)}
          </svg>
          <div class="sankey-mobile">
            <div class="sankey-mobile-card sankey-mobile-source solar">
              <div class="sankey-mobile-label">Solar</div>
              <div class="sankey-mobile-value">${this._fmtEnergy(solar)}</div>
              <div class="sankey-mobile-sub">${pct(solar, sourceTotal)} produced</div>
            </div>
            <div class="sankey-mobile-card sankey-mobile-source battery">
              <div class="sankey-mobile-label">Battery</div>
              <div class="sankey-mobile-value">${this._fmtEnergy(batteryDischarge)}</div>
              <div class="sankey-mobile-sub">${pct(batteryDischarge, sourceTotal)} discharged</div>
            </div>
            <div class="sankey-mobile-card sankey-mobile-source grid">
              <div class="sankey-mobile-label">Grid</div>
              <div class="sankey-mobile-value">${this._fmtEnergy(grid)}</div>
              <div class="sankey-mobile-sub">${pct(grid, sourceTotal)} imported</div>
            </div>
            <div class="sankey-mobile-flow sankey-mobile-flow-solar-load">
              <span>Solar â†’ Load</span><strong>${this._fmtEnergy(pvToHouse)}</strong>
            </div>
            <div class="sankey-mobile-flow sankey-mobile-flow-solar-battery">
              <span>Solar â†’ Battery</span><strong>${this._fmtEnergy(pvToBattery)}</strong>
            </div>
            <div class="sankey-mobile-flow sankey-mobile-flow-grid-battery">
              <span>Grid â†’ Battery</span><strong>${this._fmtEnergy(gridToBattery)}</strong>
            </div>
            <div class="sankey-mobile-flow sankey-mobile-flow-battery-load">
              <span>Battery â†’ Load</span><strong>${this._fmtEnergy(batteryDischarge)}</strong>
            </div>
            <div class="sankey-mobile-flow sankey-mobile-flow-feed">
              <span>Solar â†’ Feed-in</span><strong>${this._fmtEnergy(feedIn)}</strong>
            </div>
          </div>
        </div>
        <div class="sankey-summary-grid">
          ${summaryCards
            .map(
              ([label, value, kind]) => `
                <div class="sankey-summary sankey-summary-kind-${kind}">
                  <div class="sankey-summary-label">${label}</div>
                  <div class="sankey-summary-value">${value}</div>
                </div>
              `
            )
            .join("")}
        </div>
      </section>
    `;
  }

  _renderRealtimePanel(reporting) {
    const live = reporting?.live || {};
    const batteryDirection = this._batteryDirection(live.battery_power);
    const gridDirection = this._gridDirection(live.grid_power);
    return `
      <section class="panel">
        <div class="panel-header">
          <div class="panel-title">Real-time Flow</div>
          <div class="panel-date">${this._escape(live.power_source || "Idle")}</div>
        </div>
        <div class="flow-grid">
          <div class="flow-card flow-solar">
            <div class="flow-title">Solar</div>
            <div class="flow-value">${this._fmtPower(live.pv_power)}</div>
          </div>
          <div class="flow-card flow-battery">
            <div class="flow-title">Battery</div>
            <div class="flow-value">${this._fmtPower(live.battery_power)}</div>
            <div class="flow-sub">${batteryDirection}</div>
            <div class="flow-chip">SOC ${this._fmtPercent(live.soc)}</div>
          </div>
          <div class="flow-card flow-grid-node">
            <div class="flow-title">Grid</div>
            <div class="flow-value">${this._fmtPower(live.grid_power)}</div>
            <div class="flow-sub">${gridDirection}</div>
          </div>
          <div class="flow-card flow-load">
            <div class="flow-title">Load</div>
            <div class="flow-value">${this._fmtPower(live.house_consumption)}</div>
          </div>
        </div>
      </section>
    `;
  }

  _renderDetailsPanel(reporting) {
    const meta = this._selectionMeta();
    const totals = reporting?.totals || {};
    const diagMeta = reporting?.power_diagram?.meta || {};
    return `
      <section class="panel">
        <div class="panel-header">
          <div class="panel-title">Selected System</div>
          <div class="panel-date">${this._escape(reporting?.label || "Battery")}</div>
        </div>
        <div class="detail-grid">
          ${this._detailCell("Scope", this._escape(reporting?.aggregate ? "All systems" : "Individual battery"))}
          ${this._detailCell("Serial", this._escape(meta.sys_sn || "All"))}
          ${this._detailCell("System ID", this._escape(meta.system_id || "Aggregate"))}
          ${this._detailCell("Remark", this._escape(meta.remark || "Not provided"))}
          ${this._detailCell("Mode", this._escape(reporting?.live?.power_source || "Unavailable"))}
          ${this._detailCell("Maximum Power", this._fmtPower(diagMeta.maximum_power))}
          ${this._detailCell("PV to House", this._fmtEnergy(totals.pv_power_house))}
          ${this._detailCell("PV to Battery", this._fmtEnergy(totals.pv_charging_battery))}
          ${this._detailCell("Grid to Battery", this._fmtEnergy(totals.grid_battery_charge))}
        </div>
      </section>
    `;
  }

  _detailCell(label, value) {
    return `
      <div class="detail-cell">
        <div class="detail-label">${label}</div>
        <div class="detail-value">${value}</div>
      </div>
    `;
  }

  _renderChart(reporting) {
    const powerDiagram = reporting?.power_diagram || {};
    const periodLabel = reporting?.meta?.period_label || "Day";
    const series = powerDiagram.series || {};
    const times = powerDiagram.time || [];
    const activeKeys = Object.entries(this._activeSeries)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key);
    const powerKeys = activeKeys.filter((key) => key !== "bat");
    const allPowerValues = powerKeys.flatMap((key) => (series[key] || []).map((value) => Number(value) || 0));
    const powerMax = Math.max(...allPowerValues, 1);
    const width = 900;
    const height = 280;
    const plotWidth = 760;
    const plotHeight = 190;
    const left = 64;
    const top = 28;
    const bottom = top + plotHeight;
    const right = left + plotWidth;

    const area = (values, maxValue, fill, stroke) => {
      if (!values.length) return "";
      const points = values
        .map((value, index) => {
          const x = left + (plotWidth * index) / Math.max(values.length - 1, 1);
          const y = bottom - ((Number(value) || 0) / Math.max(maxValue, 1)) * plotHeight;
          return `${x},${y}`;
        })
        .join(" ");
      const start = `${left},${bottom}`;
      const end = `${right},${bottom}`;
      return `<polygon points="${start} ${points} ${end}" fill="${fill}" stroke="${stroke}" stroke-width="2" fill-opacity="0.28"></polygon>`;
    };

    const line = (values, maxValue, stroke) => {
      if (!values.length) return "";
      const points = values
        .map((value, index) => {
          const x = left + (plotWidth * index) / Math.max(values.length - 1, 1);
          const y = bottom - ((Number(value) || 0) / Math.max(maxValue, 1)) * plotHeight;
          return `${x},${y}`;
        })
        .join(" ");
      return `<polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"></polyline>`;
    };

    const palette = {
      bat: ["rgba(47, 201, 110, 0.28)", "#2fc96e"],
      load: ["rgba(47, 155, 232, 0.28)", "#2f9be8"],
      solar: ["rgba(240, 196, 25, 0.30)", "#f0c419"],
      feed_in: ["rgba(240, 138, 36, 0.28)", "#f08a24"],
      consumed: ["rgba(152, 162, 168, 0.24)", "#98a2a8"],
    };

    const xTicks = [0, 0.17, 0.34, 0.51, 0.68, 0.85, 1];
    const tickLabels = xTicks.map(
      (point) => times[Math.min(times.length - 1, Math.max(0, Math.round(point * (times.length - 1))))] || ""
    );
    const powerSummary = powerDiagram.summary || {};

    return `
      <section class="panel">
        <div class="panel-header chart-header">
          <div class="panel-tabs">
            <button class="${this._view === "power" ? "active" : ""}" data-view="power">Power Diagram</button>
            <button class="${this._view === "statistical" ? "active" : ""}" data-view="statistical">Statistical Diagram</button>
          </div>
          <div class="chart-tools">
            <div class="panel-date">${this._escape(periodLabel)}${powerDiagram.date ? ` â€¢ ${this._escape(powerDiagram.date)}` : ""}${powerDiagram.time?.length ? ` â€¢ ${powerDiagram.time.length} points` : ""}</div>
            <button class="download-btn" data-download-report>Download CSV</button>
          </div>
        </div>
        ${
          this._view === "power"
            ? `
          <div class="ring-grid">
            ${this._ring(`${periodLabel} Generation`, this._fmtEnergy(powerSummary.solar_generation), "solar")}
            ${this._ring(`${periodLabel} Consumption`, this._fmtEnergy(powerSummary.load_consumption), "load")}
            ${this._ring("BAT SOC", this._fmtPercent(powerSummary.soc), "bat")}
            ${this._ring(`${periodLabel} Feed-in`, this._fmtEnergy(powerSummary.feed_in), "feed")}
            ${this._ring(`${periodLabel} Grid Consumption`, this._fmtEnergy(powerSummary.grid_consumption), "grid")}
          </div>
          <svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="ByteWatt power diagram chart">
            <line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" class="axis"></line>
            <line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" class="axis"></line>
            ${[0, 0.25, 0.5, 0.75, 1]
              .map((point) => {
                const y = bottom - point * plotHeight;
                return `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" class="grid"></line>`;
              })
              .join("")}
            ${activeKeys
              .map((key) => {
                const values = series[key] || [];
                if (key === "bat") {
                  return `${area(values, 100, palette[key][0], palette[key][1])}${line(values, 100, palette[key][1])}`;
                }
                return `${area(values, powerMax, palette[key][0], palette[key][1])}${line(values, powerMax, palette[key][1])}`;
              })
              .join("")}
            ${tickLabels
              .map((label, index) => {
                const x = left + plotWidth * xTicks[index];
                return `<text x="${x}" y="${bottom + 24}" class="tick" text-anchor="middle">${this._escape(label)}</text>`;
              })
              .join("")}
            <text x="16" y="${top + 18}" class="axis-label">POWER</text>
            <text x="${right + 24}" y="${top + 18}" class="axis-label">BAT</text>
          </svg>
          <div class="legend-row">
            ${this._legendButton("BAT", "bat")}
            ${this._legendButton("Load", "load")}
            ${this._legendButton("Solar", "solar")}
            ${this._legendButton("Feed-in", "feed_in")}
            ${this._legendButton("Consumed", "consumed")}
          </div>
        `
            : this._renderStatsDiagram(reporting)
        }
      </section>
    `;
  }

  _renderStatsDiagram(reporting) {
    const today = reporting?.today || {};
    const rows = [
      { label: "Solar Generation", value: Number(today.solar_generation) || 0, display: this._fmtEnergy(today.solar_generation), tone: "solar" },
      { label: "Load Consumption", value: Number(today.load_consumption) || 0, display: this._fmtEnergy(today.load_consumption), tone: "load" },
      { label: "Battery Charged", value: Number(today.battery_charge) || 0, display: this._fmtEnergy(today.battery_charge), tone: "battery" },
      { label: "Battery Discharge", value: Number(today.battery_discharge) || 0, display: this._fmtEnergy(today.battery_discharge), tone: "battery" },
      { label: "Feed-in", value: Number(today.feed_in) || 0, display: this._fmtEnergy(today.feed_in), tone: "feed" },
      { label: "Grid Consumption", value: Number(today.grid_consumption) || 0, display: this._fmtEnergy(today.grid_consumption), tone: "grid" },
      { label: "Self Consumption", value: Number(today.self_consumption) || 0, display: this._fmtPercent(today.self_consumption), tone: "info", scaleLabel: "%" },
      { label: "Self Sufficiency", value: Number(today.self_sufficiency) || 0, display: this._fmtPercent(today.self_sufficiency), tone: "info", scaleLabel: "%" },
    ];
    const maxValue = Math.max(...rows.map((row) => row.value), 1);
    return `
      <div class="stats-diagram">
        ${rows.map((row) => this._statsBar(row, maxValue)).join("")}
      </div>
    `;
  }

  _statsBar(row, maxValue) {
    const width = `${Math.max((row.value / maxValue) * 100, row.value > 0 ? 6 : 0)}%`;
    return `
      <div class="stats-row">
        <div class="stats-row-head">
          <div class="stats-row-label">${row.label}</div>
          <div class="stats-row-value">${row.display}</div>
        </div>
        <div class="stats-bar-track">
          <div class="stats-bar-fill tone-${row.tone}" style="width:${width}"></div>
        </div>
      </div>
    `;
  }

  _ring(label, value, kind) {
    return `
      <div class="ring-card ring-${kind}">
        <div class="ring-value">${value}</div>
        <div class="ring-label">${label}</div>
      </div>
    `;
  }

  _legendButton(label, key) {
    return `
      <button class="legend-chip ${this._activeSeries[key] ? "active" : ""}" data-series="${key}">
        ${label}
      </button>
    `;
  }

  _statCard(label, value) {
    return `
      <div class="stat-card">
        <div class="stat-label">${label}</div>
        <div class="stat-value">${value}</div>
      </div>
    `;
  }

  render() {
    if (!this._hass || !this._config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const baseReporting = this._reporting();
    const periodContext = this._buildPeriodReporting(baseReporting);
    const reporting = periodContext.reporting;
    const historyKey = [
      this._historyUrl(),
      this._historyScopeKey(),
      baseReporting?.meta?.saved_at || baseReporting?.power_diagram?.date || "",
    ].join("|");
    if (historyKey !== this._historySourceKey) {
      this._historySourceKey = historyKey;
      this._historyData = null;
      this._historyLoadError = "";
      this._historyAttempted = false;
    }
    if (this._historyMeta().enabled && !this._historyData && !this._historyLoading) {
      this._ensureHistoryLoaded();
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display:block;
          width:100%;
          --bw-solar:#f0c419;
          --bw-load:#2f9be8;
          --bw-battery:#2fc96e;
          --bw-feed:#f08a24;
          --bw-grid:#98a2a8;
          --bw-surface:#f4f5f7;
          --bw-surface-2:#ffffff;
          --bw-border:#d6dbe1;
          --bw-text:#17212f;
          --bw-muted:#6b7280;
        }
        ha-card {
          background: linear-gradient(180deg, #fafafa 0%, #f0f0f0 100%);
          border-radius: 24px;
          border: 1px solid var(--bw-border);
          color: var(--bw-text);
          box-shadow: 0 18px 36px rgba(15, 23, 42, 0.08);
          overflow: hidden;
        }
        .shell { display:grid; gap:18px; padding:20px; }
        .title-row { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
        .title-icon {
          width:34px; height:34px; border-radius:12px; display:flex; align-items:center; justify-content:center;
          background:linear-gradient(180deg, #5ab4ff, #2f9be8); color:#fff; font-weight:800;
          box-shadow:0 10px 20px rgba(47,155,232,0.18);
        }
        .title { font-size:1.4rem; font-weight:800; color:#0f172a; }
        .version-badge {
          display:inline-flex; align-items:center; justify-content:center; padding:4px 8px;
          border-radius:999px; background:#eef1f4; color:#4b5563; font-size:0.78rem; font-weight:800;
          border:1px solid #d7dce2;
        }
        .cache-button {
          display:inline-flex;
          align-items:center;
          justify-content:center;
          padding:5px 10px;
          border-radius:999px;
          border:1px solid #cfd6de;
          background:#fff;
          color:#475569;
          font-size:0.76rem;
          font-weight:800;
          cursor:pointer;
        }
        .cache-button:hover {
          filter:brightness(0.98);
        }
        .cache-button:active {
          transform:translateY(1px);
        }
        .selector-row {
          display:grid; grid-template-columns: 160px minmax(0, 1fr); gap:16px; align-items:center;
        }
        .report-controls {
          display:grid;
          gap:10px;
          margin-top:4px;
        }
        .report-control-row {
          display:flex;
          flex-wrap:wrap;
          gap:10px;
          align-items:center;
        }
        .report-control-label {
          font-size:0.84rem;
          font-weight:800;
          color:#4d6787;
          text-transform:uppercase;
          letter-spacing:0.05em;
        }
        .report-period-group {
          display:flex;
          gap:8px;
          flex-wrap:wrap;
        }
        .report-period-button,
        .report-shift-button,
        .report-date-input {
          border:1px solid rgba(51, 92, 140, 0.18);
          border-radius:14px;
          background:#fff;
          color:#17263a;
          font-weight:800;
        }
        .report-period-button,
        .report-shift-button {
          padding:8px 14px;
          cursor:pointer;
        }
        .report-period-button.active {
          background:#2f75d8;
          color:#fff;
          border-color:#2f75d8;
          box-shadow:0 8px 18px rgba(47,117,216,0.18);
        }
        .report-shift-button {
          min-width:42px;
        }
        .report-date-input {
          min-width: 170px;
          padding:8px 12px;
        }
        .report-status {
          display:inline-flex;
          align-items:center;
          gap:8px;
          padding:7px 12px;
          border-radius:999px;
          background:#eef4fb;
          border:1px solid rgba(51, 92, 140, 0.12);
          color:#355377;
          font-size:0.84rem;
          font-weight:800;
        }
        .report-status.loading {
          background:#fff4de;
          border-color:rgba(239, 169, 61, 0.28);
          color:#9a651d;
        }
        .report-status.loaded {
          background:#e8f7ee;
          border-color:rgba(74, 167, 98, 0.24);
          color:#2e7d46;
        }
        .report-status.error {
          background:#fdecec;
          border-color:rgba(198, 82, 82, 0.22);
          color:#a04646;
        }
        .label { font-size:0.95rem; font-weight:700; color:#31435d; }
        select {
          width:min(360px, 100%);
          padding:12px 14px;
          border-radius:14px;
          border:1px solid var(--bw-border);
          background:#fff;
          color:var(--bw-text);
          font-size:0.95rem;
        }
        .aggregate-strip {
          display:grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap:12px;
        }
        .aggregate-card,
        .summary-tile,
        .live-tile,
        .stat-card,
        .overview-panel,
        .hero-banner {
          background:var(--bw-surface-2);
          border-radius:18px;
          border:1px solid var(--bw-border);
          padding:16px 18px;
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.05);
        }
        .hero-banner {
          display:grid;
          grid-template-columns: 1.1fr 1fr;
          gap:16px;
          align-items:center;
          background:
            linear-gradient(135deg, rgba(47,117,216,0.06), rgba(116,178,255,0.02)),
            #fff;
        }
        .hero-main {
          display:grid;
          gap:8px;
        }
        .hero-kicker {
          font-size:0.76rem;
          font-weight:800;
          letter-spacing:0.08em;
          text-transform:uppercase;
          color:#4b5563;
        }
        .hero-title {
          font-size:1.35rem;
          font-weight:900;
          color:#0f172a;
        }
        .hero-subtitle {
          color:#475569;
          font-size:0.96rem;
          font-weight:700;
        }
        .hero-history {
          margin-top:6px;
          color:#2f9be8;
          font-size:0.8rem;
          font-weight:700;
          word-break:break-all;
        }
        .history-panel {
          background:#fff;
          border-radius:18px;
          border:1px solid var(--bw-border);
          padding:16px 18px;
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.05);
          display:grid;
          gap:14px;
        }
        .history-controls {
          display:flex;
          flex-wrap:wrap;
          gap:10px;
        }
        .history-pill {
          border:none;
          border-radius:999px;
          padding:8px 14px;
          font-weight:800;
          cursor:pointer;
          background:#eef1f4;
          color:#475569;
        }
        .history-pill.active {
          background:#111827;
          color:#fff;
        }
        .history-summary {
          display:grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap:12px;
        }
        .hero-metrics {
          display:grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap:12px;
        }
        .hero-chip {
          background:#f8fafc;
          border:1px solid var(--bw-border);
          border-radius:14px;
          padding:12px 14px;
          display:grid;
          gap:4px;
        }
        .hero-chip-label {
          font-size:0.72rem;
          font-weight:800;
          letter-spacing:0.05em;
          text-transform:uppercase;
          color:#64748b;
        }
        .hero-chip-value {
          font-size:1rem;
          font-weight:900;
          color:#0f172a;
        }
        .aggregate-table-panel {
          background:#fff;
          border-radius:18px;
          border:1px solid var(--bw-border);
          padding:16px 18px;
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.05);
          display:grid;
          gap:14px;
        }
        .aggregate-table-head {
          display:flex;
          align-items:end;
          justify-content:space-between;
          gap:12px;
          flex-wrap:wrap;
        }
        .aggregate-table-title {
          font-size:1rem;
          font-weight:900;
          color:#0f172a;
        }
        .aggregate-table-subtitle {
          font-size:0.84rem;
          color:#64748b;
          font-weight:700;
        }
        .aggregate-table {
          display:grid;
          gap:8px;
        }
        .aggregate-row {
          display:grid;
          grid-template-columns: minmax(160px, 1.4fr) repeat(5, minmax(0, 1fr));
          gap:10px;
          align-items:center;
          padding:12px 14px;
          border-radius:14px;
          background:#f8fafc;
          border:1px solid #e2e8f0;
          color:#22354d;
          font-size:0.92rem;
          font-weight:700;
        }
        .aggregate-header {
          background:#eef2f7;
          color:#516075;
          font-size:0.78rem;
          letter-spacing:0.05em;
          text-transform:uppercase;
        }
        .aggregate-cell-title {
          font-weight:900;
          color:#0f172a;
        }
        .aggregate-title,
        .summary-label,
        .live-label,
        .stat-label,
        .overview-kicker,
        .metric-label {
          font-size:0.82rem;
          font-weight:700;
          letter-spacing:0.04em;
          text-transform:uppercase;
          color:#64748b;
        }
        .aggregate-metric {
          margin-top:6px;
          color:#334155;
          font-size:0.9rem;
        }
        .overview-grid {
          display:grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap:14px;
        }
        .overview-panel {
          display:grid;
          gap:14px;
          align-content:start;
        }
        .overview-metrics {
          display:grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap:12px;
        }
        .metric {
          display:grid;
          gap:6px;
          padding-top:2px;
        }
        .metric-value,
        .summary-value,
        .live-value,
        .stat-value {
          font-size:1.2rem;
          font-weight:800;
          color:#0f172a;
        }
        .summary-tile,
        .live-tile {
          position:relative;
          overflow:hidden;
        }
        .summary-tile::before,
        .live-tile::before {
          content:"";
          position:absolute;
          left:0;
          top:0;
          width:100%;
          height:4px;
          background:var(--bw-border);
        }
        .summary-label,
        .live-label {
          color:#516075;
        }
        .summary-solar::before,
        .live-solar::before { background:var(--bw-solar); }
        .summary-load::before,
        .live-load::before { background:var(--bw-load); }
        .summary-bat::before,
        .live-battery::before { background:var(--bw-battery); }
        .summary-feed::before,
        .live-feed::before { background:var(--bw-feed); }
        .summary-grid::before,
        .live-grid::before { background:var(--bw-grid); }
        .summary-solar .summary-value,
        .summary-solar .summary-label,
        .live-solar .live-value,
        .live-solar .live-label { color:#9a7b00; }
        .summary-load .summary-value,
        .summary-load .summary-label,
        .live-load .live-value,
        .live-load .live-label { color:#1f6ea6; }
        .summary-bat .summary-value,
        .summary-bat .summary-label,
        .live-battery .live-value,
        .live-battery .live-label { color:#208f52; }
        .summary-feed .summary-value,
        .summary-feed .summary-label,
        .live-feed .live-value,
        .live-feed .live-label { color:#b25f11; }
        .summary-grid .summary-value,
        .summary-grid .summary-label,
        .live-grid .live-value,
        .live-grid .live-label { color:#65727a; }
        .summary-grid,
        .live-grid,
        .stats-grid {
          display:grid;
          gap:14px;
        }
        .summary-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
        .live-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
        .stats-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .body-grid {
          display:grid;
          grid-template-columns: 0.95fr 1.05fr;
          gap:18px;
          align-items:start;
        }
        .stack-grid {
          display:grid;
          gap:18px;
        }
        .panel {
          background:#fff;
          border-radius:22px;
          border:1px solid var(--bw-border);
          padding:18px;
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.05);
        }
        .panel-header {
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          margin-bottom:14px;
        }
        .panel-title {
          font-size:1.1rem;
          font-weight:800;
          color:#0f172a;
        }
        .panel-date {
          padding:8px 12px;
          border-radius:999px;
          background:#eef1f4;
          color:#475569;
          font-size:0.9rem;
          font-weight:700;
        }
        .detail-grid {
          display:grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap:12px;
        }
        .detail-cell {
          background:#f8fafc;
          border:1px solid #e2e8f0;
          border-radius:16px;
          padding:14px 16px;
          display:grid;
          gap:6px;
        }
        .detail-label {
          font-size:0.76rem;
          font-weight:700;
          letter-spacing:0.04em;
          text-transform:uppercase;
          color:#64748b;
        }
        .detail-value {
          font-size:1rem;
          font-weight:800;
          color:#0f172a;
          word-break:break-word;
        }
        .flow-grid {
          display:grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap:14px;
        }
        .flow-card {
          background:#f8fafc;
          border:1px solid #e2e8f0;
          border-radius:18px;
          padding:16px;
          display:grid;
          gap:6px;
          min-height:116px;
          align-content:start;
        }
        .flow-title {
          font-size:0.82rem;
          font-weight:700;
          letter-spacing:0.04em;
          text-transform:uppercase;
          color:#64748b;
        }
        .flow-value {
          font-size:1.35rem;
          font-weight:800;
          color:#0f172a;
        }
        .flow-sub {
          color:#475569;
          font-size:0.92rem;
          font-weight:700;
        }
        .flow-chip {
          width:max-content;
          padding:5px 10px;
          border-radius:999px;
          background:#eef1f4;
          color:#475569;
          font-size:0.82rem;
          font-weight:800;
        }
        .flow-solar { box-shadow: inset 0 3px 0 0 var(--bw-solar); }
        .flow-battery { box-shadow: inset 0 3px 0 0 var(--bw-battery); }
        .flow-grid-node { box-shadow: inset 0 3px 0 0 var(--bw-grid); }
        .flow-load { box-shadow: inset 0 3px 0 0 var(--bw-load); }
        .energy-layout {
          display:grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap:16px;
          align-items:center;
        }
        .energy-node {
          background:#f8fafc;
          border:1px solid #e2e8f0;
          border-radius:18px;
          padding:16px;
          text-align:center;
        }
        .energy-node.battery {
          grid-column:2;
          grid-row:1 / span 2;
          align-self:stretch;
          display:grid;
          align-content:center;
          gap:8px;
        }
        .energy-node-title {
          font-size:0.92rem;
          font-weight:800;
          color:#475569;
          text-transform:uppercase;
          letter-spacing:0.05em;
        }
        .energy-node-value {
          font-size:1.5rem;
          font-weight:800;
          color:#0f172a;
        }
        .energy-node-sub,
        .energy-bridge {
          font-size:0.88rem;
          color:#64748b;
        }
        .energy-bridge {
          text-align:center;
          font-weight:700;
        }
        .sankey-panel {
          width:100%;
          display:grid;
          gap:16px;
        }
        .sankey-stage {
          background:#fbfcfe;
          border:1px solid #e2e8f0;
          border-radius:22px;
          padding:14px;
          overflow:auto;
          position:relative;
        }
        .sankey-svg {
          width:100%;
          min-width:860px;
          height:auto;
          display:block;
        }
        .sankey-mobile {
          display:none;
          gap:10px;
          margin-top:10px;
        }
        .sankey-mobile-card,
        .sankey-mobile-flow {
          border-radius:16px;
          border:1px solid #dbe3ec;
          background:#fff;
          padding:12px 14px;
        }
        .sankey-mobile-card {
          display:grid;
          gap:4px;
        }
        .sankey-mobile-label {
          font-size:0.72rem;
          font-weight:900;
          letter-spacing:0.04em;
          text-transform:uppercase;
          color:#516075;
        }
        .sankey-mobile-value {
          font-size:1.2rem;
          font-weight:900;
          color:#0f172a;
        }
        .sankey-mobile-sub {
          font-size:0.8rem;
          font-weight:700;
          color:#64748b;
        }
        .sankey-mobile-flow {
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
          font-weight:800;
          color:#0f172a;
        }
        .sankey-mobile-flow span {
          color:#516075;
        }
        .sankey-mobile-flow-solar-load { box-shadow: inset 0 3px 0 0 var(--bw-solar); }
        .sankey-mobile-flow-solar-battery { box-shadow: inset 0 3px 0 0 var(--bw-battery); }
        .sankey-mobile-flow-grid-battery { box-shadow: inset 0 3px 0 0 var(--bw-grid); }
        .sankey-mobile-flow-battery-load { box-shadow: inset 0 3px 0 0 var(--bw-load); }
        .sankey-mobile-flow-feed { box-shadow: inset 0 3px 0 0 var(--bw-feed); }
        .sankey-link {
          fill:none;
          stroke-linecap:round;
          stroke-linejoin:round;
        }
        .sankey-links { filter:url(#sankeyShadow); }
        .sankey-link { pointer-events:none; mix-blend-mode:multiply; }
        .sankey-node-group {
          filter:url(#sankeyShadow);
        }
        .sankey-node-title {
          fill:#516075;
          font-size:12px;
          font-weight:900;
          letter-spacing:0.04em;
          text-transform:uppercase;
        }
        .sankey-node-value {
          fill:#0f172a;
          font-size:22px;
          font-weight:900;
        }
                .sankey-chip {
          fill:#0f172a;
          font-size:13px;
          font-weight:900;
          letter-spacing:0.03em;
          text-transform:uppercase;
        }
        .sankey-node-unit {
          fill:#516075;
          font-size:13px;
          font-weight:800;
        }
        .sankey-node-meta {
          fill:#516075;
          font-size:12px;
          font-weight:700;
        }
.sankey-node-sub {
          fill:#64748b;
          font-size:12px;
          font-weight:700;
        }
        .sankey-summary-grid {
          display:grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap:10px;
          margin-top:2px;
        }
        .sankey-summary {
          border-radius:14px;
          border:1px solid #dbe3ec;
          background:#fff;
          padding:12px 14px;
          box-shadow: inset 0 3px 0 0 transparent;
          display:flex;
          flex-direction:column;
          gap:5px;
          min-height:72px;
        }
        .sankey-summary-label {
          font-size:0.76rem;
          font-weight:900;
          letter-spacing:0.04em;
          text-transform:uppercase;
          color:#516075;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
        }
        .sankey-summary-value {
          font-size:1rem;
          font-weight:900;
          color:#0f172a;
          white-space:nowrap;
        }
        .sankey-summary-kind-solar { box-shadow: inset 0 3px 0 0 var(--bw-solar); }
        .sankey-summary-kind-battery { box-shadow: inset 0 3px 0 0 var(--bw-battery); }
        .sankey-summary-kind-feed { box-shadow: inset 0 3px 0 0 var(--bw-feed); }
        .sankey-summary-kind-grid { box-shadow: inset 0 3px 0 0 var(--bw-grid); }
        .sankey-summary-kind-load { box-shadow: inset 0 3px 0 0 var(--bw-load); }
        .chart-header { margin-bottom:18px; }
        .panel-tabs { display:flex; gap:10px; }
        .chart-tools { display:flex; align-items:center; gap:10px; flex-wrap:wrap; justify-content:flex-end; }
        .panel-tabs button,
        .legend-chip,
        .download-btn {
          border:none;
          border-radius:999px;
          padding:8px 14px;
          font-weight:700;
          cursor:pointer;
        }
        .panel-tabs button {
          background:#ffffff;
          color:#475569;
          border:1px solid #d6dbe1;
        }
        .panel-tabs button.active {
          background:#111827;
          color:#fff;
        }
        .download-btn {
          background:#ffffff;
          color:#0f172a;
          border:1px solid #d6dbe1;
          box-shadow:none;
        }
        .download-btn:hover,
        .panel-tabs button:hover,
        .legend-chip:hover,
        .history-pill:hover,
        .report-period-button:hover,
        .report-shift-button:hover {
          filter:brightness(0.98);
        }
        .download-btn:hover {
          background:#f8fafc;
        }
        .legend-chip,
        .panel-tabs button,
        .download-btn {
          transition:background 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
        }
        .download-btn {
          background:#ffffff;
          color:#fff;
        }
        .ring-grid {
          display:grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap:14px;
          margin-bottom:18px;
        }
        .ring-card {
          border-radius:20px;
          padding:16px 14px;
          text-align:center;
          border:2px solid transparent;
          background:#ffffff;
        }
        .ring-solar { border-color:var(--bw-solar); }
        .ring-load { border-color:var(--bw-load); }
        .ring-bat { border-color:var(--bw-battery); }
        .ring-feed { border-color:var(--bw-feed); }
        .ring-grid { border-color:var(--bw-grid); }
        .ring-value {
          font-size:1.1rem;
          font-weight:800;
          color:#0f172a;
        }
        .ring-label {
          margin-top:8px;
          color:#64748b;
          font-size:0.88rem;
        }
        .chart {
          width:100%;
          height:auto;
          display:block;
          background:#fff;
          border-radius:18px;
        }
        .axis,
        .grid {
          stroke:#d8e3ef;
          stroke-width:1;
        }
        .tick,
        .axis-label {
          fill:#6280a2;
          font-size:12px;
          font-weight:700;
        }
        .legend-row {
          display:flex;
          flex-wrap:wrap;
          gap:10px;
          margin-top:14px;
        }
        .legend-chip {
          background:#ffffff;
          color:#475569;
          border:1px solid #d6dbe1;
        }
        .legend-chip.active {
          background:#111827;
          color:#fff;
        }
        .stats-diagram {
          display:grid;
          gap:14px;
        }
        .stats-row {
          display:grid;
          gap:8px;
          padding:12px 0;
          border-bottom:1px solid #e1eaf4;
        }
        .stats-row:last-child {
          border-bottom:none;
        }
        .stats-row-head {
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:12px;
        }
        .stats-row-label {
          font-size:0.95rem;
          font-weight:700;
          color:#334155;
        }
        .stats-row-value {
          font-size:0.95rem;
          font-weight:800;
          color:#0f172a;
          text-align:right;
        }
        .stats-bar-track {
          position:relative;
          overflow:hidden;
          height:14px;
          border-radius:999px;
          background:#edf2f7;
        }
        .stats-bar-fill {
          height:100%;
          border-radius:999px;
        }
        .tone-solar { background:linear-gradient(90deg, var(--bw-solar), #f7da61); }
        .tone-load { background:linear-gradient(90deg, var(--bw-load), #78bdf4); }
        .tone-battery { background:linear-gradient(90deg, var(--bw-battery), #66d98b); }
        .tone-feed { background:linear-gradient(90deg, var(--bw-feed), #f0a15c); }
        .tone-grid { background:linear-gradient(90deg, var(--bw-grid), #b1bac0); }
        .tone-info { background:linear-gradient(90deg, #4b8fff, #6ca7ff); }
        .empty {
          padding:24px;
          border-radius:18px;
          background:#fff;
          border:1px dashed #cbd5e1;
          color:#64748b;
        }
        @media (max-width: 1260px) {
          .hero-banner {
            grid-template-columns: 1fr;
          }
          .overview-grid,
          .summary-grid,
          .live-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .ring-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
          .body-grid {
            grid-template-columns: 1fr;
          }
          .aggregate-row {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
          .aggregate-header {
            display:none;
          }
          .detail-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        @media (max-width: 860px) {
          .selector-row {
            grid-template-columns: 1fr;
          }
          .overview-metrics,
          .stats-grid {
            grid-template-columns: 1fr;
          }
          .hero-metrics {
            grid-template-columns: 1fr;
          }
          .history-summary {
            grid-template-columns: 1fr;
          }
          .aggregate-row {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .summary-grid,
          .live-grid,
          .ring-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .energy-layout {
            grid-template-columns: 1fr;
          }
          .detail-grid {
            grid-template-columns: 1fr;
          }
          .flow-grid {
            grid-template-columns: 1fr;
          }
          .energy-node.battery {
            grid-column:auto;
            grid-row:auto;
          }
        }
        @media (max-width: 700px) {
          .sankey-stage {
            overflow:hidden;
            padding:10px;
          }
          .sankey-svg {
            display:none;
            min-width:0;
            width:100%;
          }
          .sankey-mobile {
            display:grid;
          }
          .sankey-mobile-flow {
            padding:10px 12px;
          }
          .sankey-summary-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .sankey-summary-label {
            white-space:normal;
          }
          .sankey-node-value {
            font-size:20px;
          }
          .sankey-node-unit,
          .sankey-node-meta,
          .sankey-node-sub,
          .sankey-chip {
            font-size:11px;
          }
        }
      </style>
      <ha-card>
        <div class="shell">
          <div class="title-row">
            <div class="title-icon">&#9889;</div>
            <div class="title">ByteWatt Report</div>
            <div class="version-badge">v${BYTEWATT_REPORT_CARD_BUILD}</div>
            <button class="cache-button" type="button" data-clear-cache>Clear Cache</button>
          </div>
          ${this._renderSelector()}
          ${this._renderReportControls(periodContext)}
          ${
            reporting
              ? `
            ${this._renderSankeyPanel(reporting)}
            ${this._renderHeroBanner(reporting)}
            ${this._renderHistoryPanel()}
            ${this._renderAggregateStrip(reporting)}
            ${this._renderAggregateTable(reporting)}
            ${this._renderOverviewBands(reporting)}
            ${this._renderSummaryTiles(reporting)}
            ${this._renderLiveStrip(reporting)}
            <div class="body-grid">
              <div class="stack-grid">
                ${this._renderRealtimePanel(reporting)}
                ${this._renderEnergyDiagram(reporting)}
                ${this._renderDetailsPanel(reporting)}
              </div>
              ${this._renderChart(reporting)}
            </div>
          `
              : `<div class="empty">Reporting data is not available yet. Select a battery target and wait for the next coordinator refresh.</div>`
          }
        </div>
      </ha-card>
    `;
    this._bindEvents();
  }

  _bindEvents() {
    this.shadowRoot.querySelector("[data-select-target]")?.addEventListener("change", async (event) => {
      await this._hass.callService("select", "select_option", {
        entity_id: this._config.settings_target,
        option: event.target.value,
      });
    });
    this.shadowRoot.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => {
        this._view = button.dataset.view;
        this.render();
      });
    });
    this.shadowRoot.querySelectorAll("[data-series]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.series;
        this._activeSeries[key] = !this._activeSeries[key];
        this.render();
      });
    });
    this.shadowRoot.querySelectorAll("[data-history-period]").forEach((button) => {
      button.addEventListener("click", () => {
        this._historyPeriod = button.dataset.historyPeriod;
        this.render();
      });
    });
    this.shadowRoot.querySelectorAll("[data-report-period]").forEach((button) => {
      button.addEventListener("click", () => {
        this._reportPeriod = button.dataset.reportPeriod || "day";
        this._reportAnchorDate = "";
        this.render();
      });
    });
    this.shadowRoot.querySelectorAll("[data-report-shift]").forEach((button) => {
      button.addEventListener("click", () => {
        const step = Number(button.dataset.reportShift || 0) || 0;
        const records = this._historyRecords().sort((a, b) => String(a.record_date).localeCompare(String(b.record_date)));
        const fallback = this._parseLocalDate(this._reportAnchorDate) || this._parseLocalDate(this._reporting()?.power_diagram?.date) || null;
        const current = this._clampAnchor(fallback || this._parseLocalDate(this._historyRange(records).latest) || new Date(), records);
        this._reportAnchorDate = this._formatLocalDate(this._shiftAnchor(current, this._reportPeriod || "day", step));
        this.render();
      });
    });
    this.shadowRoot.querySelector("[data-report-date]")?.addEventListener("change", (event) => {
      this._reportAnchorDate = String(event.target.value || "").trim();
      this.render();
    });
    this.shadowRoot.querySelector("[data-clear-cache]")?.addEventListener("click", async () => {
      try {
        if ("caches" in window && window.caches?.keys) {
          const keys = await window.caches.keys();
          await Promise.all(keys.map((key) => window.caches.delete(key)));
        }
      } catch (error) {
        console.warn("ByteWatt report cache clear failed:", error);
      }
      window.location.reload();
    });
    this.shadowRoot.querySelector("[data-download-report]")?.addEventListener("click", () => {
      this._downloadCsv();
    });
  }

  _escape(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
}

if (!customElements.get("bytewatt-report-card")) {
  customElements.define("bytewatt-report-card", ByteWattReportCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "bytewatt-report-card",
  name: "ByteWatt Report Card",
  description: `ByteWatt reporting card build ${BYTEWATT_REPORT_CARD_BUILD}.`,
});

window.bytewattReportCardBuild = BYTEWATT_REPORT_CARD_BUILD;

