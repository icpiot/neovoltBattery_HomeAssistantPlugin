const BYTEWATT_REPORT_CARD_BUILD = "235";

class ByteWattReportCard extends HTMLElement {
  setConfig(config) {
    const prefix = config?.entity_prefix || "house_bytewatt_battery_system";
    this._config = {
      entity_prefix: prefix,
      settings_target: config?.settings_target || `select.${prefix}_settings_target`,
      ...config,
    };
    this._reportStorageKey = `bytewatt-report:${this._config.entity_prefix}:${this._config.settings_target}`;
    this._chartStorageKey = `bytewatt-chart:${this._config.entity_prefix}:${this._config.settings_target}`;
    const saved = this._loadReportState();
    this._reportPeriod = saved.period || this._reportPeriod || "day";
    this._reportAnchorDate = saved.anchor || this._reportAnchorDate || "";
    this._chartState = this._loadChartState();
    this._historyPeriod = this._historyPeriod || "7d";
    this._historyLoading = false;
    this._historyData = this._historyData || null;
    this._historyLoadError = this._historyLoadError || "";
    this._historyAttempted = this._historyAttempted || false;
    this._historySourceKey = this._historySourceKey || "";
    this._historyEnsureLoading = this._historyEnsureLoading || false;
    this._historyEnsureAttemptKey = this._historyEnsureAttemptKey || "";
    this._historyEnsureStatus = this._historyEnsureStatus || "";
    this._historyEnsureState = this._historyEnsureState || "";
    this._historyEnsureRunId = this._historyEnsureRunId || 0;
    this._historySyncLoading = this._historySyncLoading || false;
    this._historySyncRequested = this._historySyncRequested || false;
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

  _loadReportState() {
    try {
      if (!this._reportStorageKey || !window.localStorage) return {};
      const raw = window.localStorage.getItem(this._reportStorageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_err) {
      return {};
    }
  }

  _saveReportState() {
    try {
      if (!this._reportStorageKey || !window.localStorage) return;
      window.localStorage.setItem(
        this._reportStorageKey,
        JSON.stringify({
          period: this._reportPeriod || "day",
          anchor: this._reportAnchorDate || "",
        }),
      );
    } catch (_err) {
      return;
    }
  }

  _defaultChartVisibility() {
    return {
      bat: true,
      solar: true,
      load: true,
      feed: true,
      consumed: true,
      grid: true,
    };
  }

  _loadChartState() {
    try {
      if (!this._chartStorageKey || !window.localStorage) return { visibility: this._defaultChartVisibility() };
      const raw = window.localStorage.getItem(this._chartStorageKey);
      if (!raw) return { visibility: this._defaultChartVisibility() };
      const parsed = JSON.parse(raw);
      const visibility = parsed?.visibility && typeof parsed.visibility === "object" ? parsed.visibility : {};
      return {
        visibility: {
          ...this._defaultChartVisibility(),
          ...visibility,
        },
      };
    } catch (_err) {
      return { visibility: this._defaultChartVisibility() };
    }
  }

  _saveChartState() {
    try {
      if (!this._chartStorageKey || !window.localStorage) return;
      window.localStorage.setItem(this._chartStorageKey, JSON.stringify(this._chartState || { visibility: this._defaultChartVisibility() }));
    } catch (_err) {
      return;
    }
  }

  _chartVisibility() {
    return {
      ...this._defaultChartVisibility(),
      ...((this._chartState && typeof this._chartState.visibility === "object") ? this._chartState.visibility : {}),
    };
  }

  _setChartSeriesVisible(key, visible) {
    const next = this._chartVisibility();
    next[key] = Boolean(visible);
    this._chartState = { visibility: next };
    this._saveChartState();
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
    const attrs = this._selectorState()?.attributes || {};
    const direct = attrs.history;
    if (direct && typeof direct === "object") return direct;
    const fallback = attrs.reporting?.meta?.history;
    return fallback && typeof fallback === "object" ? fallback : {};
  }

  _historyEnsureResult() {
    const value = this._historyMeta()?.last_ensure_result;
    return value && typeof value === "object" ? value : {};
  }

  _historyScopeKey() {
    const history = this._historyMeta();
    const currentScope = String(history.current_scope || "").trim();
    return currentScope || "all";
  }

  _historyConfigured() {
    const history = this._historyMeta();
    return Boolean(history?.enabled || history?.base_url || history?.entry_id);
  }

  _historyScopes() {
    const localScopes = this._readLocalSnapshots()?.scopes;
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
      scopes[scopeKey] = {
        ...current,
        ...scopeValue,
        records: {
          ...currentRecords,
          ...incomingRecords,
        },
      };
    });
    merged.scopes = scopes;
    return merged;
  }

  _localSnapshotKey() {
    const entity = String(this._config?.settings_target || "bytewatt").replace(/[^A-Za-z0-9_.-]+/g, "_");
    return `bytewatt-report-history:${entity}`;
  }

  _readLocalSnapshots() {
    try {
      const raw = window.localStorage?.getItem(this._localSnapshotKey());
      if (!raw) return { scopes: {} };
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : { scopes: {} };
    } catch (_err) {
      return { scopes: {} };
    }
  }

  _writeLocalSnapshots(data) {
    try {
      const merged = this._mergeSnapshotPayload(this._readLocalSnapshots(), data);
      window.localStorage?.setItem(this._localSnapshotKey(), JSON.stringify(merged));
    } catch (_err) {
      // Browser storage can be disabled; HA archive remains the primary source.
    }
  }

