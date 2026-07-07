const BYTEWATT_DEBUG_CARD_BUILD = "005";

class ByteWattDebugCard extends HTMLElement {
  setConfig(config) {
    const prefix = config?.entity_prefix || "house_bytewatt_battery_system";
    this._config = {
      entity_prefix: prefix,
      settings_target: config?.settings_target || `select.${prefix}_settings_target`,
      title: config?.title || "ByteWatt Debug",
      ...config,
    };
    this._status = "";
    this._statusKind = "neutral";
    this._debugPeriod = this._debugPeriod || "day";
    this._debugAnchorDate = this._debugAnchorDate || "";
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

  _clampAnchor(anchor) {
    const latest = this._parseLocalDate(this._reporting()?.power_diagram?.date)
      || this._parseLocalDate(this._reporting()?.reporting_date)
      || this._parseLocalDate(this._reporting()?.meta?.reporting_date)
      || new Date();
    if (!anchor) return latest;
    return anchor > latest ? latest : anchor;
  }

  _debugAnchor() {
    return this._parseLocalDate(this._debugAnchorDate)
      || this._parseLocalDate(this._reporting()?.power_diagram?.date)
      || this._parseLocalDate(this._reporting()?.reporting_date)
      || this._parseLocalDate(this._reporting()?.meta?.reporting_date)
      || new Date();
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

  async _requestArchiveProbe() {
    const history = this._history();
    const selectorAttrs = this._attrs();
    const reportAttrs = this._reportAttrs();
    const scopeKey = String(history.current_scope || reportAttrs.current_scope || selectorAttrs.current_scope || "all").trim() || "all";
    const entryId = String(history.entry_id || reportAttrs.entry_id || selectorAttrs.entry_id || "").trim();
    const range = this._debugRange();
    const startDate = this._formatLocalDate(range.window.start);
    const endDate = this._formatLocalDate(range.window.end);
    this._status = `Requested archive probe for ${scopeKey} ${this._debugPeriod} ${startDate} -> ${endDate}`;
    this._statusKind = "loading";
    this.render();
    try {
      const payload = {
        scope_key: scopeKey,
        start_date: startDate,
        end_date: endDate,
      };
      if (entryId) payload.entry_id = entryId;
      await this._hass.callService("bytewatt", "ensure_report_history", payload);
      this._status = `Archive probe sent for ${scopeKey} ${this._debugPeriod} ${startDate} -> ${endDate}`;
      this._statusKind = "success";
    } catch (err) {
      this._status = `Archive probe failed: ${String(err?.message || err)}`;
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
    const historyUrl = history.base_url || history.url || "";
    const statusClass = this._statusKind;
    const range = this._debugRange();
    const rangeLabel = `${this._formatDisplayDate(range.window.start)} to ${this._formatDisplayDate(range.window.end)}`;

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
        .button.secondary {
          color: #334155;
          border-color: rgba(100, 116, 139, 0.22);
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
      </style>
      <ha-card>
        <div class="shell">
          <div class="header">
            <div class="title">
              <span>BW</span>
              <span>${this._escape(this._config.title)}</span>
              <span class="badge">v${BYTEWATT_DEBUG_CARD_BUILD}</span>
            </div>
            <button class="button" type="button" id="probe-button">Probe archive</button>
          </div>

          ${this._status ? `<div class="status ${statusClass}">${this._escape(this._status)}</div>` : ""}

          <div class="panel">
            <div class="panel-title">Archive Selection</div>
            <div class="controls">
              <div class="control-row">
                <button class="period-button ${this._debugPeriod === "today" ? "active" : ""}" type="button" data-debug-period="today">Today</button>
                <button class="period-button ${this._debugPeriod === "day" ? "active" : ""}" type="button" data-debug-period="day">Day</button>
                <button class="period-button ${this._debugPeriod === "week" ? "active" : ""}" type="button" data-debug-period="week">Week</button>
                <button class="period-button ${this._debugPeriod === "month" ? "active" : ""}" type="button" data-debug-period="month">Month</button>
              </div>
              <div class="control-row">
                <input class="date-input" type="date" data-debug-date value="${this._escape(range.displayDate)}" />
                <button class="button secondary" type="button" data-debug-shift="-1">&lt;</button>
                <button class="button secondary" type="button" data-debug-shift="1">&gt;</button>
                <span class="range-pill">${this._escape(rangeLabel)}</span>
              </div>
            </div>
          </div>

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
              </div>
              ${this._summaryLine("Reporting date", reporting.reporting_date || reportingMeta.reporting_date || "-")}
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
      button.onclick = () => this._requestArchiveProbe();
    }

    this.shadowRoot.querySelectorAll("[data-debug-period]").forEach((item) => {
      item.onclick = () => {
        this._debugPeriod = item.getAttribute("data-debug-period") || "day";
        this.render();
      };
    });
    this.shadowRoot.querySelector("[data-debug-date]")?.addEventListener("change", (event) => {
      this._debugAnchorDate = String(event.target.value || "").trim();
      this.render();
    });
    this.shadowRoot.querySelectorAll("[data-debug-shift]").forEach((item) => {
      item.onclick = () => {
        const step = Number(item.getAttribute("data-debug-shift") || 0) || 0;
        const next = this._shiftAnchor(this._debugRange().anchor, this._debugPeriod || "day", step);
        this._debugAnchorDate = this._formatLocalDate(next);
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
        if (key === "reporting") {
          this._copyText(this._json(reporting), "Reporting");
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
