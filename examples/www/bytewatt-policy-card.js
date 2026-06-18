class ByteWattPolicyCard extends HTMLElement {
  setConfig(config) {
    if (!config) {
      throw new Error("Card configuration is required");
    }
    const variant = config.variant || "battery_policy";
    if (!["battery_policy", "feedin_policy"].includes(variant)) {
      throw new Error("variant must be battery_policy or feedin_policy");
    }
    this._config = this._withDefaults({ ...config, variant });
  }

  set hass(hass) {
    this._hass = hass;
    this.render();
  }

  getCardSize() {
    return this._config?.variant === "feedin_policy" ? 7 : 10;
  }

  _withDefaults(config) {
    const prefix = config.entity_prefix || "house_bytewatt_battery_system";
    const variant = config.variant || "battery_policy";
    const defaults = {
      battery_policy: {
        charge_cap: `number.${prefix}_battery_charge_cap`,
        charge_switch: `switch.${prefix}_grid_charging_battery`,
        discharge_switch: `switch.${prefix}_battery_discharge_time_control`,
        discharge_cutoff: `number.${prefix}_minimum_soc`,
        charge_power: `number.${prefix}_battery_charge_power`,
        discharge_power: `number.${prefix}_battery_discharge_power`,
        execution_cycle: `select.${prefix}_execution_cycle`,
        ups_reserve: `switch.${prefix}_ups_reserve_enable`,
        offgrid_soc_control: `switch.${prefix}_offgrid_soc_control`,
        charge_start_time: `time.${prefix}_charge_start_time`,
        charge_end_time: `time.${prefix}_charge_end_time`,
        discharge_start_time: `time.${prefix}_discharge_start_time`,
        discharge_end_time: `time.${prefix}_discharge_end_time`,
        submit_button: `button.${prefix}_submit_settings`,
        discard_button: `button.${prefix}_discard_pending_settings`,
      },
      feedin_policy: {
        feedin_enabled: `switch.${prefix}_grid_feed_in_function`,
        feedin_cutoff: `number.${prefix}_grid_feed_in_discharging_cutoff_soc`,
        feedin_time_start: `time.${prefix}_grid_feed_in_time1_start`,
        feedin_time_end: `time.${prefix}_grid_feed_in_time1_end`,
        feedin_power: `number.${prefix}_grid_feed_in_time1_power`,
        submit_button: `button.${prefix}_submit_settings`,
        discard_button: `button.${prefix}_discard_pending_settings`,
      },
    };

    return {
      ...defaults[variant],
      ...config,
      variant,
      entity_prefix: prefix,
    };
  }

  render() {
    if (!this._hass || !this._config) {
      return;
    }

    if (!this.shadowRoot) {
      this.attachShadow({ mode: "open" });
    }

    const variant = this._config.variant;
    const title = this._config.title || (
      variant === "feedin_policy" ? "Feed-in Control" : "Charging / Discharging Setting"
    );

    const batteryRows = [
      this._numberRow("Charging stops at SOC", this._config.charge_cap),
      this._switchRow("Charge", this._config.charge_switch),
      this._switchRow("Discharge", this._config.discharge_switch),
      this._numberRow("Discharging cut off SOC", this._config.discharge_cutoff),
      this._numberRow("Charge Power", this._config.charge_power, "W"),
      this._numberRow("Discharge Power", this._config.discharge_power, "W"),
      this._timeGroup("Charge Window", this._config.charge_start_time, this._config.charge_end_time),
      this._timeGroup("Discharge Window", this._config.discharge_start_time, this._config.discharge_end_time),
      this._numberRow("Execution Cycle", this._config.execution_cycle),
      this._switchRow("UPS reserve enable", this._config.ups_reserve),
      this._switchRow("Off-grid SOC Control", this._config.offgrid_soc_control),
      this._actionButtons([
        { entityId: this._config.discard_button, label: "Discard", kind: "secondary" },
        { entityId: this._config.submit_button, label: "Submit", kind: "primary" },
      ]),
    ];

    const feedinRows = [
      this._switchRow("Feed-in Function", this._config.feedin_enabled),
      this._numberRow("Discharging cut off SOC", this._config.feedin_cutoff),
      this._timeGroup("Feed-in Time1", this._config.feedin_time_start, this._config.feedin_time_end),
      this._numberRow("Feed-in Power", this._config.feedin_power, "W"),
      this._actionButtons([
        { entityId: this._config.discard_button, label: "Discard", kind: "secondary" },
        { entityId: this._config.feedin_submit_button || this._config.submit_button, label: "Submit", kind: "primary" },
      ]),
    ];

    const rows = variant === "feedin_policy" ? feedinRows : batteryRows;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }
        ha-card {
          background:
            radial-gradient(circle at top right, rgba(44, 102, 187, 0.18), transparent 28%),
            linear-gradient(180deg, #2a2a2a 0%, #1f1f1f 100%);
          border-radius: 24px;
          color: #fff;
          overflow: hidden;
        }
        .wrap {
          padding: 18px 18px 20px;
        }
        .title {
          font-size: 1.55rem;
          font-weight: 700;
          letter-spacing: 0.01em;
          margin: 4px 0 18px;
        }
        .section {
          display: grid;
          gap: 10px;
        }
        .row,
        .time-box {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px;
        }
        .row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          padding: 14px 16px;
        }
        .label {
          font-size: 1rem;
          font-weight: 600;
        }
        .value {
          color: rgba(255,255,255,0.82);
          font-size: 0.95rem;
        }
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 10px;
          border-radius: 999px;
          background: rgba(255,255,255,0.08);
          color: rgba(255,255,255,0.8);
          font-size: 0.85rem;
          cursor: pointer;
        }
        .pill.pending {
          background: rgba(203, 146, 44, 0.2);
          color: #ffd38b;
        }
        .pill.disabled {
          background: rgba(120, 120, 120, 0.22);
          color: rgba(255,255,255,0.72);
        }
        .button {
          margin-top: 8px;
          padding: 15px 16px;
          border: 0;
          border-radius: 18px;
          font-size: 1rem;
          font-weight: 700;
          cursor: pointer;
          width: 100%;
        }
        .button.primary {
          background: linear-gradient(90deg, #2d68c8 0%, #3d8cff 100%);
          color: #fff;
        }
        .button.secondary {
          background: linear-gradient(90deg, #2f68be 0%, #3c8cff 100%);
          color: #fff;
        }
        .button.disabled {
          background: rgba(255,255,255,0.08);
          color: rgba(255,255,255,0.45);
          cursor: default;
        }
        .time-group {
          display: grid;
          gap: 10px;
        }
        .time-header {
          font-size: 0.9rem;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: rgba(255,255,255,0.65);
          margin-top: 2px;
        }
        .time-pair {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .time-box {
          padding: 12px 14px;
          cursor: pointer;
        }
        .time-box .value {
          margin-top: 4px;
        }
        .meta {
          margin-top: 10px;
          color: rgba(255,255,255,0.58);
          font-size: 0.83rem;
          line-height: 1.45;
        }
        .button-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
      </style>
      <ha-card>
        <div class="wrap">
          <div class="title">${title}</div>
          <div class="section">
            ${rows.join("")}
          </div>
          <div class="meta">
            Controls shown as Not configured are not yet available from the current integration data.
            Do not use the web portal All selector for settings changes; use an individual battery selection instead.
          </div>
        </div>
      </ha-card>
    `;

    this._bindEvents();
  }

  _stateObj(entityId) {
    return entityId ? this._hass.states[entityId] : null;
  }

  _friendlyState(entityId, suffix = "") {
    const stateObj = this._stateObj(entityId);
    if (!stateObj) {
      return "Not configured";
    }
    const unit = suffix || stateObj.attributes.unit_of_measurement || "";
    return `${stateObj.state}${unit ? ` ${unit}` : ""}`;
  }

  _fireMoreInfo(entityId) {
    if (!entityId) {
      return;
    }
    this.dispatchEvent(new CustomEvent("hass-more-info", {
      bubbles: true,
      composed: true,
      detail: { entityId },
    }));
  }

  async _toggle(entityId) {
    if (!entityId) {
      return;
    }
    await this._hass.callService("homeassistant", "toggle", { entity_id: entityId });
  }

  async _pressButton(entityId) {
    if (!entityId) {
      return;
    }
    const [domain] = entityId.split(".");
    if (domain === "button") {
      await this._hass.callService("button", "press", { entity_id: entityId });
      return;
    }
    this._fireMoreInfo(entityId);
  }

  _switchRow(label, entityId) {
    const stateObj = this._stateObj(entityId);
    const checked = stateObj?.state === "on";
    return `
      <div class="row">
        <div>
          <div class="label">${label}</div>
          <div class="value">${stateObj ? (checked ? "Enabled" : "Disabled") : "Not configured"}</div>
        </div>
        <ha-switch data-toggle="${entityId || ""}" ${checked ? "checked" : ""} ${entityId ? "" : "disabled"}></ha-switch>
      </div>
    `;
  }

  _numberRow(label, entityId, suffix = "") {
    return `
      <div class="row" data-more-info="${entityId || ""}">
        <div>
          <div class="label">${label}</div>
          <div class="value">${this._friendlyState(entityId, suffix)}</div>
        </div>
        <div class="pill">${entityId ? "Edit" : "Configure"}</div>
      </div>
    `;
  }

  _actionButtons(items) {
    return `
      <div class="button-row">
        ${items.map(({ entityId, label, kind }) => this._actionButton(entityId, label, kind)).join("")}
      </div>
    `;
  }

  _timeGroup(title, startEntity, endEntity) {
    return `
      <div class="time-group">
        <div class="time-header">${title}</div>
        <div class="time-pair">
          <div class="time-box" data-more-info="${startEntity || ""}">
            <div class="label">Start</div>
            <div class="value">${this._friendlyState(startEntity)}</div>
          </div>
          <div class="time-box" data-more-info="${endEntity || ""}">
            <div class="label">End</div>
            <div class="value">${this._friendlyState(endEntity)}</div>
          </div>
        </div>
      </div>
    `;
  }

  _actionButton(entityId, label, kind) {
    const disabled = !entityId;
    return `
      <button
        class="button ${kind} ${disabled ? "disabled" : ""}"
        data-press="${entityId || ""}"
        ${disabled ? "disabled" : ""}
      >${disabled ? `${label} (HAR pending)` : label}</button>
    `;
  }

  _bindEvents() {
    this.shadowRoot.querySelectorAll("[data-more-info]").forEach((node) => {
      const entityId = node.getAttribute("data-more-info");
      if (!entityId) {
        return;
      }
      node.addEventListener("click", () => this._fireMoreInfo(entityId));
    });

    this.shadowRoot.querySelectorAll("[data-press]").forEach((node) => {
      const entityId = node.getAttribute("data-press");
      node.addEventListener("click", () => this._pressButton(entityId));
    });

    this.shadowRoot.querySelectorAll("[data-toggle]").forEach((node) => {
      const entityId = node.getAttribute("data-toggle");
      if (!entityId) {
        return;
      }
      node.addEventListener("change", () => this._toggle(entityId));
    });
  }
}

customElements.define("bytewatt-policy-card", ByteWattPolicyCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "bytewatt-policy-card",
  name: "ByteWatt Policy Card",
  description: "App-style ByteWatt policy card with confirmed controls and HAR-pending placeholders.",
});
