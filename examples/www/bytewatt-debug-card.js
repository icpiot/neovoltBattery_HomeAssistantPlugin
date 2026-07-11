const BYTEWATT_DEBUG_CARD_BUILD = "027";

class ByteWattDebugCard extends HTMLElement {
  setConfig(config) {
    const prefix = config?.entity_prefix || "house_bytewatt_battery_system";
    this._config = {
      entity_prefix: prefix,
      settings_target: config?.settings_target || `select.${prefix}_settings_target`,
      title: config?.title || "ByteWatt Debug",
      ...config,
    };
    this._debugStorageKey = `bytewatt-debug:${this._config.entity_prefix}:${this._config.settings_target}`;
    this._status = "";
    this._statusKind = "neutral";
    const saved = this._loadDebugState();
    this._debugPeriod = saved.period || this._debugPeriod || "day";
    this._debugAnchorDate = saved.anchor || this._debugAnchorDate || "";
    this._historyLoading = this._historyLoading || false;
    this._historyData = this._historyData || null;
    this._historyLoadError = this._historyLoadError || "";
    this._historySourceKey = this._historySourceKey || "";
  }

  set hass(hass) {
    this._hass = hass;
    this.render();
  }

  getCardSize() {
    return 14;
  }

  _stateObj(entityId) {
    return entityId ? this._hass?.states?.[entityId] : null;
  }

  _loadDebugState() {
    try {
      if (!this._debugStorageKey || !window.localStorage) return {};
      const raw = window.localStorage.getItem(this._debugStorageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_err) {
      return {};
    }
  }

  _saveDebugState() {
    try {
      if (!this._debugStorageKey || !window.localStorage) return;
      window.localStorage.setItem(
        this._debugStorageKey,
        JSON.stringify({
          period: this._debugPeriod || "day",
          anchor: this._debugAnchorDate || "",
        }),
      );
    } catch (_err) {
      return;
    }
  }

  _selectorState() {
    return this._stateObj(this._config.settings_target);
  }

  _reportTargetId() {
    return this._config.report_target || `select.${this._config.entity_prefix}_report_target`;
  }

  _reportState() {
    return this._stateObj(this._reportTargetId());
  }

  _attrs() {
    return this._selectorState()?.attributes || {};
  }

  _reportAttrs() {
    return this._reportState()?.attributes || {};
  }

  _reporting() {
    const reportAttrs = this._reportAttrs();
    const selectorAttrs = this._attrs();
    return reportAttrs.reporting || selectorAttrs.reporting || {};
  }

  _history() {
    const reportAttrs = this._reportAttrs();
    const selectorAttrs = this._attrs();
    const direct = reportAttrs.history || selectorAttrs.history;
    if (direct && typeof direct === "object") return direct;
    const fallback = reportAttrs.reporting?.meta?.history
      || selectorAttrs.reporting?.meta?.history
      || reportAttrs.reporting?.history
      || selectorAttrs.reporting?.history;
    return fallback && typeof fallback === "object" ? fallback : {};
  }

  _json(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch (_err) {
      return String(value);
    }
  }

  async _clearAppCaches() {
    if (!window.caches?.keys) return;
    try {
      const cacheKeys = await window.caches.keys();
      await Promise.all(cacheKeys.map((key) => window.caches.delete(key)));
    } catch (_err) {
      // If cache storage is unavailable, keep going with the reload.
    }
  }

  _reloadWithCacheBust() {
    const url = new URL(window.location.href);
    url.searchParams.set("_bw_debug_refresh", String(Date.now()));
    window.location.replace(url.toString());
  }

  async _hardRefresh() {
    if (this._statusKind === "loading") return;
    this._status = "Forcing archive refresh, clearing reachable caches, and reloading...";
    this._statusKind = "loading";
    this.render();
    try {
      await this._requestArchiveProbe(true);
      try {
        window.localStorage?.removeItem(this._localHistoryKey());
      } catch (_err) {
        // Ignore localStorage failures and continue.
      }
      await this._clearAppCaches();
      this._status = "Reloading now...";
      this.render();
      window.setTimeout(() => this._reloadWithCacheBust(), 150);
    } catch (err) {
      this._status = `Hard refresh failed: ${String(err?.message || err)}`;
      this._statusKind = "error";
      this.render();
    }
  }

  _escape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  _fmtTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  }

  _summaryLine(label, value) {
    return `
      <div class="line">
        <div class="label">${this._escape(label)}</div>
        <div class="value">${this._escape(value ?? "-")}</div>
      </div>
    `;
  }

  _parseLocalDate(value) {
    if (!value) return null;
    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
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

  _parseFloat(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  _valueAtPath(value, path) {
    let current = value;
    for (const segment of path) {
      if (current == null || typeof current !== "object" || !(segment in current)) {
        return undefined;
      }
      current = current[segment];
    }
    return current;
  }

  _recordValue(record, paths = []) {
    for (const path of paths) {
      const value = this._valueAtPath(record, path);
      if (value !== undefined && value !== null && value !== "") {
        return value;
      }
    }
    return undefined;
  }

  _recordFloat(record, paths = []) {
    return this._parseFloat(this._recordValue(record, paths));
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
      aggregate.solar_generation_today += this._recordFloat(record, [["solar_generation_today"], ["today", "solar_generation"]]);
      aggregate.load_consumption_today += this._recordFloat(record, [["load_consumption_today"], ["today", "load_consumption"]]);
      aggregate.feed_in_today += this._recordFloat(record, [["feed_in_today"], ["today", "feed_in"]]);
      aggregate.grid_consumption_today += this._recordFloat(record, [["grid_consumption_today"], ["today", "grid_consumption"]]);
      aggregate.battery_charged_today += this._recordFloat(record, [["battery_charged_today"], ["today", "battery_charge"]]);
      aggregate.battery_discharged_today += this._recordFloat(record, [["battery_discharged_today"], ["today", "battery_discharge"]]);
    });

    const periodDelta = (paths) => {
      const start = this._recordFloat(firstRecord, paths);
      const end = this._recordFloat(latestRecord, paths);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        return Math.max(end - start, 0);
      }
      return end || 0;
    };

    aggregate.live_soc = this._recordFloat(latestRecord, [["live_soc"], ["live", "soc"]]);
    aggregate.total_solar_generation = periodDelta([["total_solar_generation"], ["totals", "solar_generation"]]);
    aggregate.total_feed_in = periodDelta([["total_feed_in"], ["totals", "feed_in"]]);
    aggregate.total_battery_charge = periodDelta([["total_battery_charge"], ["totals", "battery_charge"]]);
    aggregate.total_battery_discharge = periodDelta([["total_battery_discharge"], ["totals", "battery_discharge"]]);
    aggregate.total_house_consumption = periodDelta([["total_house_consumption"], ["totals", "house_consumption"]]);
    aggregate.total_grid_consumption = periodDelta([["total_grid_consumption"], ["totals", "grid_consumption"]]);
    aggregate.pv_power_house = periodDelta([["pv_power_house"], ["totals", "pv_power_house"]]);
    aggregate.pv_charging_battery = periodDelta([["pv_charging_battery"], ["totals", "pv_charging_battery"]]);
    aggregate.grid_battery_charge = periodDelta([["grid_battery_charge"], ["totals", "grid_battery_charge"]]);