  _storeLiveReportingSnapshot(reporting) {
    const liveRecord = this._liveReportingRecord(reporting);
    if (!liveRecord?.record_date) return null;
    const history = this._readLocalSnapshots();
    history.scopes = history.scopes || {};
    const scopeKeys = Array.from(new Set([this._historyScopeKey(), "all"].filter(Boolean)));
    scopeKeys.forEach((scopeKey) => {
      const scope = history.scopes[scopeKey] || { records: {} };
      scope.records = scope.records || {};
      scope.records[liveRecord.record_date] = {
        ...reporting,
        reporting_date: liveRecord.record_date,
        record_date: liveRecord.record_date,
        meta: {
          ...(reporting?.meta || {}),
          reporting_date: liveRecord.record_date,
        },
      };

      const keys = Object.keys(scope.records).sort();
      while (keys.length > 400) {
        const oldest = keys.shift();
        if (oldest) delete scope.records[oldest];
      }
      history.scopes[scopeKey] = scope;
    });
    history.updated = new Date().toISOString();
    this._writeLocalSnapshots(history);
    return liveRecord;
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

  _historyUrl() {
    const history = this._historyMeta();
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

  _niceChartMax(value, floor = 0.1) {
    const number = Math.max(this._parseFloat(value), 0);
    if (!(number > 0)) return floor;
    const exponent = Math.floor(Math.log10(number));
    const magnitude = 10 ** exponent;
    const normalized = number / magnitude;
    const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return Math.max(floor, niceNormalized * magnitude);
  }

  _parseSeriesList(value) {
    if (Array.isArray(value)) {
      return value.map((item) => this._parseFloat(item));
    }
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed.map((item) => this._parseFloat(item));
        }
      } catch (error) {
        return [];
      }
    }
    return [];
  }

  _parseList(value) {
    if (Array.isArray(value)) {
      return value.slice();
    }
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed.slice();
        }
      } catch (error) {
        return [];
      }
    }
    return [];
  }

  _sumSeries(value) {
    return this._parseSeriesList(value).reduce((acc, item) => acc + this._parseFloat(item), 0);
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

  _periodCounterSummary(records, window) {
    const sorted = (records || [])
      .filter((record) => record && record.record_date)
      .slice()
      .sort((a, b) => String(a.record_date).localeCompare(String(b.record_date)));
    const start = window?.start instanceof Date ? window.start : null;
    const end = window?.end instanceof Date ? window.end : null;
    const empty = {
      valid: false,
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
    if (!start || !end || !sorted.length) return empty;

    let before = null;
    let latest = null;
    sorted.forEach((record) => {
      const date = this._parseLocalDate(record.record_date);
      if (!date) return;
      if (date < start) before = record;
      if (date >= start && date <= end) latest = record;
    });
    if (!latest || !before) return empty;

    const delta = (paths) => {
      const startValue = this._recordFloat(before, paths);
      const endValue = this._recordFloat(latest, paths);
      if (!Number.isFinite(startValue) || !Number.isFinite(endValue)) return 0;
      return Math.max(endValue - startValue, 0);
    };

    return {
      valid: true,
      total_solar_generation: delta([["total_solar_generation"], ["totals", "solar_generation"]]),
      total_feed_in: delta([["total_feed_in"], ["totals", "feed_in"]]),
      total_battery_charge: delta([["total_battery_charge"], ["totals", "battery_charge"]]),
      total_battery_discharge: delta([["total_battery_discharge"], ["totals", "battery_discharge"]]),
      total_house_consumption: delta([["total_house_consumption"], ["totals", "house_consumption"]]),
      total_grid_consumption: delta([["total_grid_consumption"], ["totals", "grid_consumption"]]),
      pv_power_house: delta([["pv_power_house"], ["totals", "pv_power_house"]]),
      pv_charging_battery: delta([["pv_charging_battery"], ["totals", "pv_charging_battery"]]),
      grid_battery_charge: delta([["grid_battery_charge"], ["totals", "grid_battery_charge"]]),
    };
  }

  async _ensureHistoryLoaded() {
    await this._reloadHistory();
  }

  async _reloadHistory() {
    const url = this._historyUrl();
    if (!url || this._historyLoading) return;
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
      this._writeLocalSnapshots(data);
      this._historySyncRequested = true;
    } catch (error) {
      const cached = this._readLocalSnapshots();
      if (cached && cached.scopes && Object.keys(cached.scopes).length) {
        this._historyData = cached;
        this._historyLoadError = "";
        this._historySyncRequested = true;
      } else {
        this._historyLoadError = String(error?.message || error);
        this._historyData = null;
      }
    } finally {
      this._historyLoading = false;
      this.render();
    }
  }

  _historyEntryId() {
    return String(this._historyMeta()?.entry_id || "").trim();
  }

  _hasExactHistoryRecord(scopeKey, recordDate) {
    if (!scopeKey || !recordDate) return false;
    const scopes = this._historyScopes();
    return Boolean(scopes?.[scopeKey]?.records?.[recordDate]);
  }

  _hasKnownHistoryDate(scopeKey, recordDate) {
    if (!scopeKey || !recordDate) return false;
    const scopes = this._historyScopes();
    return Boolean(scopes?.[scopeKey]?.records?.[recordDate] || scopes?.[scopeKey]?.missing_dates?.[recordDate]);
  }

  _resetHistoryEnsureState() {
    this._historyEnsureRunId += 1;
    this._historyEnsureLoading = false;
    this._historyEnsureAttemptKey = "";
    this._historyEnsureStatus = "";
    this._historyEnsureState = "";
  }

  _queueHistorySync() {
    this._historySyncRequested = true;
    this.render();
  }

  _selectedReportWindow() {
    const records = this._historyRecords().sort((a, b) => String(a.record_date).localeCompare(String(b.record_date)));
    const fallbackAnchor =
      this._parseLocalDate(this._reportAnchorDate) ||
      this._parseLocalDate(this._reporting()?.power_diagram?.date) ||
      this._parseLocalDate(this._reporting()?.reporting_date) ||
      this._parseLocalDate(this._reporting()?.meta?.reporting_date) ||
      this._parseLocalDate(this._historyRange(records).latest) ||
      new Date();
    const anchor = this._clampAnchor(fallbackAnchor, records);
    const period = this._reportPeriod || "day";
    return {
      anchor,
      period,
      window: this._periodWindow(anchor, period),
    };
  }

  async _syncSelectedHistory() {
    if (this._historySyncLoading) return;
    this._historySyncLoading = true;
    this._historySyncRequested = false;
    try {
      if (this._reportPeriod === "today") {
        this._historyEnsureLoading = false;
        this._historyEnsureState = "live";
        this._historyEnsureStatus = "Today uses live reporting";
        this.render();
        return;
      }
      if (this._historyConfigured() && !this._historyData && !this._historyLoading) {
        await this._reloadHistory();
      }
      if (this._historyConfigured()) {
        await this._ensureSelectedPeriodHistory();
      } else {
        this.render();
      }
    } finally {
      this._historySyncLoading = false;
    }
  }

  async _ensureSelectedPeriodHistory() {
    const runId = this._historyEnsureRunId;
    const scopeKey = this._historyScopeKey();
    const { anchor, period, window } = this._selectedReportWindow();
    if (period === "today") {
      this._historyEnsureState = "live";
      this._historyEnsureStatus = "Today uses live reporting";
      this.render();
      return;
    }
    if (!scopeKey || !anchor || this._historyLoading || this._historyEnsureLoading) return;

    const startDate = this._formatLocalDate(window.start);
    const today = this._todayLocalDate();
    const effectiveEnd = window.end > today ? today : window.end;
    const endDate = this._formatLocalDate(effectiveEnd);
    const ensureKey = `${scopeKey}|${period}|${startDate}|${endDate}`;
    if (this._historyEnsureAttemptKey === ensureKey && this._historyEnsureState) return;

    this._historyEnsureAttemptKey = ensureKey;
    this._historyEnsureState = "checking";
    this._historyEnsureStatus = `Checking selected ${period === "day" || period === "today" ? "day" : "period"} archive...`;
    this.render();

    const desiredDates = [];
    const cursor = new Date(window.start.getFullYear(), window.start.getMonth(), window.start.getDate());
    const end = new Date(effectiveEnd.getFullYear(), effectiveEnd.getMonth(), effectiveEnd.getDate());
    while (cursor <= end) {
      desiredDates.push(this._formatLocalDate(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }

    const availableCount = desiredDates.filter((date) => this._hasExactHistoryRecord(scopeKey, date)).length;
    const knownCount = desiredDates.filter((date) => this._hasKnownHistoryDate(scopeKey, date)).length;
    const hasAllKnown = knownCount === desiredDates.length;
    if (hasAllKnown) {
      this._historyEnsureState = availableCount === desiredDates.length ? "available" : "partial";
      this._historyEnsureStatus =
        availableCount === desiredDates.length
          ? "Selected period already in archive"
          : `Selected period partially available (${availableCount}/${desiredDates.length})`;
      this.render();
      return;
    }

    this._historyEnsureLoading = true;
    this._historyEnsureState = "downloading";
    this._historyEnsureStatus = `Downloading selected ${period === "day" || period === "today" ? "day" : "period"} archive...`;
    this.render();
    try {
      const payload = {
        scope_key: scopeKey,
        start_date: startDate,
        end_date: endDate,
      };
      const entryId = this._historyEntryId();
      if (entryId) payload.entry_id = entryId;
      await this._hass.callService("bytewatt", "ensure_report_history", payload);
      if (runId !== this._historyEnsureRunId) return;
      this._historyData = null;
      await this._reloadHistory();
      if (runId !== this._historyEnsureRunId) return;
      const refreshedAvailableCount = desiredDates.filter((date) => this._hasExactHistoryRecord(scopeKey, date)).length;
      const refreshedKnownCount = desiredDates.filter((date) => this._hasKnownHistoryDate(scopeKey, date)).length;
      if (refreshedKnownCount === 0) {
        this._historyEnsureState = "missing";
        this._historyEnsureStatus = "No archive rows available for selected period";
      } else if (refreshedKnownCount < desiredDates.length) {
        this._historyEnsureState = "partial";
        this._historyEnsureStatus = `Selected period partially available (${refreshedAvailableCount}/${desiredDates.length})`;
      } else {
        this._historyEnsureState = refreshedAvailableCount === desiredDates.length ? "ready" : "partial";
        this._historyEnsureStatus =
          refreshedAvailableCount === desiredDates.length
            ? "Selected period archive ready"
            : `Selected period partially available (${refreshedAvailableCount}/${desiredDates.length})`;
      }
    } catch (error) {
      console.warn("ByteWatt period archive download failed:", error);
      this._historyEnsureState = "failed";
      this._historyEnsureStatus = "Archive download failed";
    } finally {
      if (runId !== this._historyEnsureRunId) return;
      this._historyEnsureLoading = false;
      this.render();
    }
  }

  _historyRecords() {
    const scopeInfo = this._historyScopeData();
    const data = scopeInfo.scope?.records || {};
    return Object.entries(data).map(([recordDate, reporting]) => {
      const parsed = this._parseLocalDate(recordDate) || this._parseLocalDate(reporting?.reporting_date) || this._parseLocalDate(reporting?.power_diagram?.date);
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

  _liveReportingRecord(reporting) {
    if (!reporting) return null;
    const parsed =
      this._parseLocalDate(reporting?.power_diagram?.date) ||
      this._parseLocalDate(reporting?.reporting_date) ||
      this._parseLocalDate(reporting?.meta?.reporting_date) ||
      this._parseSavedAtLocalDate(reporting?.meta?.saved_at || reporting?.saved_at);
    if (!parsed) return null;
    const normalizedDate = this._formatLocalDate(parsed);
    return {
      ...(reporting || {}),
      record_date: normalizedDate,
      record_date_display: this._formatDisplayDate(parsed),
      record_date_raw: "live",
      live_record: true,
    };
  }

  _recordDisplayDate(record) {
    if (!record) return "";
    if (record.record_date_display) return String(record.record_date_display);
    const parsed = this._parseLocalDate(record.record_date);
    return parsed ? this._formatDisplayDate(parsed) : String(record.record_date || "");
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
    return { today: "Today", day: "Day", week: "Week", month: "Month", quarter: "Quarter" }[value] || "Day";
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
    const candidates = text.split(/\s*(?:->|to)\s*/i).filter(Boolean);
    const parseCandidate = (candidate) => {
      const trimmed = String(candidate || "").trim();
      const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (iso) {
        const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
        return Number.isNaN(date.getTime()) ? null : date;
      }
      const dmy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (dmy) {
        const date = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
        return Number.isNaN(date.getTime()) ? null : date;
      }
      return null;
    };
    for (const candidate of candidates.length ? candidates : [text]) {
      const parsed = parseCandidate(candidate);
      if (parsed) return parsed;
    }
    const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const date = new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    const dmyMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dmyMatch) {
      const date = new Date(Number(dmyMatch[3]), Number(dmyMatch[2]) - 1, Number(dmyMatch[1]));
      return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
  }

  _parseSavedAtLocalDate(value) {
    if (!value) return null;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    }
    return this._parseLocalDate(value);
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

  _historyBackfillDays() {
    const history = this._historyMeta();
    const rawDays = Number(history?.backfill_days ?? 0);
    if (Number.isFinite(rawDays) && rawDays > 0) return Math.max(1, Math.floor(rawDays));
    const rawYears = Number(history?.backfill_years ?? 0);
    if (Number.isFinite(rawYears) && rawYears > 0) return Math.max(1, Math.floor(rawYears * 365));
    return 365;
  }

  _historyScopeSummaries() {
    const scopes = this._historyScopes();
    const expectedCount = this._historyBackfillDays();
    const today = this._todayLocalDate();
    const expectedStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    expectedStart.setDate(expectedStart.getDate() - (expectedCount - 1));
    const inventoryScopes = Array.isArray(this._historyMeta()?.inventory_scopes) ? this._historyMeta().inventory_scopes : [];
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
      };
      current.label = String(label || current.label || scopeKey || "all");
      current.aggregate = Boolean(aggregate ?? current.aggregate);
      merged.set(scopeKey, current);
    };

    addScope("all", "All systems", true);
    inventoryScopes.forEach((item) => {
      const scopeKey = String(item?.scope_key || "").trim();
      if (!scopeKey) return;
      addScope(scopeKey, item?.label || scopeKey, Boolean(item?.aggregate));
    });
    Object.entries(scopes || {}).forEach(([scopeKey, scopeValue]) => {
      addScope(scopeKey, scopeValue?.label || scopeKey, scopeKey === "all" || Boolean(scopeValue?.aggregate));
    });

    Object.entries(scopes || {}).forEach(([scopeKey, scopeValue]) => {
      const current = merged.get(scopeKey) || {
        scope_key: scopeKey,
        label: String(scopeValue?.label || scopeKey || "all"),
        aggregate: scopeKey === "all",
      };
      const records = scopeValue?.records && typeof scopeValue.records === "object" ? scopeValue.records : {};
      const missing = scopeValue?.missing_dates && typeof scopeValue.missing_dates === "object" ? scopeValue.missing_dates : {};
      const recordDates = Object.keys(records).filter(Boolean).sort();
      const missingDates = Object.keys(missing).filter(Boolean).sort();
      const knownCount = new Set([...recordDates, ...missingDates]).size;
      const storedCount = recordDates.length;
      const missingCount = missingDates.length;
      const remainingCount = Math.max(expectedCount - knownCount, 0);
      const range = this._historyRange(recordDates.map((record_date) => ({ record_date })));
      merged.set(scopeKey, {
        ...current,
        scope_key: scopeKey,
        label: String(current.label || scopeValue?.label || scopeKey || "all"),
        aggregate: Boolean(scopeKey === "all" || current.aggregate || scopeValue?.aggregate),
        stored_count: storedCount,
        missing_count: missingCount,
        known_count: knownCount,
        expected_count: expectedCount,
        remaining_count: remainingCount,
        coverage_label: `${knownCount}/${expectedCount}`,
        first_date: range.first || "",
        latest_date: range.latest || "",
        expected_start: this._formatLocalDate(expectedStart),
        expected_end: this._formatLocalDate(today),
        active: scopeKey === this._historyScopeKey(),
      });
    });

    return Array.from(merged.values())
      .sort((a, b) => {
        if (a.scope_key === "all") return -1;
        if (b.scope_key === "all") return 1;
        return String(a.label).localeCompare(String(b.label));
      });
  }

  _periodWindow(anchor, period = this._reportPeriod) {
    const safeAnchor = this._clampDateToToday(anchor);
    const today = this._todayLocalDate();
    const start = new Date(safeAnchor.getFullYear(), safeAnchor.getMonth(), safeAnchor.getDate());
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
    if (start > today) {
      return { start: today, end: today };
    }
    return { start, end: end > today ? today : end };
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
    return this._clampDateToToday(shifted);
  }

  _clampAnchor(anchor, records) {
    return this._clampDateToToday(anchor);
  }

  _recordsForPeriod(records, anchor, period = this._reportPeriod) {
    if (!anchor) return records || [];
    const window = this._periodWindow(anchor, period);
    return (records || []).filter((record) => {
      const date = this._parseLocalDate(record?.record_date);
      return date && date >= window.start && date <= window.end;
    });
  }

  _expandDailyRecords(records, window) {
    const start = window?.start instanceof Date ? new Date(window.start.getFullYear(), window.start.getMonth(), window.start.getDate()) : null;
    const end = window?.end instanceof Date ? new Date(window.end.getFullYear(), window.end.getMonth(), window.end.getDate()) : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
      return records || [];
    }
    const mapped = new Map((records || []).map((record) => [String(record?.record_date || ""), record]));
    const expanded = [];
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    while (cursor <= end) {
      const key = this._formatLocalDate(cursor);
      expanded.push({
        record_date: key,
        record_date_display: this._formatDisplayDate(cursor),
        ...(mapped.get(key) || {}),
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return expanded;
  }

  _periodSummary(records) {
    return this._aggregateHistoryRecords(records || []);
  }

  _selectedPeriodEnergyModel(records, summary = {}) {
    const rows = (records || []).filter((record) => record && record.record_date);
    const totals = rows.reduce(
      (acc, record) => {
        acc.solar += Math.max(this._recordFloat(record, [["solar_generation_today"], ["today", "solar_generation"]]), 0);
        acc.load += Math.max(this._recordFloat(record, [["load_consumption_today"], ["today", "load_consumption"]]), 0);
        acc.feed += Math.max(this._recordFloat(record, [["feed_in_today"], ["today", "feed_in"]]), 0);
        acc.grid += Math.max(this._recordFloat(record, [["grid_consumption_today"], ["today", "grid_consumption"]]), 0);
        acc.batteryCharge += Math.max(this._recordFloat(record, [["battery_charged_today"], ["today", "battery_charge"]]), 0);
        acc.batteryDischarge += Math.max(this._recordFloat(record, [["battery_discharged_today"], ["today", "battery_discharge"]]), 0);
        acc.income += this._recordFloat(record, [["today_income"], ["today", "today_income"]]);
        return acc;
      },
      { solar: 0, load: 0, feed: 0, grid: 0, batteryCharge: 0, batteryDischarge: 0, income: 0 }
    );

    const solar = totals.solar;
    const load = totals.load;
    const feed = totals.feed;
    const grid = totals.grid;
    const batteryCharge = totals.batteryCharge;
    const batteryDischarge = totals.batteryDischarge;

    const batteryToLoad = Math.min(batteryDischarge, load);
    const gridToLoad = Math.min(grid, Math.max(load - batteryToLoad, 0));
    const solarToLoad = Math.min(solar, Math.max(load - batteryToLoad - gridToLoad, 0));
    const solarToBattery = Math.min(Math.max(solar - solarToLoad - feed, 0), batteryCharge);
    const gridToBattery = Math.min(
      Math.max(batteryCharge - solarToBattery, 0),
      Math.max(grid - gridToLoad, 0)
    );

    return {
      rows: rows.length,
      source: "daily-period",
      solar_generation: solar,
      load_consumption: load,
      feed_in: feed,
      grid_consumption: grid,
      battery_charge: batteryCharge,
      battery_discharge: batteryToLoad,
      pv_power_house: solarToLoad,
      pv_charging_battery: solarToBattery,
      grid_battery_charge: gridToBattery,
      grid_to_load: gridToLoad,
      today_income: totals.income,
      self_consumption: solar > 0 ? Math.max(((solar - feed) / solar) * 100, 0) : 0,
      self_sufficiency: load > 0 ? Math.max(((load - grid) / load) * 100, 0) : 0,
    };
  }

  _dailyLiveFallbackRecord(reporting, anchor, period = this._reportPeriod) {
    if (!reporting || !this._isDailyPeriod(period)) return null;
    const liveRecord = this._liveReportingRecord(reporting);
    const liveDate =
      liveRecord?.record_date ||
      this._formatLocalDate(
        this._parseLocalDate(reporting?.power_diagram?.date) ||
          this._parseLocalDate(reporting?.reporting_date) ||
          this._parseLocalDate(reporting?.meta?.reporting_date) ||
          new Date()
      );
    const anchorDate = this._formatLocalDate(anchor);
    if (period !== "today" && anchorDate && liveDate && anchorDate !== liveDate) return null;
    return {
      ...(reporting || {}),
      record_date: anchorDate || liveDate,
      record_date_display: this._formatDisplayDate(anchor || this._parseLocalDate(liveDate) || new Date()),
      record_date_raw: "live-fallback",
      live_record: true,
    };
  }

  _windowLiveFallbackRecord(reporting, window) {
    if (!reporting || !window?.start || !window?.end) return null;
    const liveRecord = this._liveReportingRecord(reporting);
    const liveDate = this._parseLocalDate(
      liveRecord?.record_date ||
      reporting?.power_diagram?.date ||
      reporting?.reporting_date ||
      reporting?.meta?.reporting_date
    );
    if (!liveDate) return null;
    if (liveDate < window.start || liveDate > window.end) return null;
    return {
      ...(reporting || {}),
      record_date: this._formatLocalDate(liveDate),
      record_date_display: this._formatDisplayDate(liveDate),
      record_date_raw: "window-live-fallback",
      live_record: true,
    };
  }

  _periodStatus(records, loading, error, context = {}) {
    if (loading) return "Downloading local archive...";
    if (error) return `Archive unavailable: ${error}`;
    const selectedCount = Number(context.selected_count ?? (records || []).length) || 0;
    const requestedCount = Number(context.requested_count ?? selectedCount) || 0;
    const missingCount = Number(context.missing_count ?? Math.max(requestedCount - selectedCount, 0)) || 0;
    const ensureStatus = String(context.ensure_status || "").trim();
    if (ensureStatus) return missingCount > 0 || !selectedCount ? ensureStatus : "";
    if (context.live_fallback) return "Live reporting shown while selected period archive catches up";
    if (!selectedCount) {
      return requestedCount > 0
        ? `No source data for selected period (${requestedCount} day(s) requested)`
        : "";
    }
    if (requestedCount > 0 && selectedCount < requestedCount) {
      return `Selected period partially available (${selectedCount}/${requestedCount}). No source data for ${missingCount} day(s).`;
    }
    return "";
  }

  _buildPeriodReporting(baseReporting) {
    this._storeLiveReportingSnapshot(baseReporting);
    const scopeInfo = this._historyScopeData();
    const historyRecords = this._historyRecords();
    const liveRecord = this._liveReportingRecord(baseReporting);
    const recordsByDate = new Map(historyRecords.map((record) => [String(record.record_date || ""), record]));
    if (liveRecord?.record_date) {
      recordsByDate.set(liveRecord.record_date, {
        ...(recordsByDate.get(liveRecord.record_date) || {}),
        ...liveRecord,
      });
    }
    const records = Array.from(recordsByDate.values());
    const sorted = records.slice().sort((a, b) => String(a.record_date).localeCompare(String(b.record_date)));
    const availableRange = this._historyRange(sorted);
    const debugBase = {
      history_scope: scopeInfo.key,
      requested_scope: scopeInfo.requested,
      scope_fallback: scopeInfo.fallback,
      archive_records_total: historyRecords.length,
      records_total: sorted.length,
      live_record_date: liveRecord?.record_date || "",
      available_first: availableRange.first || "",
      available_latest: availableRange.latest || "",
    };
    const fallbackDate = baseReporting?.power_diagram?.date || availableRange.latest || availableRange.first || "";
    if ((!this._reportAnchorDate || this._reportPeriod === "today") && fallbackDate) {
      this._reportAnchorDate = fallbackDate;
    }

    const liveAnchor =
      this._parseLocalDate(
        baseReporting?.power_diagram?.date ||
          baseReporting?.reporting_date ||
          baseReporting?.meta?.reporting_date ||
          liveRecord?.record_date ||
          fallbackDate ||
          new Date()
      ) || new Date();
    const anchor = this._clampAnchor(
      this._reportPeriod === "today"
        ? liveAnchor
        : this._parseLocalDate(this._reportAnchorDate || fallbackDate) || new Date(),
      sorted,
    );
    this._reportAnchorDate = this._formatLocalDate(anchor);
    this._saveReportState();
    const period = this._reportPeriod || "day";
    const selected = this._recordsForPeriod(sorted, anchor, period);
    const window = this._periodWindow(anchor, period);
    const chartRecords = this._isDailyPeriod(period)
      ? selected
      : this._expandDailyRecords(selected, window);
    if (!selected.length) {
      const fallbackRecord = this._dailyLiveFallbackRecord(baseReporting, anchor, period);
      if (fallbackRecord) {
        const fallbackSelected = [fallbackRecord];
        const fallbackSummary = this._periodSummary(fallbackSelected);
        const fallbackEnergyModel = this._selectedPeriodEnergyModel(fallbackSelected, fallbackSummary);
        this._reportAnchorDate = this._formatLocalDate(anchor);
        return {
          reporting: {
            ...(baseReporting || {}),
            aggregate: false,
            label: baseReporting?.label || "ByteWatt",
            meta: {
              ...(baseReporting?.meta || {}),
              aggregate: false,
              label: baseReporting?.label || "ByteWatt",
              period,
              period_label: this._reportPeriodLabel(period),
              period_start: this._formatLocalDate(window.start),
              period_end: this._formatLocalDate(window.end),
              saved_at: baseReporting?.meta?.saved_at || "",
            },
            live: baseReporting?.live || {},
            today: {
              ...(baseReporting?.today || {}),
              solar_generation: fallbackEnergyModel.solar_generation,
              load_consumption: fallbackEnergyModel.load_consumption,
              house_consumption: fallbackEnergyModel.load_consumption,
              feed_in: fallbackEnergyModel.feed_in,
              grid_consumption: fallbackEnergyModel.grid_consumption,
              battery_charge: fallbackEnergyModel.battery_charge,
              battery_discharge: fallbackEnergyModel.battery_discharge,
              pv_power_house: fallbackEnergyModel.pv_power_house,
              pv_charging_battery: fallbackEnergyModel.pv_charging_battery,
              grid_battery_charge: fallbackEnergyModel.grid_battery_charge,
              grid_to_load: fallbackEnergyModel.grid_to_load,
              today_income: fallbackEnergyModel.today_income,
            },
            totals: {
              ...(baseReporting?.today || {}),
              solar_generation: fallbackEnergyModel.solar_generation,
              load_consumption: fallbackEnergyModel.load_consumption,
              house_consumption: fallbackEnergyModel.load_consumption,
              feed_in: fallbackEnergyModel.feed_in,
              grid_consumption: fallbackEnergyModel.grid_consumption,
              battery_charge: fallbackEnergyModel.battery_charge,
              battery_discharge: fallbackEnergyModel.battery_discharge,
              pv_power_house: fallbackEnergyModel.pv_power_house,
              pv_charging_battery: fallbackEnergyModel.pv_charging_battery,
              grid_battery_charge: fallbackEnergyModel.grid_battery_charge,
              grid_to_load: fallbackEnergyModel.grid_to_load,
              today_income: fallbackEnergyModel.today_income,
            },
            sankey: fallbackEnergyModel,
            sankey_debug: {
              ...debugBase,
              rows: fallbackEnergyModel.rows,
              counter_rows: 0,
              source: "live-fallback",
              selected_records: 1,
              period,
              period_start: this._formatLocalDate(window.start),
              period_end: this._formatLocalDate(window.end),
            },
            power_diagram: fallbackRecord?.power_diagram || baseReporting?.power_diagram || {},
            summary: fallbackSummary,
          },
          records: fallbackSelected,
          chart_records: fallbackSelected,
          anchor,
          period,
          window,
          availableRange,
          records_total: sorted.length,
          history_scope: scopeInfo.key,
          requested_scope: scopeInfo.requested,
          summary: fallbackSummary,
          live_fallback: true,
        };
      }
      const periodLabel = this._reportPeriodLabel(period);
      const emptyEnergyModel = this._selectedPeriodEnergyModel([], {});
      const emptyToday = {
        solar_generation: 0,
        load_consumption: 0,
        house_consumption: 0,
        feed_in: 0,
        grid_consumption: 0,
        battery_charge: 0,
        battery_discharge: 0,
        pv_power_house: 0,
        pv_charging_battery: 0,
        grid_battery_charge: 0,
        grid_to_load: 0,
        self_consumption: 0,
        self_sufficiency: 0,
        today_income: 0,
      };
      this._reportAnchorDate = this._formatLocalDate(this._isDailyPeriod(period) ? anchor : window.start);
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
            period_start: this._formatLocalDate(window.start),
            period_end: this._formatLocalDate(window.end),
            saved_at: baseReporting?.meta?.saved_at || "",
          },
          live: baseReporting?.live || {},
          today: emptyToday,
          totals: { ...emptyToday },
          sankey: emptyEnergyModel,
          sankey_debug: {
            ...debugBase,
            rows: 0,
            counter_rows: 0,
            source: "no-selected-period",
            selected_records: 0,
            period,
            period_start: this._formatLocalDate(window.start),
            period_end: this._formatLocalDate(window.end),
          },
          power_diagram: {
            ...(baseReporting?.power_diagram || {}),
            date:
              this._isDailyPeriod(period)
                ? this._formatLocalDate(anchor)
                : `${this._formatLocalDate(window.start)} -> ${this._formatLocalDate(window.end)}`,
          },
        },
        records: selected,
        chart_records: selected,
        anchor,
        period,
        window,
        availableRange,
        records_total: sorted.length,
        history_scope: scopeInfo.key,
        requested_scope: scopeInfo.requested,
      };
    }

    const summary = this._periodSummary(selected);
    const counterSummary = this._periodCounterSummary(sorted, window);
    const latest = selected[selected.length - 1] || {};
    this._reportAnchorDate = this._formatLocalDate(this._isDailyPeriod(period) ? anchor : window.start);
    const live = latest.live || baseReporting?.live || {};
    const baseToday = baseReporting?.today || {};
    const energyModel = this._selectedPeriodEnergyModel(selected, summary, counterSummary);
    const periodToday = {
      solar_generation: energyModel.solar_generation,
      load_consumption: energyModel.load_consumption,
      house_consumption: energyModel.load_consumption,
      feed_in: energyModel.feed_in,
      grid_consumption: energyModel.grid_consumption,
      battery_charge: energyModel.battery_charge,
      battery_discharge: energyModel.battery_discharge,
      pv_power_house: energyModel.pv_power_house,
      pv_charging_battery: energyModel.pv_charging_battery,
      grid_battery_charge: energyModel.grid_battery_charge,
      grid_to_load: energyModel.grid_to_load,
      self_consumption:
        energyModel.solar_generation > 0
          ? energyModel.self_consumption
          : baseToday.self_consumption,
      self_sufficiency:
        energyModel.load_consumption > 0
          ? energyModel.self_sufficiency
          : baseToday.self_sufficiency,
      trees_planted: latest.trees_planted ?? baseToday.trees_planted,
      co2_reduction_tons: latest.co2_reduction_tons ?? baseToday.co2_reduction_tons,
      today_income: energyModel.today_income,
      total_income: this._isDailyPeriod(period)
        ? (this._recordValue(latest, [["total_income"], ["today", "total_income"]]) ?? baseToday.total_income)
        : this._recordValue(latest, [["total_income"], ["today", "total_income"]]) ?? baseToday.total_income,
    };
    const periodTotals = {
      ...periodToday,
    };
    const sankey = { ...energyModel };
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
        sankey,
        sankey_debug: {
          ...debugBase,
          rows: energyModel.rows,
          counter_rows: 0,
          source: energyModel.source,
          selected_records: selected.length,
          period,
          period_start: this._formatLocalDate(window.start),
          period_end: this._formatLocalDate(window.end),
        },
        power_diagram: latest.power_diagram || baseReporting?.power_diagram || {},
        summary,
      },
      records: selected,
      chart_records: chartRecords,
      anchor,
      period,
      window,
      availableRange,
      records_total: sorted.length,
      history_scope: scopeInfo.key,
      requested_scope: scopeInfo.requested,
      summary,
    };
  }

  _renderHistoryPanel() {
    const history = this._historyMeta();
    if (!this._historyConfigured()) return "";
    const records = this._selectedHistoryRecords();
    const summary = this._aggregateHistoryRecords(records);
    const scopeSummaries = this._historyScopeSummaries();
    const loading = this._historyLoading && !this._historyData;
    const error = this._historyLoadError;
    const formatHistoryDate = (value) => {
      const parsed = this._parseLocalDate(value);
      return parsed ? this._formatDisplayDate(parsed) : String(value || "");
    };
    const rowCount = Math.min(records.length, 10);
    const rows = records
      .slice(-rowCount)
      .map((record) => {
        const rowDate = this._recordDisplayDate(record) || record.record_date || "Unknown";
        const solar = record?.today?.solar_generation ?? record?.solar_generation_today ?? 0;
        const load = record?.today?.load_consumption ?? record?.load_consumption_today ?? 0;
        const feed = record?.today?.feed_in ?? record?.feed_in_today ?? 0;
        const grid = record?.today?.grid_consumption ?? record?.grid_consumption_today ?? 0;
        const charge = record?.today?.battery_charge ?? record?.battery_charged_today ?? 0;
        const discharge = record?.today?.battery_discharge ?? record?.battery_discharged_today ?? 0;
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
      <section class="history-panel">
        <div class="panel-header">
          <div class="panel-title">Local Archive</div>
          <div class="panel-date">
            ${this._escape(summary.first_date ? `${formatHistoryDate(summary.first_date)} -> ${formatHistoryDate(summary.latest_date || summary.first_date)}` : history.base_url || "")}
          </div>
        </div>
        <div class="history-controls">
          ${this._historyButton("7 days", "7d")}
          ${this._historyButton("30 days", "30d")}
          ${this._historyButton("All", "all")}
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
                      `
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
                    <div class="history-table-title">Archive Rows</div>
                    <div class="history-table-subtitle">Latest ${rowCount} row(s) for the selected scope</div>
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
          this._recordFloat(record, [["live_soc"], ["live", "soc"]]),
          this._recordFloat(record, [["solar_generation_today"], ["today", "solar_generation"]]),
          this._recordFloat(record, [["load_consumption_today"], ["today", "load_consumption"]]),
          this._recordFloat(record, [["battery_charged_today"], ["today", "battery_charge"]]),
          this._recordFloat(record, [["battery_discharged_today"], ["today", "battery_discharge"]]),
          this._recordFloat(record, [["feed_in_today"], ["today", "feed_in"]]),
          this._recordFloat(record, [["grid_consumption_today"], ["today", "grid_consumption"]]),
          this._recordFloat(record, [["pv_power_house"], ["totals", "pv_power_house"]]),
          this._recordFloat(record, [["pv_charging_battery"], ["totals", "pv_charging_battery"]]),
          this._recordFloat(record, [["grid_battery_charge"], ["totals", "grid_battery_charge"]]),
          this._recordFloat(record, [["today_income"], ["today", "today_income"]]),
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
    const selectedCount = (periodContext?.records || []).length;
    const showShiftControls = period !== "today";
    const requestedCount = periodContext?.window?.start && periodContext?.window?.end
      ? (() => {
          const start = new Date(periodContext.window.start.getFullYear(), periodContext.window.start.getMonth(), periodContext.window.start.getDate());
          const end = new Date(periodContext.window.end.getFullYear(), periodContext.window.end.getMonth(), periodContext.window.end.getDate());
          let count = 0;
          const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
          while (cursor <= end) {
            count += 1;
            cursor.setDate(cursor.getDate() + 1);
          }
          return Math.max(1, count);
        })()
      : selectedCount;
    const missingCount = Math.max(requestedCount - selectedCount, 0);
    const currentEnsureKey =
      periodContext?.window?.start && periodContext?.window?.end
        ? `${this._historyScopeKey()}|${period}|${this._formatLocalDate(periodContext.window.start)}|${this._formatLocalDate(periodContext.window.end)}`
        : "";
    const ensureStatus = currentEnsureKey && this._historyEnsureAttemptKey === currentEnsureKey ? this._historyEnsureStatus : "";
    const status = this._periodStatus(periodContext?.records || [], this._historyLoading && !this._historyData, this._historyLoadError, {
      selected_count: selectedCount,
      requested_count: requestedCount,
      missing_count: missingCount,
      live_fallback: periodContext?.live_fallback,
      ensure_status: ensureStatus,
    });
    const statusClass = this._historyLoading && !this._historyData
      ? "loading"
      : this._historyEnsureLoading
        ? "loading"
      : this._historyLoadError || this._historyEnsureState === "failed" || this._historyEnsureState === "missing"
          ? "error"
          : this._historyEnsureState === "available" || this._historyEnsureState === "ready" || this._historyEnsureState === "partial" || selectedCount
            ? "loaded"
            : "empty";
    const windowStart = periodContext?.window?.start || anchor;
    const displayDate = this._formatLocalDate(windowStart);
    const todayValue = this._formatLocalDate(this._todayLocalDate());
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
            ${this._reportPeriodButton("Quarter", "quarter", period)}
          </div>
        </div>
        <div class="report-control-row">
          ${showShiftControls ? `<button class="report-shift-button" type="button" data-report-shift="-1" aria-label="Previous period">&lt;</button>` : ""}
          <input class="report-date-input" type="date" data-report-date value="${this._escape(displayDate)}" max="${this._escape(todayValue)}" />
          ${showShiftControls ? `<button class="report-shift-button" type="button" data-report-shift="1" aria-label="Next period">&gt;</button>` : ""}
          ${
            status
              ? `<div class="report-status ${statusClass}">
                  ${this._escape(status)}
                  ${periodContext?.window?.start && periodContext?.window?.end ? ` <span>(selected ${selectedCount}/${requestedCount} | missing ${missingCount})</span>` : ""}
                  ${startLabel && endLabel ? ` <span>(${this._escape(startLabel)} to ${this._escape(endLabel)})</span>` : ""}
                </div>`
              : ""
          }
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

  _ring(label, value, kind) {
    return `
      <div class="ring-card ring-${kind}">
        <div class="ring-value">${value}</div>
        <div class="ring-label">${label}</div>
      </div>
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

  _chartLegendChip(label, tone) {
    return `<span class="legend-chip ${tone ? `legend-${tone}` : ""}">${this._escape(label)}</span>`;
  }

  _chartToggleChip(label, tone, key, active) {
    const stateClass = active ? "active" : "inactive";
    return `
      <button class="legend-chip legend-toggle legend-${tone} ${stateClass}" type="button" data-chart-toggle="${this._escape(key)}" aria-pressed="${active ? "true" : "false"}" title="${this._escape(label)}">
        <span class="legend-dot"></span>
        <span class="legend-text">${this._escape(label)}</span>
      </button>
    `;
  }

  _chartPath(values, width, height, padding, maxValue) {
    const usableWidth = Math.max(width - padding.left - padding.right, 1);
    const usableHeight = Math.max(height - padding.top - padding.bottom, 1);
    const divisor = maxValue > 0 ? maxValue : 1;
    const count = Math.max(values.length, 1);
    const step = count > 1 ? usableWidth / (count - 1) : 0;
    return values
      .map((value, index) => {
        const x = padding.left + index * step;
        const normalized = Math.max(Number(value) || 0, 0) / divisor;
        const y = padding.top + (1 - normalized) * usableHeight;
        return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }

  _chartAreaPath(values, width, height, padding, maxValue) {
    if (!Array.isArray(values) || !values.length) return "";
    const usableWidth = Math.max(width - padding.left - padding.right, 1);
    const usableHeight = Math.max(height - padding.top - padding.bottom, 1);
    const divisor = maxValue > 0 ? maxValue : 1;
    const count = Math.max(values.length, 1);
    const step = count > 1 ? usableWidth / (count - 1) : 0;
    const points = values.map((value, index) => {
      const x = padding.left + index * step;
      const normalized = Math.max(Number(value) || 0, 0) / divisor;
      const y = padding.top + (1 - normalized) * usableHeight;
      return { x, y };
    });
    const first = points[0];
    const last = points[points.length - 1];
    const baseline = height - padding.bottom;
    return [
      `M${first.x.toFixed(1)},${baseline.toFixed(1)}`,
      `L${first.x.toFixed(1)},${first.y.toFixed(1)}`,
      ...points.slice(1).map((point) => `L${point.x.toFixed(1)},${point.y.toFixed(1)}`),
      `L${last.x.toFixed(1)},${baseline.toFixed(1)}`,
      "Z",
    ].join(" ");
  }

  _chartPoints(values, width, height, padding, maxValue) {
    const usableWidth = Math.max(width - padding.left - padding.right, 1);
    const usableHeight = Math.max(height - padding.top - padding.bottom, 1);
    const divisor = maxValue > 0 ? maxValue : 1;
    const count = Math.max(values.length, 1);
    const step = count > 1 ? usableWidth / (count - 1) : 0;
    return values.map((value, index) => {
      const x = padding.left + index * step;
      const normalized = Math.max(Number(value) || 0, 0) / divisor;
      const y = padding.top + (1 - normalized) * usableHeight;
      return { x, y };
    });
  }

  _formatChartPower(value, unitFactor) {
    const amount = Math.max(Number(value) || 0, 0);
    if (unitFactor === 1000) return `${this._fmtNumber(amount, 2)} kW`;
    return `${this._fmtNumber(amount, 0)} W`;
  }

  _chartHoverCardMarkup(state = {}) {
    const title = state.label || "Hover chart";
    const rows = Array.isArray(state.rows) ? state.rows : [];
    const left = Number.isFinite(state.left) ? `${state.left.toFixed(1)}px` : "16px";
    const top = Number.isFinite(state.top) ? `${state.top.toFixed(1)}px` : "16px";
    const visible = state.visible === false ? "0" : "1";
    return `
      <div class="chart-hover-card ${state.floating ? "chart-hover-floating" : ""}" data-chart-hover-card style="left:${left}; top:${top}; opacity:${visible};">
        <div class="chart-hover-title">${this._escape(title)}</div>
        ${
          rows.length
            ? rows
                .map(
                  (row) => `
                    <div class="chart-hover-value">
                      <span class="hover-dot ${this._escape(row.tone || "")}"></span>
                      <span>${this._escape(row.label || "")}:</span>
                      <span>${this._escape(row.value || "")}</span>
                    </div>
                  `,
                )
                .join("")
            : `<div class="chart-hover-empty">${this._escape(state.empty || "Hover the chart to inspect values.")}</div>`
        }
      </div>
    `;
  }

  _setChartHoverCard(state) {
    const card = this.shadowRoot?.querySelector("[data-chart-hover-card]");
    if (!card) return;
    card.outerHTML = this._chartHoverCardMarkup(state);
  }

  _clearPowerChartHover() {
    const line = this.shadowRoot?.querySelector("[data-power-hover-line]");
    if (line) line.setAttribute("opacity", "0");
    this.shadowRoot?.querySelectorAll("[data-power-hover-point]").forEach((point) => {
      point.setAttribute("opacity", "0");
    });
    this.shadowRoot?.querySelectorAll('.stats-row[data-chart-mode="overview"]').forEach((row) => {
      row.classList.remove("active");
    });
    this._setChartHoverCard({ empty: "Hover the chart to inspect values.", floating: true, left: 18, top: 18, visible: false });
  }

  _updatePowerChartHover(index, mode = "daily", coords = null) {
    const model = this._powerChartModel || {};
    const shell = this.shadowRoot?.querySelector("[data-power-chart-shell]");
    const shellRect = shell?.getBoundingClientRect?.();
    const defaultLeft = shellRect ? Math.min(shellRect.width - 280, 18) : 18;
    const defaultTop = shellRect ? 18 : 18;
    const left = Number.isFinite(coords?.cardX) ? Math.max(12, Math.min(coords.cardX, shellRect ? shellRect.width - 292 : coords.cardX)) : defaultLeft;
    const top = Number.isFinite(coords?.cardY) ? Math.max(12, Math.min(coords.cardY, shellRect ? shellRect.height - 132 : coords.cardY)) : defaultTop;
    if (mode === "overview" || model.mode === "overview") {
      const rows = Array.isArray(model.rows) ? model.rows : [];
      const row = rows[index];
      if (!row) return;
      const hoverRows = [
        model.visibility?.solar !== false ? { tone: "solar", label: "Solar", value: this._fmtEnergy(row.solar) } : null,
        model.visibility?.load !== false ? { tone: "load", label: "Load", value: this._fmtEnergy(row.load) } : null,
        model.visibility?.feed !== false ? { tone: "feed", label: "Feed-in", value: this._fmtEnergy(row.feed) } : null,
        model.visibility?.grid !== false ? { tone: "grid", label: "Grid", value: this._fmtEnergy(row.grid) } : null,
      ].filter(Boolean);
      this._setChartHoverCard({
        label: row.label || "Day",
        rows: hoverRows,
        empty: "No visible series are enabled.",
        floating: true,
        left,
        top,
      });
      this.shadowRoot?.querySelectorAll('.stats-row[data-chart-mode="overview"]').forEach((item) => {
        item.classList.toggle("active", Number(item.dataset.chartIndex || -1) === index);
      });
      return;
    }
    const labels = Array.isArray(model.labels) ? model.labels : [];
    const series = Array.isArray(model.series) ? model.series : [];
    if (!labels.length || !series.length) return;
    const safeIndex = Math.max(0, Math.min(Number(index) || 0, labels.length - 1));
    const visibleSeries = series.filter((item) => model.visibility?.[item.key] !== false);
    const hoverRows = visibleSeries.map((item) => ({
      tone: item.tone,
      label: item.label,
      value: item.scale === "bat"
        ? this._fmtPercent(item.values?.[safeIndex] ?? 0)
        : this._formatChartPower(item.values?.[safeIndex] ?? 0, model.unitFactor),
    }));
    this._setChartHoverCard({
      label: labels[safeIndex] || `Point ${safeIndex + 1}`,
      rows: hoverRows,
      empty: "All series are hidden.",
      floating: true,
      left,
      top,
    });
    const line = this.shadowRoot?.querySelector("[data-power-hover-line]");
    if (line) {
      const x = (Number.isFinite(coords?.chartX) ? coords.chartX : 0);
      const svgLeft = model.padding.left;
      const svgRight = model.width - model.padding.right;
      const cursorX = Math.max(svgLeft, Math.min(x, svgRight));
      line.setAttribute("x1", cursorX.toFixed(1));
      line.setAttribute("x2", cursorX.toFixed(1));
      line.setAttribute("opacity", hoverRows.length ? "1" : "0");
    }
    const chartMaxByScale = model.chartMaxByScale || {};
    const pointsByKey = {};
    series.forEach((item) => {
      const maxValue = item.scale === "bat" ? (chartMaxByScale.bat || 100) : (chartMaxByScale.power || 1);
      const points = this._chartPoints(item.values || [], model.width, model.height, model.padding, maxValue);
      pointsByKey[item.key] = points[safeIndex];
    });
    this.shadowRoot?.querySelectorAll("[data-power-hover-point]").forEach((point) => {
      const key = point.getAttribute("data-power-hover-point");
      const visible = model.visibility?.[key] !== false && pointsByKey[key];
      if (!visible) {
        point.setAttribute("opacity", "0");
        return;
      }
      const pos = pointsByKey[key];
      point.setAttribute("cx", pos.x.toFixed(1));
      point.setAttribute("cy", pos.y.toFixed(1));
      point.setAttribute("opacity", "1");
    });
  }

  _renderDailyPowerChart(reporting) {
    const today = reporting?.today || {};
    const powerDiagram = reporting?.power_diagram || {};
    const series = powerDiagram.series || {};
    const times = Array.isArray(powerDiagram.time) ? powerDiagram.time : [];
    const bat = Array.isArray(series.bat) ? series.bat : Array.isArray(series.soc) ? series.soc : [];
    const load = Array.isArray(series.load) ? series.load : [];
    const solar = Array.isArray(series.solar) ? series.solar : [];
    const feed = Array.isArray(series.feed_in) ? series.feed_in : [];
    const consumed = Array.isArray(series.consumed) ? series.consumed : [];
    const maxSeriesValue = Math.max(
      1,
      ...[...solar, ...load, ...feed, ...consumed].map((value) => Math.max(Number(value) || 0, 0)),
    );
    const unitFactor = maxSeriesValue > 100 ? 1000 : 1;
    const toChartValue = (value) => Math.max(Number(value) || 0, 0) / unitFactor;
    const chartValues = {
      bat: bat.map((value) => Math.max(Number(value) || 0, 0)),
      solar: solar.map(toChartValue),
      load: load.map(toChartValue),
      feed: feed.map(toChartValue),
      consumed: consumed.map(toChartValue),
    };
    const visibility = this._chartVisibility();
    const seriesMeta = [
      { key: "bat", label: "BAT SOC", tone: "bat", values: chartValues.bat, scale: "bat" },
      { key: "solar", label: "Solar PV", tone: "solar", values: chartValues.solar },
      { key: "load", label: "House Load", tone: "load", values: chartValues.load },
      { key: "feed", label: "Grid Feed-in", tone: "feed", values: chartValues.feed },
      { key: "consumed", label: "Consumed", tone: "consumed", values: chartValues.consumed },
    ];
    const powerSeries = seriesMeta.filter((item) => item.scale !== "bat");
    const activePowerSeries = powerSeries.filter((item) => visibility[item.key]);
    const chartMax = Math.max(1, ...((activePowerSeries.length ? activePowerSeries : powerSeries).flatMap((item) => item.values)));
    const batMax = 100;
    const width = 860;
    const height = 334;
      const padding = { top: 34, right: 44, bottom: 52, left: 60 };
    const tickCount = 4;
    const tickStep = chartMax / tickCount;
    const labels = times.length ? times : Array.from({ length: chartValues.solar.length || 24 }, (_, index) => `${String(index).padStart(2, "0")}:00`);
    const viewportWidth = Number(window?.innerWidth) || 1280;
    const targetLabelCount = viewportWidth < 640 ? 5 : viewportWidth < 900 ? 6 : viewportWidth < 1280 ? 7 : 8;
    const labelStep = Math.max(1, Math.ceil(labels.length / Math.max(1, targetLabelCount)));
    this._powerChartModel = {
      mode: "daily",
      width,
      height,
      padding,
      labels,
      unitFactor,
      visibility,
      chartMax,
      chartMaxByScale: { power: chartMax, bat: batMax },
      series: seriesMeta,
    };
    const paths = seriesMeta
      .map((item) => {
        const scaleMax = item.scale === "bat" ? batMax : chartMax;
        const points = this._chartPoints(item.values, width, height, padding, scaleMax);
        const path = this._chartPath(item.values, width, height, padding, scaleMax);
        const active = Boolean(visibility[item.key]);
        return `
          <path class="series-area tone-${item.tone} ${active ? "" : "series-hidden"}" d="${this._chartAreaPath(item.values, width, height, padding, scaleMax)}" style="${active ? "" : "display:none"}" />
          <path class="series-line marker-${item.tone} ${active ? "" : "series-hidden"}" d="${path}" style="${active ? "" : "display:none"}" />
          <circle class="power-hover-point marker-${item.tone}" data-power-hover-point="${item.key}" cx="${points[0]?.x?.toFixed?.(1) || 0}" cy="${points[0]?.y?.toFixed?.(1) || 0}" r="4.5" opacity="0"></circle>
        `;
      })
      .join("");
    const gridLines = Array.from({ length: tickCount + 1 }, (_, index) => {
      const value = chartMax - index * tickStep;
      const y = padding.top + (index / tickCount) * (height - padding.top - padding.bottom);
      return `
        <line class="grid" x1="${padding.left}" y1="${y.toFixed(1)}" x2="${width - padding.right}" y2="${y.toFixed(1)}" />
        <text class="axis-label" x="${padding.left - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end">${this._fmtNumber(value, unitFactor === 1000 ? 1 : 0)} ${unitFactor === 1000 ? "kW" : "W"}</text>
      `;
    }).join("");
    const batLabels = [100, 75, 50, 25, 0]
      .map((value) => {
        const y = padding.top + ((100 - value) / 100) * (height - padding.top - padding.bottom);
          return `<text class="axis-label axis-label-right" x="${(width - padding.right + 10).toFixed(1)}" y="${(y + 4).toFixed(1)}" text-anchor="start">${value}%</text>`;
      })
      .join("");
    const axisMidY = padding.top + (height - padding.top - padding.bottom) / 2;
    const xLabels = labels
      .map((label, index) => {
        if (index !== 0 && index !== labels.length - 1 && index % labelStep !== 0) return "";
        const x = padding.left + (labels.length > 1 ? (index / (labels.length - 1)) * (width - padding.left - padding.right) : 0);
        return `<text class="axis-label" x="${x.toFixed(1)}" y="${height - 12}" text-anchor="middle">${this._escape(label)}</text>`;
      })
      .join("");
    return `
      <div class="power-chart-shell" data-power-chart-shell>
        <div class="ring-grid power-summary-grid">
          ${this._ring("Gen", this._fmtEnergy(today.solar_generation), "solar")}
          ${this._ring("Load", this._fmtEnergy(today.load_consumption), "load")}
          ${this._ring("SOC", this._fmtPercent(reporting?.live?.soc), "bat")}
          ${this._ring("Feed", this._fmtEnergy(today.feed_in), "feed")}
          ${this._ring("Grid", this._fmtEnergy(today.grid_consumption), "grid")}
        </div>
        <div class="chart-toolbar">
          <div class="chart-toggle-row">
            ${seriesMeta.map((item) => this._chartToggleChip(item.label, item.tone, item.key, Boolean(visibility[item.key]))).join("")}
          </div>
        </div>
        <div class="power-chart-wrap">
          <svg class="power-chart chart" data-power-chart="daily" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Daily power chart">
            <rect class="power-hover-zone" data-power-hover-zone x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
            ${gridLines}
            ${paths}
            <line class="axis" x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" />
            <line class="power-hover-line" data-power-hover-line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}"></line>
            <text class="axis-title axis-title-y" x="20" y="${axisMidY.toFixed(1)}" text-anchor="middle" transform="rotate(-90 20 ${axisMidY.toFixed(1)})">POWER</text>
              <text class="axis-title axis-title-bat" x="${(width - 30).toFixed(1)}" y="${axisMidY.toFixed(1)}" text-anchor="middle" transform="rotate(90 ${(width - 30).toFixed(1)} ${axisMidY.toFixed(1)})">BAT</text>
            ${batLabels}
            ${xLabels}
          </svg>
        </div>
        ${this._chartHoverCardMarkup({ empty: "Hover the chart to inspect values.", floating: true, left: 18, top: 18, visible: false })}
      </div>
    `;
  }

  _renderPeriodOverviewChart(periodContext) {
    const records = (periodContext?.chart_records || periodContext?.records || []).filter(Boolean);
    const rows = records.map((record) => {
      const solar = Math.max(this._recordFloat(record, [["solar_generation_today"], ["today", "solar_generation"]]), 0);
      const load = Math.max(this._recordFloat(record, [["load_consumption_today"], ["today", "load_consumption"]]), 0);
      const feed = Math.max(this._recordFloat(record, [["feed_in_today"], ["today", "feed_in"]]), 0);
      const grid = Math.max(this._recordFloat(record, [["grid_consumption_today"], ["today", "grid_consumption"]]), 0);
      const total = solar + load + feed + grid;
      return {
        label: this._recordDisplayDate(record) || record.record_date_display || record.record_date || "-",
        solar,
        load,
        feed,
        grid,
        total,
        missing: Boolean(record.__missing),
      };
    });
    const maxTotal = Math.max(1, ...rows.map((row) => row.total));
    const visibility = this._chartVisibility();
    const periodLabel = this._reportPeriodLabel(periodContext?.period || this._reportPeriod);
    const widthFor = (value) => `${Math.max(0, Math.min((value / maxTotal) * 100, 100)).toFixed(1)}%`;
    this._powerChartModel = {
      mode: "overview",
      period: periodContext?.period || this._reportPeriod || "day",
      rows,
      visibility,
    };
    return `
      <div class="stats-diagram" data-power-chart-shell>
        <div class="chart-toolbar">
          <div class="chart-toggle-row">
            ${[
              { key: "solar", label: "Solar PV", tone: "solar" },
              { key: "load", label: "House Load", tone: "load" },
              { key: "feed", label: "Grid Feed-in", tone: "feed" },
              { key: "grid", label: "Grid", tone: "grid" },
            ]
              .map((item) => this._chartToggleChip(item.label, item.tone, item.key, Boolean(visibility[item.key])))
              .join("")}
          </div>
        </div>
        ${rows.length
          ? rows
              .map(
                (row, index) => `
                  <div class="stats-row" data-chart-index="${this._escape(String(index))}" data-chart-mode="overview">
                    <div class="stats-row-head">
                      <div class="stats-row-label">${this._escape(row.label)}</div>
                      <div class="stats-row-value">${this._fmtEnergy(row.total)}</div>
                    </div>
                    <div class="stats-bar-track">
                      ${visibility.solar ? `<div class="stats-bar-fill tone-solar" style="width:${widthFor(row.solar)}"></div>` : ""}
                      ${visibility.load ? `<div class="stats-bar-fill tone-load" style="width:${widthFor(row.load)}"></div>` : ""}
                      ${visibility.feed ? `<div class="stats-bar-fill tone-feed" style="width:${widthFor(row.feed)}"></div>` : ""}
                      ${visibility.grid ? `<div class="stats-bar-fill tone-grid" style="width:${widthFor(row.grid)}"></div>` : ""}
                    </div>
                  </div>
                `,
              )
              .join("")
          : `<div class="empty">No chart data available for the selected ${this._escape(periodLabel.toLowerCase())}.</div>`}
      </div>
      ${this._chartHoverCardMarkup({ empty: `Hover a ${this._escape(periodLabel.toLowerCase())} row to inspect values.`, floating: true, left: 18, top: 18, visible: false })}
    `;
  }

  _renderEnergyDiagram(reporting, periodContext) {
    const period = periodContext?.period || this._reportPeriod || "day";
    const periodLabel = this._reportPeriodLabel(period);
    const isDaily = this._isDailyPeriod(period);
    const rangeStart = this._formatDisplayDate(periodContext?.window?.start);
    const rangeEnd = this._formatDisplayDate(periodContext?.window?.end);
    const diagramDate = this._formatDisplayDate(this._parseLocalDate(reporting?.power_diagram?.date || ""));
    const subtitle = isDaily
      ? this._escape(diagramDate || (rangeStart && rangeEnd ? `${rangeStart} to ${rangeEnd}` : ""))
      : this._escape(rangeStart && rangeEnd ? `${rangeStart} to ${rangeEnd}` : "");
    return `
      <section class="panel power-panel">
        <div class="panel-header">
          <div class="panel-title">${isDaily ? "Power Diagram" : `${periodLabel} Power Overview`}</div>
          <div class="panel-date">${subtitle}</div>
          <button class="download-btn" type="button" data-download-report>Download</button>
        </div>
        ${isDaily ? this._renderDailyPowerChart(reporting) : this._renderPeriodOverviewChart(periodContext)}
      </section>
    `;
  }

  render() {
    if (!this._hass || !this._config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const baseReporting = this._reporting();
    const historyKey = [
      this._historyUrl(),
      this._historyScopeKey(),
    ].join("|");
    if (historyKey !== this._historySourceKey) {
      this._historySourceKey = historyKey;
      this._historyData = null;
      this._historyLoadError = "";
      this._historyAttempted = false;
      this._resetHistoryEnsureState();
      this._historySyncRequested = true;
    }
    if (this._historyConfigured() && !this._historyData && !this._historyLoading) {
      this._ensureHistoryLoaded();
    }
    if (this._historyConfigured() && this._historyData && this._historySyncRequested && !this._historyLoading && !this._historyEnsureLoading && !this._historySyncLoading) {
      this._syncSelectedHistory();
    }
    const periodContext = this._buildPeriodReporting(baseReporting);
    const reporting = periodContext.reporting;

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
          --bw-consumed:#d39a63;
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
        .report-status.empty {
          background:#fff8e6;
          border-color:rgba(240, 196, 25, 0.30);
          color:#805f00;
        }
        .report-status.error {
          background:#fdecec;
          border-color:rgba(198, 82, 82, 0.22);
          color:#a04646;
        }
        .archive-inspector {
          display:grid;
          gap:10px;
          padding:14px 16px;
          border-radius:18px;
          background:#fff;
          border:1px solid var(--bw-border);
          box-shadow: 0 8px 18px rgba(15, 23, 42, 0.05);
        }
        .archive-inspector-head {
          display:flex;
          align-items:end;
          justify-content:space-between;
          gap:10px;
          flex-wrap:wrap;
        }
        .archive-inspector-title {
          font-size:0.95rem;
          font-weight:900;
          color:#0f172a;
        }
        .archive-inspector-meta {
          font-size:0.8rem;
          font-weight:700;
          color:#64748b;
        }
        .archive-inspector-list {
          display:flex;
          flex-wrap:wrap;
          gap:8px;
        }
        .archive-row-chip {
          display:inline-flex;
          align-items:center;
          padding:7px 10px;
          border-radius:999px;
          background:#eef4fb;
          border:1px solid #d7e3f4;
          color:#355377;
          font-size:0.82rem;
          font-weight:800;
        }
        .archive-inspector-empty {
          font-size:0.88rem;
          font-weight:700;
          color:#805f00;
          background:#fff8e6;
          border:1px solid rgba(240, 196, 25, 0.30);
          border-radius:14px;
          padding:10px 12px;
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
          gap:12px;
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
        .history-overview {
          display:grid;
          gap:12px;
          padding:14px;
          border-radius:18px;
          background:#f8fbff;
          border:1px solid rgba(51, 92, 140, 0.12);
        }
        .history-overview-head {
          display:flex;
          justify-content:space-between;
          align-items:end;
          gap:10px;
          flex-wrap:wrap;
        }
        .history-overview-title {
          font-size:1rem;
          font-weight:900;
          color:#0f172a;
        }
        .history-overview-subtitle {
          font-size:0.8rem;
          font-weight:700;
          color:#64748b;
        }
        .history-overview-grid {
          display:grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap:10px;
        }
        .history-overview-card {
          display:grid;
          gap:8px;
          padding:12px 14px;
          border-radius:16px;
          background:#fff;
          border:1px solid rgba(51, 92, 140, 0.14);
        }
        .history-overview-card.active {
          border-color:rgba(47,117,216,0.35);
          box-shadow:0 8px 18px rgba(47,117,216,0.08);
        }
        .history-overview-card-head {
          display:flex;
          justify-content:space-between;
          align-items:center;
          gap:10px;
        }
        .history-overview-card-title {
          font-size:0.94rem;
          font-weight:900;
          color:#17263a;
        }
        .history-overview-card-badge {
          display:inline-flex;
          align-items:center;
          padding:5px 9px;
          border-radius:999px;
          background:#eef4fb;
          border:1px solid #d7e3f4;
          color:#355377;
          font-size:0.77rem;
          font-weight:800;
          white-space:nowrap;
        }
        .history-overview-card-meta {
          font-size:0.82rem;
          font-weight:700;
          color:#64748b;
        }
        .history-table-head {
          display:flex;
          align-items:end;
          justify-content:space-between;
          gap:12px;
          flex-wrap:wrap;
        }
        .history-table-title {
          font-size:0.96rem;
          font-weight:900;
          color:#0f172a;
        }
        .history-table-subtitle {
          font-size:0.8rem;
          font-weight:700;
          color:#64748b;
        }
        .history-table-wrap {
          overflow:auto;
          border:1px solid var(--bw-border);
          border-radius:14px;
          background:#f8fafc;
        }
        .history-table {
          width:100%;
          min-width:720px;
          border-collapse:collapse;
        }
        .history-table th,
        .history-table td {
          padding:10px 12px;
          border-bottom:1px solid #e5e7eb;
          text-align:left;
          white-space:nowrap;
          font-size:0.9rem;
        }
        .history-table th {
          background:#eef2f7;
          color:#475569;
          font-size:0.72rem;
          letter-spacing:0.04em;
          text-transform:uppercase;
        }
        .history-table tbody tr:last-child td {
          border-bottom:none;
        }
        .hero-metrics {
          display:grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap:10px;
        }
        .hero-chip {
          background:#f8fafc;
          border:1px solid var(--bw-border);
          border-radius:14px;
          padding:10px 12px;
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
          white-space:nowrap;
        }
        .aggregate-metric {
          margin-top:6px;
          color:#334155;
          font-size:0.9rem;
        }
        .overview-grid {
          display:grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap:10px;
        }
        .overview-panel {
          display:grid;
          gap:10px;
          align-content:start;
          padding:12px 14px;
        }
        .overview-metrics {
          display:grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap:10px;
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
          white-space:nowrap;
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
        .summary-grid { grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
        .live-grid { grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); }
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
        .panel-note {
          margin-top:6px;
          color:#64748b;
          font-size:0.84rem;
          font-weight:600;
        }
        .stacked-panel {
          margin-bottom:18px;
        }
        .stacked-header {
          align-items:flex-start;
          margin-bottom:12px;
        }
        .stacked-chart-wrap {
          overflow:auto;
          display:grid;
          gap:10px;
          border-radius:18px;
          background:#fff;
          border:1px solid #e2e8f0;
        }
        .stacked-chart {
          display:block;
          min-width:100%;
          height:auto;
          background:#fff;
        }
        .stacked-total {
          font-size:12px;
          font-weight:900;
        }
        .stacked-label {
          fill:#516075;
          font-size:12px;
          font-weight:700;
        }
        .stacked-legend {
          display:flex;
          flex-wrap:wrap;
          gap:10px;
          margin-top:12px;
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
        .legend-chip,
        .download-btn {
          border:none;
          border-radius:999px;
          padding:8px 14px;
          font-weight:700;
          cursor:pointer;
        }
        .download-btn {
          background:#ffffff;
          color:#0f172a;
          border:1px solid #d6dbe1;
          box-shadow:none;
        }
        .legend-solar { background:#fff7da; color:#9a6f00; border:1px solid rgba(240,196,25,0.28); }
        .legend-load { background:#e7f4ff; color:#1d78bd; border:1px solid rgba(47,155,232,0.24); }
        .legend-feed { background:#fff0e5; color:#b35c10; border:1px solid rgba(240,138,36,0.24); }
        .legend-grid { background:#eef2f7; color:#516075; border:1px solid rgba(152,162,168,0.24); }
        .download-btn:hover,
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
        .download-btn {
          transition:background 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
        }
        .download-btn {
          background:#ffffff;
          color:#0f172a;
        }
        .ring-grid {
          display:grid;
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap:10px;
          margin-bottom:18px;
        }
        .power-summary-grid {
          margin-bottom:0;
        }
        .ring-card {
          border-radius:20px;
          padding:12px 10px;
          text-align:center;
          border:2px solid transparent;
          background:#ffffff;
          box-shadow:0 8px 18px rgba(15, 23, 42, 0.05);
          min-width:0;
        }
        .ring-solar { border-color:var(--bw-solar); background:linear-gradient(180deg, rgba(240,196,25,0.10) 0%, #ffffff 58%); }
        .ring-load { border-color:var(--bw-load); background:linear-gradient(180deg, rgba(47,155,232,0.10) 0%, #ffffff 58%); }
        .ring-bat { border-color:var(--bw-battery); background:linear-gradient(180deg, rgba(47,201,110,0.10) 0%, #ffffff 58%); }
        .ring-feed { border-color:var(--bw-feed); background:linear-gradient(180deg, rgba(240,138,36,0.10) 0%, #ffffff 58%); }
        .ring-grid { border-color:var(--bw-grid); background:linear-gradient(180deg, rgba(152,162,168,0.08) 0%, #ffffff 58%); }
        .ring-value {
          font-size:1.1rem;
          font-weight:800;
          color:#0f172a;
        }
        .ring-label {
          margin-top:8px;
          color:#64748b;
          font-size:0.8rem;
          line-height:1.1;
          white-space:nowrap;
          overflow:hidden;
          text-overflow:ellipsis;
        }
        .chart {
          width:100%;
          height:auto;
          display:block;
          background:#fff;
          border-radius:18px;
        }
        .power-panel {
          display:grid;
          gap:14px;
        }
        .power-panel {
          width:100%;
        }
        .power-header {
          display:grid;
          grid-template-columns: minmax(0, 1fr) minmax(260px, 360px);
          gap:14px;
          align-items:start;
        }
        .power-chart-shell {
          display:grid;
          gap:12px;
          position:relative;
            padding:18px;
            margin-inline:12px;
            max-width:calc(100% - 24px);
          box-sizing:border-box;
          border:1px solid rgba(214, 219, 225, 0.95);
          border-radius:24px;
          background:linear-gradient(180deg, #ffffff 0%, #f7fbff 100%);
          box-shadow: 0 14px 32px rgba(47, 155, 232, 0.08), 0 8px 24px rgba(15, 23, 42, 0.05);
        }
        .power-chart-shell::before {
          content:"";
          position:absolute;
          inset:0 0 auto 0;
          height:4px;
          border-radius:24px 24px 0 0;
          background:linear-gradient(90deg, var(--bw-solar) 0%, var(--bw-load) 28%, var(--bw-battery) 50%, var(--bw-feed) 72%, var(--bw-consumed) 100%);
        }
        .chart-toolbar {
          display:grid;
          grid-template-columns:minmax(0, 1fr) minmax(240px, 320px);
          gap:12px;
          align-items:start;
        }
        .power-chart-wrap {
          overflow:visible;
            padding:16px 18px 18px;
          display:grid;
          gap:10px;
          border:1px solid rgba(214, 219, 225, 0.88);
          border-radius:20px;
          background:
            linear-gradient(180deg, rgba(47,155,232,0.04) 0%, rgba(255,255,255,0.98) 32%, rgba(240,196,25,0.03) 100%);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
        }
        .power-chart {
          width:100%;
          min-width:0;
          display:block;
          background:transparent;
          border-radius:16px;
          overflow:visible;
        }
        .chart-hover-card {
          border-radius:18px;
          border:1px solid rgba(214, 219, 225, 0.92);
          background:rgba(255,255,255,0.96);
          box-shadow: 0 16px 34px rgba(15, 23, 42, 0.10);
          backdrop-filter: blur(8px);
          padding:14px 16px;
          display:grid;
          gap:8px;
          min-width:240px;
        }
        .chart-hover-floating {
          position:absolute;
          z-index:4;
          pointer-events:none;
          transform:translate(18px, 18px);
        }
        .chart-hover-title {
          font-size:0.88rem;
          font-weight:900;
          color:#0f172a;
        }
        .chart-hover-value,
        .chart-hover-empty {
          display:flex;
          align-items:center;
          gap:8px;
          font-size:0.82rem;
          font-weight:800;
          color:#334155;
        }
        .chart-hover-empty {
          color:#64748b;
          font-weight:700;
        }
        .hover-dot {
          width:10px;
          height:10px;
          border-radius:999px;
          flex:0 0 auto;
        }
        .hover-dot.bat { background:var(--bw-battery); }
        .hover-dot.load { background:var(--bw-load); }
        .hover-dot.solar { background:var(--bw-solar); }
        .hover-dot.feed { background:var(--bw-feed); }
        .hover-dot.grid { background:var(--bw-grid); }
        .hover-dot.consumed { background:var(--bw-consumed); }
        .chart-toggle-row {
          display:flex;
          flex-wrap:wrap;
          gap:10px;
        }
        .series-area {
          stroke:none;
          pointer-events:none;
          opacity:1;
          fill-opacity:0.16;
        }
        .series-area.tone-solar { fill:#f0c419; fill-opacity:0.20; }
        .series-area.tone-load { fill:#2f9be8; fill-opacity:0.18; }
        .series-area.tone-feed { fill:#f08a24; fill-opacity:0.14; }
        .series-area.tone-consumed { fill:#d39a63; fill-opacity:0.14; }
        .series-area.tone-bat { fill:#2fc96e; fill-opacity:0.18; }
        .series-line {
          fill:none;
          stroke-width:3;
          stroke-linecap:round;
          stroke-linejoin:round;
          vector-effect:non-scaling-stroke;
        }
        .series-marker {
          fill:#fff;
          stroke-width:2.6;
        }
        .marker-bat { stroke:var(--bw-battery); }
        .marker-load { stroke:var(--bw-load); }
        .marker-solar { stroke:var(--bw-solar); }
        .marker-feed { stroke:var(--bw-feed); }
        .marker-grid { stroke:var(--bw-grid); }
        .marker-consumed { stroke:var(--bw-consumed); }
        .series-hidden {
          opacity:0.12;
        }
        .power-hover-zone {
          cursor:crosshair;
        }
        .power-hover-line {
          stroke:#1f2937;
          stroke-width:1.2;
          stroke-dasharray:4 4;
          opacity:0;
          pointer-events:none;
        }
        .power-hover-point {
          opacity:0;
          pointer-events:none;
          fill:#fff;
          stroke-width:3;
        }
        .chart-toggle-row .legend-toggle {
          display:inline-flex;
          align-items:center;
          gap:8px;
          cursor:pointer;
          border:1px solid #d6dbe1;
          background:#ffffff;
          color:#22354d;
          box-shadow: 0 1px 0 rgba(15, 23, 42, 0.02);
        }
        .chart-toggle-row .legend-toggle.active {
          color:#22354d;
          box-shadow: 0 10px 18px rgba(15, 23, 42, 0.08);
        }
        .chart-toggle-row .legend-toggle.inactive {
          opacity:0.72;
        }
        .legend-dot {
          width:10px;
          height:10px;
          border-radius:999px;
          flex:0 0 auto;
          background:currentColor;
        }
        .legend-toggle.legend-solar .legend-dot { background:var(--bw-solar); }
        .legend-toggle.legend-bat .legend-dot { background:var(--bw-battery); }
        .legend-toggle.legend-load .legend-dot { background:var(--bw-load); }
        .legend-toggle.legend-feed .legend-dot { background:var(--bw-feed); }
        .legend-toggle.legend-grid .legend-dot { background:var(--bw-grid); }
        .legend-toggle.legend-consumed .legend-dot { background:var(--bw-consumed); }
        .legend-toggle.legend-bat.active { background:#e8f9ef; border-color:rgba(47,201,110,0.34); }
        .legend-toggle.legend-solar.active { background:#fff8d8; border-color:rgba(240,196,25,0.42); }
        .legend-toggle.legend-load.active { background:#e8f4ff; border-color:rgba(47,155,232,0.34); }
        .legend-toggle.legend-feed.active { background:#fff0e4; border-color:rgba(240,138,36,0.30); }
        .legend-toggle.legend-grid.active { background:#eef2f7; border-color:rgba(152,162,168,0.34); }
        .legend-toggle.legend-consumed.active { background:#f5eadf; border-color:rgba(211,154,99,0.34); }
        .legend-text {
          font-size:0.92rem;
          font-weight:800;
          letter-spacing:0.01em;
        }
        .power-summary-grid .sankey-summary {
          min-height:76px;
        }
        .axis,
        .grid {
          stroke:#d8e3ef;
          stroke-width:1;
        }
        .axis-title {
          fill:#5f7a99;
          font-size:11px;
          font-weight:800;
          letter-spacing:0.16em;
          paint-order:stroke;
          stroke:#ffffff;
          stroke-width:4px;
        }
        .tick,
        .axis-label {
          fill:#5b7694;
          font-size:11px;
          font-weight:700;
          paint-order:stroke;
          stroke:#ffffff;
          stroke-width:3px;
        }
        .axis-label-right {
          fill:#4b9c65;
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
          max-height:460px;
          overflow:auto;
          padding-right:4px;
          position:relative;
        }
        .stats-row {
          display:grid;
          gap:8px;
          padding:12px 0;
          border-bottom:1px solid #e1eaf4;
        }
        .stats-row[data-chart-mode="overview"] {
          cursor:pointer;
        }
        .stats-row.active {
          background:#f8fbff;
          border-radius:14px;
          padding:12px 12px 10px;
          margin:0 -12px;
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
          display:flex;
          overflow:hidden;
          height:14px;
          border-radius:999px;
          background:#edf2f7;
        }
        .stats-bar-fill {
          height:100%;
          border-radius:999px;
          flex:0 0 auto;
        }
        .tone-solar { background:linear-gradient(90deg, var(--bw-solar), #f7da61); }
        .tone-load { background:linear-gradient(90deg, var(--bw-load), #78bdf4); }
        .tone-battery { background:linear-gradient(90deg, var(--bw-battery), #66d98b); }
        .tone-feed { background:linear-gradient(90deg, var(--bw-feed), #f0a15c); }
        .tone-grid { background:linear-gradient(90deg, var(--bw-grid), #b1bac0); }
        .tone-consumed { background:linear-gradient(90deg, var(--bw-consumed), #e0b282); }
        .tone-info { background:linear-gradient(90deg, #4b8fff, #6ca7ff); }
        .empty {
          padding:24px;
          border-radius:18px;
          background:#fff;
          border:1px dashed #cbd5e1;
          color:#64748b;
        }
        .stacked-empty,
        .power-empty {
          min-height:220px;
          display:flex;
          align-items:center;
          justify-content:center;
          text-align:center;
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
        @media (max-width: 1440px) {
          .sankey-stage {
            padding:12px;
          }
          .sankey-summary-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
          .sankey-summary {
            min-height:64px;
            padding:10px 12px;
          }
          .sankey-node-value {
            font-size:20px;
          }
          .sankey-node-meta,
          .sankey-node-sub,
          .sankey-chip {
            font-size:11px;
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
          .stacked-header {
            flex-direction:column;
          }
          .stacked-chart-wrap {
            overflow-x:auto;
          }
          .power-header {
            grid-template-columns: 1fr;
          }
          .chart-toolbar {
            grid-template-columns:1fr;
          }
        }
        @media (max-width: 700px) {
          .sankey-stage {
            overflow:visible;
            padding:10px;
          }
          .sankey-svg {
            display:none;
            min-width:0;
            width:100%;
          }
          .sankey-mobile {
            display:grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            align-items:stretch;
          }
          .sankey-mobile-source {
            min-height: 92px;
          }
          .sankey-mobile-flow {
            padding:10px 12px;
            grid-column: 1 / -1;
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
          .stacked-total,
          .stacked-label {
            font-size:11px;
          }
          .stacked-chart {
            min-width:720px;
          }
          .power-chart {
            min-width:720px;
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
            ${this._renderHeroBanner(reporting)}
            ${this._renderEnergyDiagram(reporting, periodContext)}
            ${this._renderAggregateStrip(reporting)}
            ${this._renderAggregateTable(reporting)}
            ${this._renderOverviewBands(reporting)}
            ${this._renderSummaryTiles(reporting)}
            ${this._renderLiveStrip(reporting)}
            <div class="body-grid">
              <div class="stack-grid">
                ${this._renderRealtimePanel(reporting)}
                ${this._renderDetailsPanel(reporting)}
              </div>
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
      this._resetHistoryEnsureState();
      await this._hass.callService("select", "select_option", {
        entity_id: this._config.settings_target,
        option: event.target.value,
      });
      this._queueHistorySync();
    });
    this.shadowRoot.querySelectorAll("[data-report-period]").forEach((button) => {
      button.addEventListener("click", async () => {
        const nextPeriod = button.dataset.reportPeriod || "day";
        const records = this._historyRecords().sort((a, b) => String(a.record_date).localeCompare(String(b.record_date)));
        const liveAnchor =
          this._parseLocalDate(
            this._reporting()?.power_diagram?.date ||
              this._reporting()?.reporting_date ||
              this._reporting()?.meta?.reporting_date ||
              this._historyRange(records).latest ||
              new Date()
          ) || new Date();
        const savedAnchor =
          this._parseLocalDate(this._reportAnchorDate) ||
          this._parseLocalDate(this._historyRange(records).latest) ||
          liveAnchor;
        const nextAnchor = this._clampAnchor(nextPeriod === "today" ? liveAnchor : savedAnchor, records);
        this._reportPeriod = nextPeriod;
        this._reportAnchorDate = this._formatLocalDate(nextAnchor);
        this._saveReportState();
        this._resetHistoryEnsureState();
        this._queueHistorySync();
      });
    });
    this.shadowRoot.querySelectorAll("[data-report-shift]").forEach((button) => {
      button.addEventListener("click", async () => {
        const step = Number(button.dataset.reportShift || 0) || 0;
        const records = this._historyRecords().sort((a, b) => String(a.record_date).localeCompare(String(b.record_date)));
        const fallback = this._parseLocalDate(this._reportAnchorDate) || this._parseLocalDate(this._reporting()?.power_diagram?.date) || null;
        const current = this._clampAnchor(fallback || this._parseLocalDate(this._historyRange(records).latest) || new Date(), records);
        this._reportAnchorDate = this._formatLocalDate(this._shiftAnchor(current, this._reportPeriod || "day", step));
        this._saveReportState();
        this._resetHistoryEnsureState();
        this._queueHistorySync();
      });
    });
    this.shadowRoot.querySelector("[data-report-date]")?.addEventListener("change", async (event) => {
      const picked = this._parseLocalDate(String(event.target.value || "").trim());
      this._reportAnchorDate = this._formatLocalDate(this._clampDateToToday(picked || this._todayLocalDate()));
      this._saveReportState();
      this._resetHistoryEnsureState();
      this._queueHistorySync();
    });
    this.shadowRoot.querySelectorAll("[data-chart-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = String(button.dataset.chartToggle || "").trim();
        if (!key) return;
        const current = this._chartVisibility();
        const nextVisible = !Boolean(current[key]);
        const activeKeys = Object.entries(current).filter(([seriesKey, visible]) => visible && ["bat", "solar", "load", "feed", "consumed", "grid"].includes(seriesKey));
        if (!nextVisible && activeKeys.length <= 1) return;
        this._setChartSeriesVisible(key, nextVisible);
        this.render();
      });
    });
    const chartShell = this.shadowRoot.querySelector("[data-power-chart-shell]");
    const model = this._powerChartModel || {};
    if (chartShell && model.mode === "daily") {
      const svg = chartShell.querySelector("[data-power-chart]");
      const handleDailyMove = (event) => {
        if (!svg || !this._powerChartModel || this._powerChartModel.mode !== "daily") return;
        const svgBounds = svg.getBoundingClientRect();
        const shellBounds = chartShell.getBoundingClientRect();
        if (!svgBounds.width || !svgBounds.height) return;
        const chartX = Math.max(0, Math.min(event.clientX - svgBounds.left, svgBounds.width));
        const cardX = Math.max(0, Math.min(event.clientX - shellBounds.left, shellBounds.width));
        const cardY = Math.max(0, Math.min(event.clientY - shellBounds.top, shellBounds.height));
        const labels = Array.isArray(this._powerChartModel.labels) ? this._powerChartModel.labels : [];
        const index = labels.length > 1 ? Math.round((chartX / svgBounds.width) * (labels.length - 1)) : 0;
        this._updatePowerChartHover(index, "daily", { chartX, cardX, cardY });
      };
      svg?.addEventListener("pointermove", handleDailyMove);
      svg?.addEventListener("pointerenter", handleDailyMove);
      svg?.addEventListener("pointerleave", () => this._clearPowerChartHover());
      svg?.addEventListener("pointerdown", handleDailyMove);
    }
    if (chartShell && model.mode === "overview") {
      chartShell.querySelectorAll('.stats-row[data-chart-mode="overview"]').forEach((row) => {
        const index = Number(row.dataset.chartIndex || -1);
        row.addEventListener("pointerenter", (event) => {
          const bounds = chartShell.getBoundingClientRect();
          this._updatePowerChartHover(index, "overview", { cardX: event.clientX - bounds.left, cardY: event.clientY - bounds.top });
        });
        row.addEventListener("pointermove", (event) => {
          const bounds = chartShell.getBoundingClientRect();
          this._updatePowerChartHover(index, "overview", { cardX: event.clientX - bounds.left, cardY: event.clientY - bounds.top });
        });
        row.addEventListener("pointerleave", () => this._clearPowerChartHover());
      });
    }
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

