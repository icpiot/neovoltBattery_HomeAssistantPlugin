const BYTEWATT_DEBUG_CARD_BUILD = "002";

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

  _attrs() {
    return this._selectorState()?.attributes || {};
  }

  _reporting() {
    return this._attrs().reporting || {};
  }

  _history() {
    const attrs = this._attrs();
    const direct = attrs.history;
    if (direct && typeof direct === "object") return direct;
    const fallback = attrs.reporting?.meta?.history;
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

  async _requestArchiveProbe() {
    const history = this._history();
    const reporting = this._reporting();
    const scopeKey = String(history.current_scope || this._attrs().current_scope || "all").trim() || "all";
    const entryId = String(history.entry_id || this._attrs().entry_id || "").trim();
    const reportDate = String(reporting.reporting_date || reporting.meta?.reporting_date || "").trim()
      || new Date().toISOString().slice(0, 10);
    this._status = `Requested archive probe for ${scopeKey} on ${reportDate}`;
    this._statusKind = "loading";
    this.render();
    try {
      const payload = {
        scope_key: scopeKey,
        start_date: reportDate,
        end_date: reportDate,
      };
      if (entryId) payload.entry_id = entryId;
      await this._hass.callService("bytewatt", "ensure_report_history", payload);
      this._status = `Archive probe sent for ${scopeKey} on ${reportDate}`;
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
    const reporting = this._reporting();
    const history = this._history();
    const reportingMeta = reporting.meta || {};
    const historyUrl = history.base_url || history.url || "";
    const statusClass = this._statusKind;

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

          <div class="grid">
            <div class="panel">
              <div class="panel-title">Target Entity</div>
              ${this._summaryLine("Entity", this._config.settings_target)}
              ${this._summaryLine("State", selector?.state)}
              ${this._summaryLine("Last changed", this._fmtTime(selector?.last_changed))}
              ${this._summaryLine("Last updated", this._fmtTime(selector?.last_updated))}
            </div>

            <div class="panel">
              <div class="panel-title">Archive Metadata</div>
              ${this._summaryLine("History configured", Boolean(history.enabled || history.base_url || history.entry_id) ? "yes" : "no")}
              ${this._summaryLine("Entry ID", history.entry_id || "-")}
              ${this._summaryLine("Current scope", history.current_scope || attrs.current_scope || "-")}
              ${this._summaryLine("History URL", history.base_url || historyUrl || "-")}
              ${this._summaryLine("Last ensure", this._json(history.last_ensure_result || {}))}
            </div>

            <div class="panel">
              <div class="panel-title">Reporting Summary</div>
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