    return aggregate;
  }

  _periodWindow(anchor, period = this._debugPeriod) {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    const end = new Date(start.getTime());
    if (period === "week") {
      const mondayOffset = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - mondayOffset);
      end.setDate(start.getDate() + 6);
    } else if (period === "month") {
      start.setDate(1);
      end.setMonth(start.getMonth() + 1, 0);
    } else if (period === "quarter") {
      const quarterStartMonth = Math.floor(start.getMonth() / 3) * 3;
      start.setMonth(quarterStartMonth, 1);
      end.setMonth(quarterStartMonth + 3, 0);
    }
    return { start, end };
  }

  _shiftAnchor(anchor, period, step) {
    const shifted = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    if (period === "week") {
      shifted.setDate(shifted.getDate() + step * 7);
    } else if (period === "month") {
      shifted.setMonth(shifted.getMonth() + step);
    } else if (period === "quarter") {
      shifted.setMonth(shifted.getMonth() + step * 3);
    } else {
      shifted.setDate(shifted.getDate() + step);
    }
    return shifted;
  }

  _todayLocalDate() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  _clampDateToToday(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return this._todayLocalDate();
    const today = this._todayLocalDate();
    const current = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return current > today ? today : current;
  }

  _clampAnchor(anchor) {
    const latest = this._parseLocalDate(this._reporting()?.power_diagram?.date)
      || this._parseLocalDate(this._reporting()?.reporting_date)
      || this._parseLocalDate(this._reporting()?.meta?.reporting_date)
      || this._todayLocalDate();
    if (!anchor) return latest;
    return this._clampDateToToday(anchor > latest ? latest : anchor);
  }

  _debugAnchor() {
    return this._parseLocalDate(this._debugAnchorDate)
      || this._parseLocalDate(this._reporting()?.power_diagram?.date)
      || this._parseLocalDate(this._reporting()?.reporting_date)
      || this._parseLocalDate(this._reporting()?.meta?.reporting_date)
      || this._todayLocalDate();
  }

  _debugRange() {
    const anchor = this._clampAnchor(this._debugAnchor());
    const window = this._periodWindow(anchor, this._debugPeriod || "day");
    return {
      anchor,
      window,
      displayDate: this._formatLocalDate(anchor),
    };
  }

  _historyConfigured() {
    const history = this._history();
    return Boolean(history?.enabled || history?.base_url || history?.entry_id);
  }

  _historyEntryId() {
    return String(this._history()?.entry_id || "").trim();
  }

  _historyUrl() {
    const history = this._history();
    const explicitBase = String(history?.base_url || "").trim();
    const entryId = String(history?.entry_id || "").trim();
    const base = explicitBase
      ? explicitBase.replace(/\/+$/, "")
      : entryId
        ? `/local/bytewatt-history/${entryId}`
        : "";
    if (!base) return "";
    return `${base}/history.json`;
  }

  _historyBackfillDays() {
    const history = this._history();
    const rawDays = Number(history?.backfill_days ?? 0);
    if (Number.isFinite(rawDays) && rawDays > 0) return Math.max(1, Math.floor(rawDays));
    const rawYears = Number(history?.backfill_years ?? 0);
    if (Number.isFinite(rawYears) && rawYears > 0) return Math.max(1, Math.floor(rawYears * 365));
    return 365;
  }

  _localHistoryKey() {
    const entity = String(this._config?.settings_target || "bytewatt").replace(/[^A-Za-z0-9_.-]+/g, "_");
    return `bytewatt-debug-history:${entity}`;
  }

  _readLocalHistory() {
    try {
      const raw = window.localStorage?.getItem(this._localHistoryKey());
      if (!raw) return { scopes: {} };
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : { scopes: {} };
    } catch (_err) {
      return { scopes: {} };
    }
  }

  _mergeSnapshotPayload(base, incoming) {
    const merged = {
      ...(base && typeof base === "object" ? base : {}),
      ...(incoming && typeof incoming === "object" ? incoming : {}),
    };
    const baseScopes = base?.scopes && typeof base.scopes === "object" ? base.scopes : {};
    const incomingScopes = incoming?.scopes && typeof incoming.scopes === "object" ? incoming.scopes : {};
    const scopes = { ...baseScopes };
    Object.entries(incomingScopes).forEach(([scopeKey, scopeValue]) => {
      const current = scopes[scopeKey] || {};
      const currentRecords = current.records && typeof current.records === "object" ? current.records : {};
      const incomingRecords = scopeValue?.records && typeof scopeValue.records === "object" ? scopeValue.records : {};
      const currentMissing = current.missing_dates && typeof current.missing_dates === "object" ? current.missing_dates : {};
      const incomingMissing = scopeValue?.missing_dates && typeof scopeValue.missing_dates === "object" ? scopeValue.missing_dates : {};
      scopes[scopeKey] = {
        ...current,
        ...scopeValue,
        records: {
          ...currentRecords,
          ...incomingRecords,
        },
        missing_dates: {
          ...currentMissing,
          ...incomingMissing,
        },
      };
    });
    merged.scopes = scopes;
    return merged;
  }

  _writeLocalHistory(data) {
    try {
      const merged = this._mergeSnapshotPayload(this._readLocalHistory(), data);
      window.localStorage?.setItem(this._localHistoryKey(), JSON.stringify(merged));
    } catch (_err) {
      // Storage can be unavailable; remote history remains the source of truth.
    }
  }

  _historyScopes() {
    const localScopes = this._readLocalHistory()?.scopes;
    const remoteScopes = this._historyData?.scopes;
    const mergeScopes = (source, target) => {
      const merged = { ...(target || {}) };
      Object.entries(source || {}).forEach(([scopeKey, scopeValue]) => {
        const current = merged[scopeKey] || {};
        const currentRecords = current.records && typeof current.records === "object" ? current.records : {};
        const incomingRecords = scopeValue?.records && typeof scopeValue.records === "object" ? scopeValue.records : {};
        const currentMissing = current.missing_dates && typeof current.missing_dates === "object" ? current.missing_dates : {};
        const incomingMissing = scopeValue?.missing_dates && typeof scopeValue.missing_dates === "object" ? scopeValue.missing_dates : {};
        merged[scopeKey] = {
          ...current,
          ...scopeValue,
          records: {
            ...currentRecords,
            ...incomingRecords,
          },
          missing_dates: {
            ...currentMissing,
            ...incomingMissing,
          },
        };
      });
      return merged;
    };
    return mergeScopes(localScopes, mergeScopes(remoteScopes, {}));
  }

  _historyScopeKey() {
    const history = this._history();
    const reportAttrs = this._reportAttrs();
    const selectorAttrs = this._attrs();
    return String(history.current_scope || reportAttrs.current_scope || selectorAttrs.current_scope || "all").trim() || "all";
  }

  _historyScopeData() {
    const scopes = this._historyScopes();
    const requested = this._historyScopeKey();
    if (scopes?.[requested]?.records) {
      return { requested, key: requested, scope: scopes[requested], fallback: false };
    }
    return {
      requested,
      key: requested,
      scope: scopes?.[requested] || null,
      fallback: false,
    };
  }

  _selectedHistoryDateKey() {
    const range = this._debugRange();
    return range.displayDate || this._formatLocalDate(range.anchor) || "";
  }

  _selectedHistoryRecordInfo() {
    const scopeInfo = this._historyScopeData();
    const scope = scopeInfo.scope || {};
    const selectedDate = this._selectedHistoryDateKey();
    const record = selectedDate ? (scope.records?.[selectedDate] || null) : null;
    const missingMarker = selectedDate ? Boolean(scope.missing_dates?.[selectedDate]) : false;
    const hasData = this._recordHasPowerDiagramData(record);
    return {
      date: selectedDate,
      scope_key: scopeInfo.key,
      requested_scope: scopeInfo.requested,
      record,
      status: hasData ? "available" : (selectedDate ? (missingMarker ? "missing" : "missing") : "unavailable"),
      has_data: hasData,
      missing_marker: missingMarker,
    };
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

  _recordHasPowerDiagramData(record) {
    const powerDiagram = this._powerDiagramFromRecord(record);
    if (!powerDiagram || !Object.keys(powerDiagram).length) return false;
    if (Array.isArray(powerDiagram.time) && powerDiagram.time.length > 0) return true;
    const series = powerDiagram.series && typeof powerDiagram.series === "object" ? powerDiagram.series : {};
    return Object.values(series).some((value) => Array.isArray(value) && value.length > 0);
  }

  _powerDiagramFromRecord(record) {
    if (!record || typeof record !== "object") return {};
    const nested = record.power_diagram;
    if (nested && typeof nested === "object" && !Array.isArray(nested) && Object.keys(nested).length) {
      return nested;
    }
    const bareKeys = ["time", "series", "summary", "date", "meta"];
    const hasBarePowerDiagram = bareKeys.some((key) => Object.prototype.hasOwnProperty.call(record, key));
    return hasBarePowerDiagram ? record : {};
  }

  _historyRecords() {
    const scopeInfo = this._historyScopeData();
    const data = scopeInfo.scope?.records || {};
    return Object.entries(data)
      .filter(([, reporting]) => this._recordHasPowerDiagramData(reporting))
      .map(([recordDate, reporting]) => {
        const powerDiagram = this._powerDiagramFromRecord(reporting);
        const parsed = this._parseLocalDate(recordDate) || this._parseLocalDate(reporting?.reporting_date) || this._parseLocalDate(powerDiagram?.date);
        const normalizedDate = parsed ? this._formatLocalDate(parsed) : String(recordDate || "");
        const displayDate = parsed ? this._formatDisplayDate(parsed) : String(reporting?.reporting_date || recordDate || "");
        return {
          ...(reporting || {}),
          record_date: normalizedDate,
          record_date_display: displayDate,
          record_date_raw: String(recordDate || ""),
          history_scope: scopeInfo.key,
          requested_scope: scopeInfo.requested,
        };
      });
  }

  _selectedHistoryRecords() {
    const records = this._historyRecords().sort((a, b) => String(a.record_date).localeCompare(String(b.record_date)));
    if (!records.length) return [];
    const period = this._debugPeriod || "day";
    const anchor = this._debugRange().anchor || this._todayLocalDate();
    const window = this._periodWindow(anchor, period);
    if (!window?.start || !window?.end) return records;
    return this._expandDailyRecords(records, window);
  }

  _selectedReportSnapshot(reporting) {
    const snapshot = reporting && typeof reporting === "object" ? JSON.parse(JSON.stringify(reporting)) : {};
    const range = this._debugRange();
    const selectedDate = range.displayDate || this._formatLocalDate(range.anchor) || "";
    const records = this._selectedHistoryRecords();
    const latestSelectedRecord = records[records.length - 1] || {};
    const latestPowerDiagram = latestSelectedRecord?.power_diagram && typeof latestSelectedRecord.power_diagram === "object"
      ? latestSelectedRecord.power_diagram
      : {};
    const currentPowerDiagram = snapshot.power_diagram && typeof snapshot.power_diagram === "object"
      ? snapshot.power_diagram
      : {};
    snapshot.reporting_date = selectedDate || snapshot.reporting_date || currentPowerDiagram.date || "";
    snapshot.meta = {
      ...(snapshot.meta || {}),
      reporting_date: snapshot.reporting_date,
    };
    snapshot.power_diagram = {
      ...currentPowerDiagram,
      ...latestPowerDiagram,
      date: snapshot.reporting_date || currentPowerDiagram.date || latestPowerDiagram.date || "",
      meta: {
        ...(currentPowerDiagram.meta || {}),
        ...(latestPowerDiagram.meta || {}),
      },
      summary: {
        ...(currentPowerDiagram.summary || {}),
        ...(latestPowerDiagram.summary || {}),
      },
      time: Array.isArray(latestPowerDiagram.time) && latestPowerDiagram.time.length
        ? latestPowerDiagram.time
        : Array.isArray(currentPowerDiagram.time)
          ? currentPowerDiagram.time
          : [],
      series: latestPowerDiagram.series && typeof latestPowerDiagram.series === "object" && Object.keys(latestPowerDiagram.series).length
        ? latestPowerDiagram.series
        : currentPowerDiagram.series && typeof currentPowerDiagram.series === "object"
          ? currentPowerDiagram.series
          : {},
    };
    return snapshot;
  }

  _expandDailyRecords(records, window) {
    const start = window?.start instanceof Date
      ? new Date(window.start.getFullYear(), window.start.getMonth(), window.start.getDate())
      : null;
    const end = window?.end instanceof Date
      ? new Date(window.end.getFullYear(), window.end.getMonth(), window.end.getDate())
      : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      return records || [];
    }
    const mapped = new Map((records || []).map((record) => [String(record?.record_date || ""), record]));
    const expanded = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    while (cursor <= end) {
      const key = this._formatLocalDate(cursor);
      const record = mapped.get(key) || {};
      expanded.push({
        record_date: key,
        record_date_display: this._formatDisplayDate(cursor),
        __missing: !mapped.has(key),
        ...record,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return expanded;
  }

  _historyScopeSummaries() {
    const scopes = this._historyScopes();
    const expectedCount = this._historyBackfillDays();
    const today = this._todayLocalDate();
    const expectedStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    expectedStart.setDate(expectedStart.getDate() - (expectedCount - 1));
    const inventoryScopes = Array.isArray(this._history()?.inventory_scopes) ? this._history().inventory_scopes : [];
    const merged = new Map();
    const addScope = (scopeKey, label, aggregate) => {
      const current = merged.get(scopeKey) || {
        scope_key: scopeKey,
        label: String(label || scopeKey || "all"),
        aggregate: Boolean(aggregate),
        stored_count: 0,
        missing_count: 0,
        known_count: 0,
        expected_count: expectedCount,
        remaining_count: expectedCount,
        coverage_label: `0/${expectedCount}`,
        first_date: "",
        latest_date: "",
        active: false,
      };
      current.label = String(label || current.label || scopeKey || "all");
      current.aggregate = Boolean(aggregate);
      merged.set(scopeKey, current);
    };
    addScope("all", "All systems", true);
    inventoryScopes.forEach((scope) => addScope(String(scope?.scope_key || scope?.key || scope?.value || ""), scope?.label || scope?.name || scope?.scope_key || scope?.key || "System", scope?.aggregate ?? false));
    Object.entries(scopes || {}).forEach(([scopeKey, scopeValue]) => {
      addScope(scopeKey, scopeValue?.label || scopeValue?.name || scopeKey, Boolean(scopeValue?.aggregate));
      const current = merged.get(scopeKey);
      const recordDates = Object.keys(scopeValue?.records || {}).sort();
      const missingDates = Object.keys(scopeValue?.missing_dates || {}).sort();
      const knownCount = new Set([...recordDates, ...missingDates]).size;
      const storedCount = recordDates.length;
      const missingCount = missingDates.length;
      const remainingCount = Math.max(expectedCount - knownCount, 0);
      const range = this._historyRange(recordDates.map((record_date) => ({ record_date })));
      current.stored_count = storedCount;
      current.missing_count = missingCount;
      current.known_count = knownCount;
      current.expected_count = expectedCount;
      current.remaining_count = remainingCount;
      current.coverage_label = `${knownCount}/${expectedCount}`;
      current.first_date = range.first;
      current.latest_date = range.latest;
      current.active = scopeKey === this._historyScopeKey();
    });
    if (!merged.has(this._historyScopeKey())) {
      const scopeValue = scopes?.[this._historyScopeKey()] || {};
      const recordDates = Object.keys(scopeValue?.records || {}).sort();
      const missingDates = Object.keys(scopeValue?.missing_dates || {}).sort();
      const knownCount = new Set([...recordDates, ...missingDates]).size;
      const storedCount = recordDates.length;
      const missingCount = missingDates.length;
      const remainingCount = Math.max(expectedCount - knownCount, 0);
      const range = this._historyRange(recordDates.map((record_date) => ({ record_date })));
      merged.set(this._historyScopeKey(), {
        scope_key: this._historyScopeKey(),
        label: this._historyScopeKey(),
        aggregate: this._historyScopeKey() === "all",
        stored_count: storedCount,
        missing_count: missingCount,
        known_count: knownCount,
        expected_count: expectedCount,
        remaining_count: remainingCount,
        coverage_label: `${knownCount}/${expectedCount}`,
        first_date: range.first,
        latest_date: range.latest,
        active: true,
      });
    }
    return Array.from(merged.values()).sort((a, b) => {
      if (a.scope_key === "all") return -1;
      if (b.scope_key === "all") return 1;
      return String(a.label).localeCompare(String(b.label));
    });
  }

  _historyButton(label, value) {
    return `<button class="history-pill ${this._debugPeriod === value ? "active" : ""}" data-debug-period="${value}">${label}</button>`;
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
                `<option value="${this._escape(option)}" ${option === current ? "selected" : ""}>${this._escape(option)}</option>`,
            )
            .join("")}
        </select>
      </div>
    `;
  }

  _fmtNumber(value, digits = 1) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "Unavailable";
    return number
      .toFixed(digits)
      .replace(/\.0+$/, "")
      .replace(/(\.\d*[1-9])0+$/, "$1");
  }

  _fmtEnergy(value) {
    if (value === "-" || value === null || value === undefined || value === "") return "-";
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    return `${this._fmtNumber(number, 1)} kWh`;
  }

  _fmtPercent(value) {
    if (value === "-" || value === null || value === undefined || value === "") return "-";
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    return `${this._fmtNumber(number, 1)} %`;
  }

  _renderHistoryPanel() {
    if (!this._historyConfigured()) return "";
    const records = this._selectedHistoryRecords();
    const summary = this._aggregateHistoryRecords(records);
    const scopeSummaries = this._historyScopeSummaries();
    const loading = this._historyLoading && !this._historyData;
    const error = this._historyLoadError;
    const periodLabel = { today: "Today", day: "Day", week: "Week", month: "Month", quarter: "Quarter" }[this._debugPeriod] || "Day";
    const periodWindow = this._debugRange().window;
    const selectedHistory = this._selectedHistoryRecordInfo();
    const formatHistoryDate = (value) => {
      const parsed = this._parseLocalDate(value);
      return parsed ? this._formatDisplayDate(parsed) : String(value || "");
    };
    const selectedPowerDiagram = this._powerDiagramFromRecord(selectedHistory.record || {});
    const selectedPowerRows = Array.isArray(selectedPowerDiagram.time) ? selectedPowerDiagram.time.length : 0;
    const selectedPowerSeries = selectedPowerDiagram.series && typeof selectedPowerDiagram.series === "object"
      ? Object.entries(selectedPowerDiagram.series)
          .filter(([, value]) => Array.isArray(value) && value.length > 0)
          .map(([key, value]) => `${key}:${value.length}`)
      : [];
    const rowCount = records.length;
    const rows = records
      .slice()
      .map((record) => {
        const rowDate = record.record_date_display || record.record_date || "Unknown";
        const missing = Boolean(record.__missing);
        const solar = missing ? "-" : (record?.today?.solar_generation ?? record?.solar_generation_today ?? 0);
        const load = missing ? "-" : (record?.today?.load_consumption ?? record?.load_consumption_today ?? 0);
        const feed = missing ? "-" : (record?.today?.feed_in ?? record?.feed_in_today ?? 0);
        const grid = missing ? "-" : (record?.today?.grid_consumption ?? record?.grid_consumption_today ?? 0);
        const charge = missing ? "-" : (record?.today?.battery_charge ?? record?.battery_charged_today ?? 0);
        const discharge = missing ? "-" : (record?.today?.battery_discharge ?? record?.battery_discharged_today ?? 0);
        return `
          <tr>
            <td>${this._escape(rowDate)}</td>
            <td>${this._escape(this._fmtEnergy(solar))}</td>
            <td>${this._escape(this._fmtEnergy(load))}</td>
            <td>${this._escape(this._fmtEnergy(feed))}</td>
            <td>${this._escape(this._fmtEnergy(grid))}</td>
            <td>${this._escape(this._fmtEnergy(charge))}</td>
            <td>${this._escape(this._fmtEnergy(discharge))}</td>
          </tr>
        `;
      })
      .join("");
    return `
      <div class="panel history-panel">
        <div class="panel-header">
          <div class="panel-title">Local Archive</div>
          <div class="panel-date">
            ${this._escape(summary.first_date ? `${formatHistoryDate(summary.first_date)} -> ${formatHistoryDate(summary.latest_date || summary.first_date)}` : this._historyUrl())}
          </div>
        </div>
        <div class="history-controls">
          <span class="history-pill active">Selected period: ${this._escape(periodLabel)}</span>
          <span class="history-pill">Range: ${this._escape(this._formatDisplayDate(periodWindow.start))} to ${this._escape(this._formatDisplayDate(periodWindow.end))}</span>
        </div>
        <div class="panel" style="margin-top: 14px;">
          <div class="panel-title">Selected Date Snapshot</div>
          <div class="button-row">
            <button class="button secondary" type="button" data-copy="selected-date">Copy selected date</button>
            <button class="button secondary" type="button" data-copy="selected-date-power">Copy selected date power</button>
            <button class="button" type="button" id="force-selected-date-download">Force selected date download</button>
          </div>
          ${this._summaryLine("Selected date", selectedHistory.date || "-")}
          ${this._summaryLine("Scope", selectedHistory.scope_key || "-")}
          ${this._summaryLine("Status", selectedHistory.status === "available" ? "available" : "missing")}
          ${this._summaryLine("Chart rows", selectedHistory.has_data ? selectedPowerRows : 0)}
          ${this._summaryLine("Chart series", selectedHistory.has_data ? (selectedPowerSeries.join(", ") || "-") : "-")}
          ${
            selectedHistory.has_data
              ? `
                <div class="history-table-head" style="margin-top: 12px;">
                  <div class="history-table-title">Selected Date Row</div>
                  <div class="history-table-subtitle">Exact archive row for ${this._escape(formatHistoryDate(selectedHistory.date))}</div>
                </div>
                <pre class="json">${this._escape(this._json(selectedHistory.record || {}))}</pre>
              `
              : `
                <div class="empty" style="margin-top: 12px;">No stored chart data exists for this selected date. If you expected a chart here, the archive for ${this._escape(formatHistoryDate(selectedHistory.date))} is missing.</div>
                <pre class="json">${this._escape(this._json(selectedHistory.record || { missing: true, date: selectedHistory.date || "" }))}</pre>
              `
          }
        </div>
        ${
          scopeSummaries.length
            ? `
              <div class="history-overview">
                <div class="history-overview-head">
                  <div class="history-overview-title">Archive Coverage Overview</div>
                  <div class="history-overview-subtitle">Stored rows vs the configured ${this._historyBackfillDays()} day history horizon</div>
                </div>
                <div class="history-overview-grid">
                  ${scopeSummaries
                    .map(
                      (scope) => `
                        <div class="history-overview-card ${scope.active ? "active" : ""}">
                          <div class="history-overview-card-head">
                            <div class="history-overview-card-title">${this._escape(scope.label)}</div>
                            <div class="history-overview-card-badge">${this._escape(scope.coverage_label)}</div>
                          </div>
                          <div class="history-overview-card-meta">stored ${scope.stored_count} | missing ${scope.missing_count} | remaining ${scope.remaining_count}</div>
                          <div class="history-overview-card-meta">${this._escape(scope.first_date && scope.latest_date ? `${formatHistoryDate(scope.first_date)} -> ${formatHistoryDate(scope.latest_date)}` : "No stored rows yet")}</div>
                        </div>
                      `,
                    )
                    .join("")}
                </div>
              </div>
            `
            : ""
        }
        ${
          loading
            ? `<div class="empty">Loading local history from ${this._escape(this._historyUrl())}...</div>`
            : error
              ? `<div class="empty">Local history unavailable: ${this._escape(error)}</div>`
              : records.length
                ? `
                  <div class="history-summary">
                    ${this._metric("Records", summary.count)}
                    ${this._metric("Latest Date", this._escape(summary.latest_date ? formatHistoryDate(summary.latest_date) : "Unavailable"))}
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
                  <div class="history-table-head">
                    <div class="history-table-title">Archive Inspector</div>
                    <div class="history-table-subtitle">Latest ${rowCount} row(s) for the selected period</div>
                  </div>
                  <div class="history-table-wrap">
                    <table class="history-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Solar</th>
                          <th>Load</th>
                          <th>Feed-in</th>
                          <th>Grid</th>
                          <th>Charge</th>
                          <th>Discharge</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${rows}
                      </tbody>
                    </table>
                  </div>
                `
                : `<div class="empty">No history rows loaded for the current scope.</div>`
        }
      </div>
    `;
  }

  _metric(label, value) {
    return `
      <div class="metric">
        <div class="metric-label">${this._escape(label)}</div>
        <div class="metric-value">${this._escape(value)}</div>
      </div>
    `;
  }

  async _reloadHistory() {
    const url = this._historyUrl();
    if (!url || this._historyLoading) return;
    this._historyLoading = true;
    this._historyLoadError = "";
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      this._historyData = data;
      this._writeLocalHistory(data);
    } catch (error) {
      const cached = this._readLocalHistory();
      if (cached && cached.scopes && Object.keys(cached.scopes).length) {
        this._historyData = cached;
        this._historyLoadError = "";
      } else {
        this._historyLoadError = String(error?.message || error);
        this._historyData = null;
      }
    } finally {
      this._historyLoading = false;
      this.render();
    }
  }

  async _copyText(text, label) {
    const value = String(text ?? "");
    if (!value) {
      this._status = `${label} is empty`;
      this._statusKind = "error";
      this.render();
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      this._status = `${label} copied`;
      this._statusKind = "success";
    } catch (err) {
      this._status = `Copy failed for ${label}: ${String(err?.message || err)}`;
      this._statusKind = "error";
    }
    this.render();
  }

  async _requestArchiveProbe(force = false) {
    const history = this._history();
    const selectorAttrs = this._attrs();
    const reportAttrs = this._reportAttrs();
    const scopeKey = String(history.current_scope || reportAttrs.current_scope || selectorAttrs.current_scope || "all").trim() || "all";
    const entryId = String(history.entry_id || reportAttrs.entry_id || selectorAttrs.entry_id || "").trim();
    const range = this._debugRange();
    const startDate = this._formatLocalDate(range.window.start);
    const endDate = this._formatLocalDate(range.window.end);
    this._status = `Requested ${force ? "forced " : ""}archive probe for ${scopeKey} ${this._debugPeriod} ${startDate} -> ${endDate}`;
    this._statusKind = "loading";
    this.render();
    try {
      const payload = {
        scope_key: scopeKey,
        start_date: startDate,
        end_date: endDate,
        force: Boolean(force),
      };
      if (entryId) payload.entry_id = entryId;
      await this._hass.callService("bytewatt", "ensure_report_history", payload);
      this._status = `${force ? "Forced " : ""}archive probe sent for ${scopeKey} ${this._debugPeriod} ${startDate} -> ${endDate}`;
      this._statusKind = "success";
      if (this._historyConfigured()) {
        await this._reloadHistory();
      }
    } catch (err) {
      this._status = `Archive probe failed: ${String(err?.message || err)}`;
      this._statusKind = "error";
    }
    this.render();
  }

  async _requestSelectedDateDownload(force = true) {
    const history = this._history();
    const selectorAttrs = this._attrs();
    const reportAttrs = this._reportAttrs();
    const scopeKey = String(history.current_scope || reportAttrs.current_scope || selectorAttrs.current_scope || "all").trim() || "all";
    const entryId = String(history.entry_id || reportAttrs.entry_id || selectorAttrs.entry_id || "").trim();
    const selectedDate = this._selectedHistoryDateKey();
    if (!selectedDate) {
      this._status = "No selected date available to download";
      this._statusKind = "error";
      this.render();
      return;
    }
    this._status = `Requested ${force ? "forced " : ""}download for ${scopeKey} ${selectedDate}`;
    this._statusKind = "loading";
    this.render();
    try {
      const payload = {
        scope_key: scopeKey,
        start_date: selectedDate,
        end_date: selectedDate,
        force: Boolean(force),
      };
      if (entryId) payload.entry_id = entryId;
      await this._hass.callService("bytewatt", "ensure_report_history", payload);
      this._status = `${force ? "Forced " : ""}download sent for ${scopeKey} ${selectedDate}`;
      this._statusKind = "success";
      if (this._historyConfigured()) {
        await this._reloadHistory();
      }
    } catch (err) {
      this._status = `Selected date download failed: ${String(err?.message || err)}`;
      this._statusKind = "error";
    }
    this.render();
  }

  render() {
    if (!this._hass || !this._config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });

    const selector = this._selectorState();
    const attrs = this._attrs();
    const reportTarget = this._reportState();
    const reportAttrs = this._reportAttrs();
    const reporting = this._reporting();
    const history = this._history();
    const reportingMeta = reporting.meta || {};
    const historyKey = `${this._historyUrl()}|${this._historyScopeKey()}`;
    if (historyKey !== this._historySourceKey) {
      this._historySourceKey = historyKey;
      this._historyData = null;
      this._historyLoadError = "";
    }
    if (this._historyConfigured() && !this._historyData && !this._historyLoading) {
      this._reloadHistory();
    }
    const historyUrl = history.base_url || history.url || "";
    const statusClass = this._statusKind;
    const range = this._debugRange();
    const rangeLabel = `${this._formatDisplayDate(range.window.start)} to ${this._formatDisplayDate(range.window.end)}`;
    const showShiftControls = this._debugPeriod !== "today";
    const todayValue = this._formatLocalDate(this._todayLocalDate());

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          --bg: #f7f7f8;
          --panel: #ffffff;
          --line: #d9dee7;
          --text: #172033;
          --muted: #64748b;
          --accent: #2f75d8;
          --good: #237a3d;
          --warn: #916000;
          --bad: #b04141;
        }
        ha-card {
          background:
            radial-gradient(circle at top right, rgba(47, 117, 216, 0.08), transparent 24%),
            linear-gradient(180deg, #fafafa 0%, #f1f4f8 100%);
          color: var(--text);
          border: 1px solid var(--line);
          border-radius: 20px;
          box-shadow: 0 16px 34px rgba(15, 23, 42, 0.08);
          overflow: hidden;
        }
        .shell {
          display: grid;
          gap: 14px;
          padding: 16px;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
        }
        .title {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 1.2rem;
          font-weight: 900;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 4px 10px;
          border-radius: 999px;
          border: 1px solid var(--line);
          background: #eef2f7;
          color: #475569;
          font-size: 0.78rem;
          font-weight: 800;
        }
        .button {
          border: 1px solid rgba(47, 117, 216, 0.2);
          background: #fff;
          color: var(--accent);
          padding: 8px 12px;
          border-radius: 999px;
          font-weight: 800;
          cursor: pointer;
        }
        .button-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 10px;
        }
        .header-actions {
          margin-bottom: 0;
        }
        .button.secondary {
          color: #334155;
          border-color: rgba(100, 116, 139, 0.22);
        }
        .button.secondary.shift-button {
          min-width: 40px;
          padding-inline: 10px;
        }
        .controls {
          display: grid;
          gap: 10px;
        }
        .control-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
        }
        .period-button {
          border: 1px solid rgba(47, 117, 216, 0.2);
          background: #fff;
          color: #334155;
          padding: 7px 12px;
          border-radius: 999px;
          font-weight: 800;
          cursor: pointer;
        }
        .period-button.active {
          background: var(--accent);
          color: #fff;
          border-color: var(--accent);
        }
        .date-input {
          border: 1px solid var(--line);
          border-radius: 12px;
          padding: 7px 10px;
          font: inherit;
          font-weight: 700;
          color: var(--text);
          background: #fff;
        }
        .range-pill {
          display: inline-flex;
          align-items: center;
          padding: 7px 10px;
          border-radius: 999px;
          border: 1px solid rgba(47, 117, 216, 0.16);
          background: #eef5ff;
          color: #1d4f91;
          font-size: 0.82rem;
          font-weight: 800;
        }
        .grid {
          display: grid;
          gap: 12px;
        }
        .panel {
          background: var(--panel);
          border: 1px solid var(--line);
          border-radius: 16px;
          padding: 14px;
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.05);
        }
        .panel-title {
          font-size: 0.92rem;
          font-weight: 900;
          margin-bottom: 10px;
        }
        .line {
          display: grid;
          grid-template-columns: 170px minmax(0, 1fr);
          gap: 10px;
          padding: 6px 0;
          border-top: 1px solid rgba(15, 23, 42, 0.06);
        }
        .line:first-of-type {
          border-top: 0;
          padding-top: 0;
        }
        .label {
          color: var(--muted);
          font-size: 0.82rem;
          font-weight: 800;
          word-break: break-word;
        }
        .value {
          color: var(--text);
          font-size: 0.84rem;
          font-weight: 700;
          word-break: break-word;
        }
        .status {
          padding: 10px 12px;
          border-radius: 14px;
          font-size: 0.88rem;
          font-weight: 800;
          border: 1px solid var(--line);
          background: #f4f7fb;
        }
        .status.loading { background: #fff4de; color: var(--warn); }
        .status.success { background: #e8f7ee; color: var(--good); }
        .status.error { background: #fdecec; color: var(--bad); }
        .json {
          margin: 0;
          padding: 12px;
          border-radius: 14px;
          border: 1px solid var(--line);
          background: #0f172a;
          color: #e2e8f0;
          overflow: auto;
          max-height: 240px;
          font-size: 0.76rem;
          line-height: 1.45;
          white-space: pre;
        }
        .history-panel {
          display: grid;
          gap: 12px;
        }
        .panel-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
        }
        .panel-date {
          color: var(--muted);
          font-size: 0.86rem;
          font-weight: 700;
        }
        .history-controls {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .history-pill {
          border: 1px solid rgba(47, 117, 216, 0.18);
          background: #f4f7fb;
          color: #475569;
          padding: 7px 12px;
          border-radius: 999px;
          font-weight: 800;
          cursor: pointer;
        }
        .history-pill.active {
          background: #101828;
          color: #fff;
          border-color: #101828;
        }
        .history-overview {
          border: 1px solid rgba(47, 117, 216, 0.12);
          background: #fbfcff;
          border-radius: 16px;
          padding: 12px;
          display: grid;
          gap: 12px;
        }
        .history-overview-head,
        .history-table-head {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
          flex-wrap: wrap;
        }
        .history-overview-title,
        .history-table-title {
          font-weight: 900;
          font-size: 0.92rem;
        }
        .history-overview-subtitle,
        .history-table-subtitle {
          color: var(--muted);
          font-size: 0.78rem;
          font-weight: 700;
        }
        .history-overview-grid {
          display: grid;
          gap: 10px;
          grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
        }
        .history-overview-card {
          border: 1px solid var(--line);
          border-radius: 14px;
          background: #fff;
          padding: 10px 12px;
          display: grid;
          gap: 6px;
        }
        .history-overview-card.active {
          border-color: rgba(47, 117, 216, 0.35);
          box-shadow: inset 0 0 0 1px rgba(47, 117, 216, 0.12);
        }
        .history-overview-card-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .history-overview-card-title {
          font-weight: 900;
          font-size: 0.88rem;
        }
        .history-overview-card-badge {
          font-size: 0.75rem;
          font-weight: 900;
          color: #1d4f91;
          background: #eef5ff;
          border-radius: 999px;
          padding: 3px 8px;
        }
        .history-overview-card-meta {
          font-size: 0.76rem;
          font-weight: 700;
          color: var(--muted);
        }
        .history-summary {
          display: grid;
          gap: 8px;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        }
        .metric {
          border: 1px solid var(--line);
          border-radius: 14px;
          background: #fff;
          padding: 10px 12px;
          display: grid;
          gap: 4px;
        }
        .metric-label {
          color: var(--muted);
          font-size: 0.76rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .metric-value {
          font-size: 0.92rem;
          font-weight: 900;
          color: var(--text);
        }
        .history-table-wrap {
          overflow: auto;
          border: 1px solid var(--line);
          border-radius: 14px;
          background: #fff;
        }
        .history-table {
          width: 100%;
          border-collapse: collapse;
          min-width: 560px;
          font-size: 0.82rem;
        }
        .history-table th,
        .history-table td {
          padding: 9px 10px;
          border-bottom: 1px solid rgba(15, 23, 42, 0.06);
          text-align: left;
          white-space: nowrap;
        }
        .history-table th {
          background: #f8fafc;
          color: var(--muted);
          font-weight: 900;
        }
        .empty {
          border: 1px dashed rgba(100, 116, 139, 0.3);
          border-radius: 14px;
          padding: 14px;
          color: var(--muted);
          background: #fafbfc;
          font-weight: 700;
        }
      </style>
      <ha-card>
        <div class="shell">
          <div class="header">
            <div class="title">
              <span>BW</span>
              <span>${this._escape(this._config.title)}</span>
              <span class="badge">v${BYTEWATT_DEBUG_CARD_BUILD}</span>
            </div>
            <div class="button-row header-actions">
              <button class="button" type="button" id="probe-button">Probe archive</button>
              <button class="button secondary" type="button" id="hard-refresh-button">Hard refresh</button>
            </div>
          </div>

          ${this._status ? `<div class="status ${statusClass}">${this._escape(this._status)}</div>` : ""}

          ${this._renderSelector()}

          <div class="panel">
            <div class="panel-title">Archive Selection</div>
            <div class="controls">
              <div class="control-row">
                <button class="period-button ${this._debugPeriod === "today" ? "active" : ""}" type="button" data-debug-period="today">Today</button>
                <button class="period-button ${this._debugPeriod === "day" ? "active" : ""}" type="button" data-debug-period="day">Day</button>
                <button class="period-button ${this._debugPeriod === "week" ? "active" : ""}" type="button" data-debug-period="week">Week</button>
                <button class="period-button ${this._debugPeriod === "month" ? "active" : ""}" type="button" data-debug-period="month">Month</button>
                <button class="period-button ${this._debugPeriod === "quarter" ? "active" : ""}" type="button" data-debug-period="quarter">Quarter</button>
              </div>
              <div class="control-row">
                <input class="date-input" type="date" data-debug-date value="${this._escape(range.displayDate)}" max="${this._escape(todayValue)}" />
                ${showShiftControls ? `<button class="button secondary shift-button" type="button" data-debug-shift="-1">&lt;</button>` : ""}
                ${showShiftControls ? `<button class="button secondary shift-button" type="button" data-debug-shift="1">&gt;</button>` : ""}
                <span class="range-pill">${this._escape(rangeLabel)}</span>
              </div>
            </div>
          </div>

          ${this._renderHistoryPanel()}

          <div class="grid">
            <div class="panel">
              <div class="panel-title">Target Entity</div>
              <div class="button-row">
                <button class="button secondary" type="button" data-copy="entity">Copy entity</button>
                <button class="button secondary" type="button" data-copy="attrs">Copy attributes</button>
              </div>
              ${this._summaryLine("Entity", this._config.settings_target)}
              ${this._summaryLine("State", selector?.state)}
              ${this._summaryLine("Last changed", this._fmtTime(selector?.last_changed))}
              ${this._summaryLine("Last updated", this._fmtTime(selector?.last_updated))}
            </div>

            <div class="panel">
              <div class="panel-title">Archive Metadata</div>
              <div class="button-row">
                <button class="button secondary" type="button" data-copy="history">Copy history</button>
                <button class="button secondary" type="button" data-copy="report-attrs">Copy report attrs</button>
              </div>
              ${this._summaryLine("History configured", Boolean(history.enabled || history.base_url || history.entry_id) ? "yes" : "no")}
              ${this._summaryLine("Entry ID", history.entry_id || "-")}
              ${this._summaryLine("Current scope", history.current_scope || attrs.current_scope || "-")}
              ${this._summaryLine("History URL", history.base_url || historyUrl || "-")}
              ${this._summaryLine("Settings history keys", Object.keys(attrs.history || {}).join(", ") || "-")}
              ${this._summaryLine("Report entity", this._reportTargetId())}
              ${this._summaryLine("Report state", reportTarget?.state)}
              ${this._summaryLine("Report history keys", Object.keys(reportAttrs.history || {}).join(", ") || "-")}
              ${this._summaryLine("Selected period", this._debugPeriod)}
              ${this._summaryLine("Selected date", range.displayDate)}
              ${this._summaryLine("Selected range", rangeLabel)}
              ${this._summaryLine("Last ensure", this._json(history.last_ensure_result || {}))}
            </div>

            <div class="panel">
              <div class="panel-title">Reporting Summary</div>
              <div class="button-row">
                <button class="button secondary" type="button" data-copy="reporting">Copy reporting</button>
                <button class="button secondary" type="button" data-copy="power-diagram">Copy power diagram</button>
              </div>
              ${this._summaryLine("Selected report date", range.displayDate || "-")}
              ${this._summaryLine("Live reporting date", reporting.reporting_date || reportingMeta.reporting_date || "-")}
              ${this._summaryLine("Label", reporting.label || "-")}
              ${this._summaryLine("Aggregate", reporting.aggregate ? "true" : "false")}
              ${this._summaryLine("Saved at", reportingMeta.saved_at || "-")}
              ${this._summaryLine("Live power source", reporting.live?.power_source || "-")}
              ${this._summaryLine("Today solar", reporting.today?.solar_generation ?? "-")}
              ${this._summaryLine("Today load", reporting.today?.load_consumption ?? "-")}
            </div>

            <div class="panel">
              <div class="panel-title">Raw Attributes</div>
              <pre class="json">${this._escape(this._json(attrs))}</pre>
            </div>

            <div class="panel">
              <div class="panel-title">Raw Reporting</div>
              <pre class="json">${this._escape(this._json(reporting))}</pre>
            </div>
          </div>
        </div>
      </ha-card>
    `;

    const button = this.shadowRoot.querySelector("#probe-button");
    if (button) {
      button.onclick = () => this._requestArchiveProbe(true);
    }

    const hardRefreshButton = this.shadowRoot.querySelector("#hard-refresh-button");
    if (hardRefreshButton) {
      hardRefreshButton.onclick = () => this._hardRefresh();
    }

    const forceSelectedDateDownloadButton = this.shadowRoot.querySelector("#force-selected-date-download");
    if (forceSelectedDateDownloadButton) {
      forceSelectedDateDownloadButton.onclick = () => this._requestSelectedDateDownload(true);
    }

    this.shadowRoot.querySelector("[data-select-target]")?.addEventListener("change", async (event) => {
      try {
        await this._hass.callService("select", "select_option", {
          entity_id: this._config.settings_target,
          option: event.target.value,
        });
      } finally {
        this._historySourceKey = "";
        this._historyData = null;
        this.render();
      }
    });

    this.shadowRoot.querySelectorAll("[data-debug-period]").forEach((item) => {
      item.onclick = () => {
        this._debugPeriod = item.getAttribute("data-debug-period") || "day";
        if (this._debugPeriod === "today") {
          this._debugAnchorDate = this._formatLocalDate(this._todayLocalDate());
        }
        this._saveDebugState();
        this.render();
      };
    });
    this.shadowRoot.querySelector("[data-debug-date]")?.addEventListener("change", (event) => {
      const picked = this._parseLocalDate(String(event.target.value || "").trim());
      this._debugAnchorDate = this._formatLocalDate(this._clampDateToToday(picked || this._todayLocalDate()));
      this._saveDebugState();
      this.render();
    });
    this.shadowRoot.querySelectorAll("[data-debug-shift]").forEach((item) => {
      item.onclick = () => {
        const step = Number(item.getAttribute("data-debug-shift") || 0) || 0;
        const next = this._shiftAnchor(this._debugRange().anchor, this._debugPeriod || "day", step);
        this._debugAnchorDate = this._formatLocalDate(this._clampDateToToday(next));
        this._saveDebugState();
        this.render();
      };
    });
    this.shadowRoot.querySelectorAll("[data-copy]").forEach((item) => {
      item.onclick = () => {
        const key = item.getAttribute("data-copy");
        if (key === "entity") {
          this._copyText(this._json({
            entity: this._config.settings_target,
            state: selector?.state,
            last_changed: selector?.last_changed,
            last_updated: selector?.last_updated,
          }), "Entity state");
          return;
        }
        if (key === "attrs") {
          this._copyText(this._json({
            settings_target: this._config.settings_target,
            settings_state: selector?.state,
            settings_last_changed: selector?.last_changed,
            settings_last_updated: selector?.last_updated,
            settings_attributes: attrs,
            report_target: this._reportTargetId(),
            report_state: reportTarget?.state,
            report_last_changed: reportTarget?.last_changed,
            report_last_updated: reportTarget?.last_updated,
            report_attributes: reportAttrs,
          }), "Attributes");
          return;
        }
        if (key === "history") {
          this._copyText(this._json(history), "Archive metadata");
          return;
        }
        if (key === "report-attrs") {
          this._copyText(this._json({
            report_target: this._reportTargetId(),
            report_state: reportTarget?.state,
            report_last_changed: reportTarget?.last_changed,
            report_last_updated: reportTarget?.last_updated,
            report_attributes: reportAttrs,
          }), "Report attributes");
          return;
        }
        if (key === "reporting") {
          this._copyText(this._json(this._selectedReportSnapshot(reporting)), "Reporting");
          return;
        }
        if (key === "power-diagram") {
          this._copyText(this._json(this._selectedReportSnapshot(reporting)?.power_diagram || {}), "Power diagram");
          return;
        }
        if (key === "selected-date") {
          this._copyText(this._json(this._selectedHistoryRecordInfo()), "Selected date");
          return;
        }
        if (key === "selected-date-power") {
          this._copyText(this._json(this._powerDiagramFromRecord(this._selectedHistoryRecordInfo().record || {})), "Selected date power");
        }
      };
    });
  }
}

if (!customElements.get("bytewatt-debug-card")) {
  customElements.define("bytewatt-debug-card", ByteWattDebugCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "bytewatt-debug-card",
  name: "ByteWatt Debug Card",
  description: `ByteWatt debug card build ${BYTEWATT_DEBUG_CARD_BUILD}.`,
});
