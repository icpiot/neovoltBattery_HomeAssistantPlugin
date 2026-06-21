const BYTEWATT_POLICY_CARD_BUILD = "005";

class ByteWattPolicyCard extends HTMLElement {
  setConfig(config) {
    const variant = config?.variant || "battery_policy";
    if (!["battery_policy", "feedin_policy"].includes(variant)) {
      throw new Error("variant is required: battery_policy or feedin_policy");
    }
    this._config = this._withDefaults({ ...config, variant });
    this._drafts = this._drafts || {};
    this._immediateState = this._immediateState || {};
    this._status = null;
  }

  set hass(hass) {
    this._hass = hass;
    this.render();
  }

  getCardSize() {
    return this._config?.variant === "feedin_policy" ? 10 : 20;
  }

  _withDefaults(config) {
    const prefix = config.entity_prefix || "house_bytewatt_battery_system";
    return {
      ...config,
      entity_prefix: prefix,
      settings_target: config.settings_target || `select.${prefix}_settings_target`,
      execution_cycle: config.execution_cycle || `select.${prefix}_execution_cycle`,
      charge_cap: config.charge_cap || `number.${prefix}_battery_charge_cap`,
      charge_power: config.charge_power || `number.${prefix}_battery_charge_power`,
      discharge_cutoff: config.discharge_cutoff || `number.${prefix}_minimum_soc`,
      discharge_power: config.discharge_power || `number.${prefix}_battery_discharge_power`,
      charge_switch: config.charge_switch || `switch.${prefix}_grid_charging_battery`,
      discharge_switch:
        config.discharge_switch || `switch.${prefix}_battery_discharge_time_control`,
      feedin_enabled:
        config.feedin_enabled || `switch.${prefix}_grid_feed_in_function`,
      feedin_cutoff:
        config.feedin_cutoff ||
        `number.${prefix}_grid_feed_in_discharging_cutoff_soc`,
      summary_soc: config.summary_soc || `sensor.${prefix}_battery_percentage`,
      summary_battery_power: config.summary_battery_power || `sensor.${prefix}_battery_power`,
      summary_battery_load: config.summary_battery_load || `sensor.${prefix}_house_consumption`,
    };
  }

  render() {
    if (!this._hass || !this._config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });

    const target = this._stateObj(this._config.settings_target);
    const attrs = target?.attributes || {};
    const batteryPolicy = attrs.battery_policy || {};
    const feedinPolicy = attrs.feedin_policy || {};
    const isFeedin = this._config.variant === "feedin_policy";
    const cardTitle = isFeedin ? "Feed-in Policy" : "Battery Policy";
    const cardIcon = isFeedin ? "&#8593;" : "&#9889;";
    const body = isFeedin
      ? this._renderFeedinSection(feedinPolicy)
      : this._renderMainPolicy(batteryPolicy);

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          min-width: 0;
          container-type: inline-size;
        }
        ha-card {
          width: 100%;
          background:
            radial-gradient(circle at top right, rgba(42, 94, 179, 0.14), transparent 30%),
            linear-gradient(180deg, #152131 0%, #0f1824 100%);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 18px;
          color: #fff;
          overflow: hidden;
          box-shadow: 0 16px 36px rgba(0,0,0,0.26);
        }
        .shell {
          display: grid;
          gap: 14px;
          padding: 18px;
          box-sizing: border-box;
        }
        .header {
          display: grid;
          gap: 18px;
        }
        .title-row {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .title-icon {
          width: 28px;
          height: 28px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #4aa2ff;
          background: rgba(74, 162, 255, 0.12);
          border: 1px solid rgba(74, 162, 255, 0.24);
          font-size: 1rem;
          font-weight: 800;
        }
        .title {
          font-size: 1.15rem;
          font-weight: 800;
        }
        .selector-row {
          display: grid;
          grid-template-columns: 140px minmax(0, 1fr);
          gap: 18px;
          align-items: center;
        }
        .label {
          font-size: 0.95rem;
          font-weight: 700;
        }
        .body {
          display: grid;
          gap: 12px;
        }
        .summary-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
        }
        .summary-card {
          display: grid;
          gap: 6px;
          min-width: 0;
          padding: 12px 14px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.04);
        }
        .summary-label {
          color: rgba(122, 171, 242, 0.95);
          font-size: 0.76rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .summary-value {
          color: #fff;
          font-size: 1.05rem;
          font-weight: 800;
          line-height: 1.2;
          word-break: break-word;
        }
        .summary-subtle {
          color: rgba(220, 230, 243, 0.62);
          font-size: 0.82rem;
          line-height: 1.3;
        }
        .section {
          display: grid;
          gap: 16px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 16px;
          background: rgba(255,255,255,0.025);
          padding: 16px;
        }
        .section-content {
          display: grid;
          grid-template-columns: minmax(280px, 0.95fr) minmax(420px, 1.55fr);
          gap: 0;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px;
          overflow: hidden;
          background: rgba(10, 17, 27, 0.16);
        }
        .section-side {
          display: grid;
          gap: 14px;
          min-width: 0;
          padding: 14px;
          align-content: start;
          grid-auto-rows: max-content;
        }
        .section-side.immediate {
          background: rgba(18, 26, 38, 0.86);
          border-right: 1px solid rgba(255,255,255,0.08);
        }
        .immediate-panel {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          justify-content: flex-start;
          gap: 16px;
          min-height: 0;
        }
        .section-header {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .section-icon {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 0.95rem;
          font-weight: 800;
        }
        .section-icon.charge {
          color: #f3a44f;
          background: rgba(243, 164, 79, 0.16);
        }
        .section-icon.discharge {
          color: #9c6dff;
          background: rgba(156, 109, 255, 0.16);
        }
        .section-icon.feedin {
          color: #72d76b;
          background: rgba(114, 215, 107, 0.16);
        }
        .section-title {
          font-size: 0.95rem;
          font-weight: 800;
        }
        .section-divider {
          height: 1px;
          background: rgba(255,255,255,0.08);
        }
        .eyebrow {
          color: rgba(122, 171, 242, 0.95);
          font-size: 0.76rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
        }
        .copy, .muted, .status {
          color: rgba(220, 230, 243, 0.72);
          font-size: 0.9rem;
          line-height: 1.4;
        }
        .stack {
          display: grid;
          gap: 12px;
        }
        .field-title {
          font-size: 0.95rem;
          font-weight: 700;
        }
        .button-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .immediate-status {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          color: rgba(220, 230, 243, 0.82);
          font-size: 0.88rem;
          font-weight: 600;
        }
        .immediate-status-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: rgba(255,255,255,0.28);
          box-shadow: 0 0 0 4px rgba(255,255,255,0.03);
        }
        .immediate-status-dot.running {
          background: #79d764;
          box-shadow: 0 0 0 4px rgba(121, 215, 100, 0.14);
        }
        .single-action {
          grid-template-columns: 1fr;
        }
        .policy-grid {
          display: grid;
          gap: 14px;
        }
        .policy-cell {
          display: grid;
          gap: 8px;
          min-width: 0;
        }
        .policy-cell.switch {
          grid-template-columns: minmax(0, 1fr) 52px;
          gap: 12px;
          align-items: center;
        }
        .policy-value {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 8px;
          align-items: center;
        }
        .schedule-head {
          display: flex;
          align-items: baseline;
          gap: 8px;
          padding-top: 2px;
        }
        .schedule-note {
          color: rgba(220, 230, 243, 0.62);
          font-size: 0.88rem;
        }
        .slot {
          display: grid;
          gap: 12px;
          padding: 14px;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          background: rgba(255,255,255,0.03);
        }
        .slot-top {
          display: grid;
          gap: 14px;
        }
        .slot-name {
          font-size: 0.95rem;
          font-weight: 800;
        }
        .slot-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          min-width: 0;
        }
        .slot-grid.feedin {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .slot-field {
          display: grid;
          gap: 6px;
          min-width: 0;
        }
        .slot-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          justify-content: flex-start;
        }
        .slot-actions button {
          flex: 1 1 140px;
          min-width: 0;
        }
        .chips {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .footer {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
        }
        .footer-spacer {
          flex: 1 1 auto;
        }
        .footer-actions {
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
          width: 100%;
        }
        .schedule-empty {
          color: rgba(220, 230, 243, 0.62);
          font-size: 0.9rem;
          line-height: 1.4;
          padding: 4px 0;
        }
        button, select, input {
          min-width: 0;
          box-sizing: border-box;
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.1);
          font-size: 0.95rem;
        }
        select, input {
          width: 100%;
          height: 38px;
          padding: 8px 12px;
          background: rgba(255,255,255,0.08);
          color: #fff;
        }
        select option {
          color: #111;
        }
        input[type="checkbox"][data-policy-toggle] {
          appearance: none;
          -webkit-appearance: none;
          width: 48px;
          height: 26px;
          border-radius: 999px;
          background: rgba(255,255,255,0.12);
          border: 1px solid rgba(255,255,255,0.16);
          position: relative;
          cursor: pointer;
          transition: background 140ms ease;
        }
        input[type="checkbox"][data-policy-toggle]::after {
          content: "";
          position: absolute;
          top: 2px;
          left: 2px;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: rgba(255,255,255,0.82);
          transition: transform 140ms ease;
        }
        input[type="checkbox"][data-policy-toggle]:checked {
          background: linear-gradient(90deg, #2f6fd9 0%, #428dff 100%);
          border-color: transparent;
        }
        input[type="checkbox"][data-policy-toggle]:checked::after {
          transform: translateX(22px);
          background: #fff;
        }
        button {
          height: 38px;
          padding: 8px 14px;
          color: #fff;
          font-weight: 700;
          background: rgba(255,255,255,0.08);
          cursor: pointer;
          white-space: nowrap;
          line-height: 1;
        }
        button.primary {
          background: linear-gradient(90deg, #2f6fd9 0%, #428dff 100%);
          border-color: transparent;
        }
        button.purple {
          background: linear-gradient(90deg, #7a3fe0 0%, #a15bf8 100%);
          border-color: transparent;
        }
        button.green {
          background: linear-gradient(90deg, #5ca848 0%, #79d764 100%);
          border-color: transparent;
        }
        button.danger {
          background: linear-gradient(90deg, rgba(127, 53, 45, 0.95) 0%, rgba(169, 70, 58, 0.95) 100%);
          border-color: transparent;
        }
        .status {
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.08);
        }
        .status.success {
          background: rgba(62,142,92,0.18);
          color: #c6f5d2;
        }
        .status.error {
          background: rgba(163,52,52,0.2);
          color: #ffd3d3;
        }
        .chip {
          border-radius: 8px;
          padding: 7px 12px;
          font-size: 0.85rem;
          font-weight: 700;
          color: rgba(231, 238, 248, 0.84);
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.08);
          cursor: pointer;
        }
        .chip.active {
          background: linear-gradient(90deg, #2f6fd9 0%, #428dff 100%);
          border-color: transparent;
          color: #fff;
        }
        @container (max-width: 640px) {
          .summary-grid,
          .selector-row,
          .button-row,
          .slot-grid,
          .slot-grid.feedin,
          .footer-actions {
            grid-template-columns: 1fr;
          }
          .slot-actions {
            display: grid;
          }
        }
        @container (max-width: 980px) {
          .section-content {
            grid-template-columns: 1fr;
          }
          .section-side.immediate {
            border-right: none;
            border-bottom: 1px solid rgba(255,255,255,0.08);
          }
        }
      </style>
      <ha-card>
        <div class="shell">
          <div class="header">
            <div class="title-row">
              <div class="title-icon">${cardIcon}</div>
              <div class="title">${cardTitle}</div>
            </div>
            ${this._renderSelector()}
          </div>
          ${
            this._status
              ? `<div class="status ${this._status.type}">${this._escapeHtml(this._status.message)}</div>`
              : ""
          }
          ${this._renderSummary(attrs)}
          <div class="body">${body}</div>
        </div>
      </ha-card>
    `;

    this._bindEvents();
  }

  _renderSelector() {
    const stateObj = this._stateObj(this._config.settings_target);
    const options = stateObj?.attributes?.options || [];
    const current = stateObj?.state || "";
    return `
      <div class="selector-row">
        <div class="label">Battery Selection</div>
        <select data-select="${this._config.settings_target}">
          ${options
            .map(
              (option) =>
                `<option value="${this._escapeHtml(option)}" ${
                  option === current ? "selected" : ""
                }>${this._escapeHtml(option)}</option>`
            )
            .join("")}
        </select>
      </div>
    `;
  }

  _renderMainPolicy(batteryPolicy) {
    if (!batteryPolicy || !Object.keys(batteryPolicy).length) {
      return `<div class="muted">Battery policy data is not available yet.</div>`;
    }
    return `
      ${this._renderChargeSection(batteryPolicy)}
      ${this._renderDischargeSection(batteryPolicy)}
      ${this._renderFeedinSection(this._stateObj(this._config.settings_target)?.attributes?.feedin_policy || {})}
    `;
  }

  _renderSummary(attrs) {
    const soc = this._readEntityNumber(this._config.summary_soc);
    const batteryPower = this._readEntityNumber(this._config.summary_battery_power);
    const batteryLoad = this._readEntityNumber(this._config.summary_battery_load);
    const activeImmediate = this._activeImmediateState(attrs);

    return `
      <div class="summary-grid">
        <div class="summary-card">
          <div class="summary-label">Current SOC</div>
          <div class="summary-value">${this._formatValue(soc, "%")}</div>
          <div class="summary-subtle">Live battery percentage</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Battery Charging</div>
          <div class="summary-value">${this._formatBatteryPower(batteryPower)}</div>
          <div class="summary-subtle">Live battery power</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Battery Load</div>
          <div class="summary-value">${this._formatValue(batteryLoad, "W")}</div>
          <div class="summary-subtle">Live house load</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Active Immediate State</div>
          <div class="summary-value">${this._escapeHtml(activeImmediate)}</div>
          <div class="summary-subtle">Current immediate action</div>
        </div>
      </div>
    `;
  }

  _renderChargeSection(summary) {
    const cycle = this._cycleState("charge");
    const rows = summary.charge_slots || [];
    const limit = summary.charge_slot_limit || 6;
    return this._renderSection(
      "charge",
      "&#9889;",
      "Battery Charge",
      `
        <div class="eyebrow">Immediate</div>
        <div class="copy">Native immediate action.</div>
        <div class="stack">
          <div class="field-title">Charge Until SOC</div>
          ${this._numberInput("force-charge-limit", this._entityNumberValue(this._config.charge_cap, 100), "%")}
        </div>
        ${this._renderImmediateAction(
          "charge",
          "Start Charging Now",
          "Stop Charging",
          "start_force_charge",
          "stop_force_charge",
          "primary"
        )}
      `,
      `
        <div class="eyebrow">Policy</div>
        <div class="policy-grid">
          ${this._toggleCell("Charge policy", this._config.charge_switch, "charge")}
          ${this._selectCell("Execution Cycle", this._config.execution_cycle, "charge", cycle.options)}
          ${this._numberCell("Charging stops at SOC", this._config.charge_cap, "charge", "%")}
          ${this._numberCell("Charge Power", this._config.charge_power, "charge", "W")}
        </div>
      `,
      `
        ${this._renderScheduleHead(limit)}
        ${this._renderBatterySchedule("charge", rows, cycle.weekly, limit, "Add Charge Row")}
        ${this._renderFooter("charge")}
      `
    );
  }

  _renderDischargeSection(summary) {
    const cycle = this._cycleState("discharge");
    const rows = summary.discharge_slots || [];
    const limit = summary.discharge_slot_limit || 6;
    return this._renderSection(
      "discharge",
      "&#8595;",
      "Battery Discharge",
      `
        <div class="eyebrow">Immediate</div>
        <div class="copy">Temporary helper row if a slot is available.</div>
        <div class="stack">
          <div class="field-title">Discharge Now</div>
          <div class="copy">Uses the first free discharge row.</div>
        </div>
        ${this._renderImmediateAction(
          "discharge",
          "Start Discharge Now",
          "Stop Discharge",
          "start_discharge_now",
          "stop_discharge_now",
          "purple"
        )}
      `,
      `
        <div class="eyebrow">Policy</div>
        <div class="policy-grid">
          ${this._toggleCell("Discharge policy", this._config.discharge_switch, "discharge")}
          ${this._numberCell("Discharge cutoff SOC", this._config.discharge_cutoff, "discharge", "%")}
          ${this._numberCell("Discharge Power", this._config.discharge_power, "discharge", "W")}
          ${this._selectCell("Execution Cycle", this._config.execution_cycle, "discharge", cycle.options)}
        </div>
      `,
      `
        ${this._renderScheduleHead(limit)}
        ${this._renderBatterySchedule("discharge", rows, cycle.weekly, limit, "Add Discharge Row")}
        ${this._renderFooter("discharge")}
      `
    );
  }

  _renderFeedinSection(summary) {
    if (!summary || !Object.keys(summary).length) {
      return this._renderSection(
        "feedin",
        "&#8593;",
        "Feed-in",
        `
          <div class="eyebrow">Immediate</div>
          <div class="copy">Temporary helper row if a slot is available.</div>
        `,
        `<div class="muted">Select an individual battery to edit feed-in policy.</div>`,
        ""
      );
    }

    const rows = summary.slots || [];
    const limit = summary.slot_limit || 6;
    return this._renderSection(
      "feedin",
      "&#8593;",
      "Feed-in",
      `
        <div class="eyebrow">Immediate</div>
        <div class="copy">Temporary helper row if a slot is available.</div>
        <div class="stack">
          <div class="field-title">Feed-in Now</div>
          <div class="copy">Uses the first free feed-in row.</div>
        </div>
        ${this._renderImmediateAction(
          "feedin",
          "Start Feed-in Now",
          "Stop Feed-in",
          "start_feedin_now",
          "stop_feedin_now",
          "green"
        )}
      `,
      `
        <div class="eyebrow">Policy</div>
        <div class="policy-grid">
          ${this._toggleCell("Feed-in policy", this._config.feedin_enabled, "feedin")}
          ${this._numberCell("Feed-in cutoff SOC", this._config.feedin_cutoff, "feedin", "%")}
        </div>
      `,
      `
        ${this._renderScheduleHead(limit)}
        ${this._renderFeedinSchedule(rows, limit, "Add Feed-in Row")}
        ${this._renderFooter("feedin")}
      `
    );
  }

  _renderSection(kind, icon, title, immediateBlock, policyBlock, scheduleBlock) {
    return `
      <div class="section">
        <div class="section-header">
          <div class="section-icon ${kind}">${icon}</div>
          <div class="section-title">${title}</div>
        </div>
        <div class="section-content">
          <div class="section-side immediate">
            <div class="immediate-panel">
              ${immediateBlock || ""}
            </div>
          </div>
          <div class="section-side policy">
            ${policyBlock || ""}
            ${scheduleBlock ? `<div class="section-divider"></div>${scheduleBlock}` : ""}
          </div>
        </div>
      </div>
    `;
  }

  _renderImmediateAction(kind, startLabel, stopLabel, startService, stopService, buttonClass) {
    const running = this._isImmediateRunning(kind);
    return `
      <div class="stack">
        <div class="immediate-status">
          <span class="immediate-status-dot ${running ? "running" : ""}"></span>
          <span>${running ? "Running" : "Stopped"}</span>
        </div>
        <div class="button-row single-action">
          <button
            class="${this._escapeHtml(buttonClass)}"
            data-immediate-kind="${kind}"
            data-start-service="${startService}"
            data-stop-service="${stopService}"
          >
            ${running ? stopLabel : startLabel}
          </button>
        </div>
      </div>
    `;
  }

  _renderScheduleHead(limit) {
    return `
      <div class="schedule-head">
        <div class="eyebrow">Schedule</div>
        <div class="schedule-note">(Max ${limit} rows)</div>
      </div>
    `;
  }

  _renderBatterySchedule(kind, rows, weekly, limit, addLabel) {
    if (!rows.length && weekly) {
      return `
        <div class="stack">
          ${this._renderBatterySlot(kind, { sort: 1, soc: "", start: "", end: "", power: "", weeks: [] }, true)}
          <button data-add-slot="${kind}">${addLabel}</button>
        </div>
      `;
    }

    return `
      <div class="stack">
        ${
          rows.length
            ? rows.map((slot) => this._renderBatterySlot(kind, slot, weekly)).join("")
            : `<div class="schedule-empty">No schedule rows defined.</div>`
        }
        ${
          rows.length < limit
            ? `<button data-add-slot="${kind}">${addLabel}</button>`
            : `<div class="muted">All rows are in use.</div>`
        }
      </div>
    `;
  }

  _renderFeedinSchedule(rows, limit, addLabel) {
    return `
      <div class="stack">
        ${
          rows.length
            ? rows.map((slot) => this._renderFeedinSlot(slot)).join("")
            : `<div class="schedule-empty">No schedule rows defined.</div>`
        }
        ${
          rows.length < limit
            ? `<button data-add-slot="feedin">${addLabel}</button>`
            : `<div class="muted">All rows are in use.</div>`
        }
      </div>
    `;
  }

  _renderBatterySlot(kind, slot, weekly) {
    const slotNo = slot.sort || 1;
    return `
      <div class="slot">
        <div class="slot-top">
          <div class="slot-name">Setting ${slotNo}</div>
          <div class="slot-grid">
            ${this._slotField("SOC (%)", `${kind}:${slotNo}:soc`, slot.soc, "number")}
            ${this._slotField("Start Time", `${kind}:${slotNo}:start`, slot.start, "time")}
            ${this._slotField("End Time", `${kind}:${slotNo}:end`, slot.end, "time")}
            ${this._slotField("Power (W)", `${kind}:${slotNo}:power`, slot.power, "number")}
          </div>
          <div class="slot-actions">
            <button class="primary" data-apply-slot="${kind}:${slotNo}">Apply</button>
            <button class="danger" data-delete-slot="${kind}:${slotNo}">Delete</button>
          </div>
        </div>
        ${
          weekly
            ? `
              <div class="stack">
                <div class="eyebrow">Days</div>
                ${this._dayChipGroup(kind, slotNo, slot.weeks || [])}
              </div>
            `
            : ""
        }
      </div>
    `;
  }

  _renderFeedinSlot(slot) {
    const slotNo = slot.sort || 1;
    return `
      <div class="slot">
        <div class="slot-top">
          <div class="slot-name">Setting ${slotNo}</div>
          <div class="slot-grid feedin">
            ${this._slotField("Start Time", `feedin:${slotNo}:start`, slot.start, "time")}
            ${this._slotField("End Time", `feedin:${slotNo}:end`, slot.end, "time")}
            ${this._slotField("Power (W)", `feedin:${slotNo}:power`, slot.power, "number")}
          </div>
          <div class="slot-actions">
            <button class="primary" data-apply-slot="feedin:${slotNo}">Apply</button>
            <button class="danger" data-delete-slot="feedin:${slotNo}">Delete</button>
          </div>
        </div>
      </div>
    `;
  }

  _renderFooter(section) {
    return `
      <div class="footer">
        <div class="footer-spacer"></div>
        <div class="footer-actions">
          <button data-discard-policy="${section}">Discard Policy Changes</button>
          <button class="primary" data-commit-policy="${section}">Commit Policy</button>
        </div>
      </div>
    `;
  }

  _toggleCell(label, entityId, section) {
    const checked = this._draftValue(
      section,
      entityId,
      this._stateObj(entityId)?.state === "on"
    );
    return `
      <div class="policy-cell switch">
        <div class="field-title">${label}</div>
        <input type="checkbox" data-policy-toggle="${entityId}" data-section="${section}" ${checked ? "checked" : ""} />
      </div>
    `;
  }

  _selectCell(label, entityId, section, options) {
    const state = this._stateObj(entityId);
    const current = this._draftValue(section, entityId, state?.state || "");
    return `
      <div class="policy-cell">
        <div class="field-title">${label}</div>
        <select data-policy-select="${entityId}" data-section="${section}">
          ${(options || [])
            .map(
              (option) =>
                `<option value="${this._escapeHtml(option)}" ${
                  option === current ? "selected" : ""
                }>${this._escapeHtml(option)}</option>`
            )
            .join("")}
        </select>
      </div>
    `;
  }

  _numberCell(label, entityId, section, unit) {
    const state = this._stateObj(entityId);
    const value = this._draftValue(
      section,
      entityId,
      this._normalizeNumberState(state?.state)
    );
    return `
      <div class="policy-cell">
        <div class="field-title">${label}</div>
        <div class="policy-value">
          <input type="number" data-policy-number="${entityId}" data-section="${section}" value="${this._escapeHtml(value ?? "")}" />
          <div>${this._escapeHtml(unit)}</div>
        </div>
      </div>
    `;
  }

  _numberInput(key, value, unit) {
    return `
      <div class="policy-value">
        <input type="number" data-key="${key}" value="${this._escapeHtml(this._normalizeNumberState(value))}" />
        <div>${this._escapeHtml(unit)}</div>
      </div>
    `;
  }

  _slotField(label, key, value, type) {
    const inputValue =
      type === "time" ? this._normalizeTimeValue(value) : this._normalizeNumberState(value);
    return `
      <div class="slot-field">
        <div class="eyebrow">${label}</div>
        <input type="${type}" data-slot-field="${key}" value="${this._escapeHtml(inputValue)}" />
      </div>
    `;
  }

  _dayChipGroup(kind, slotNo, weeks) {
    const labels = [
      [1, "Mon"],
      [2, "Tue"],
      [3, "Wed"],
      [4, "Thu"],
      [5, "Fri"],
      [6, "Sat"],
      [7, "Sun"],
    ];

    return `
      <div class="chips">
        ${labels
          .map(
            ([day, label]) =>
              `<button type="button" class="chip ${
                weeks.includes(day) ? "active" : ""
              }" data-day-chip="${kind}:${slotNo}:${day}">${label}</button>`
          )
          .join("")}
        <input type="hidden" data-slot-field="${kind}:${slotNo}:weeks" value="${this._escapeHtml(
          weeks.join(",")
        )}" />
      </div>
    `;
  }

  _cycleState(section) {
    const state = this._stateObj(this._config.execution_cycle);
    const value = this._draftValue(section, this._config.execution_cycle, state?.state || "");
    return {
      value,
      options: state?.attributes?.options || [],
      weekly: String(value).toLowerCase() === "weekly",
    };
  }

  _stateObj(entityId) {
    return entityId ? this._hass.states[entityId] : null;
  }

  _draftBucket(section) {
    this._drafts[section] = this._drafts[section] || {};
    return this._drafts[section];
  }

  _draftValue(section, key, fallback) {
    const bucket = this._draftBucket(section);
    return Object.prototype.hasOwnProperty.call(bucket, key) ? bucket[key] : fallback;
  }

  _setDraftValue(section, key, value) {
    this._draftBucket(section)[key] = value;
  }

  _clearSectionDraft(section) {
    this._drafts[section] = {};
  }

  _entityNumberValue(entityId, fallback) {
    const current = Number(this._stateObj(entityId)?.state);
    return Number.isFinite(current) ? current : fallback;
  }

  _readEntityNumber(entityId) {
    const current = Number(this._stateObj(entityId)?.state);
    return Number.isFinite(current) ? current : null;
  }

  _isImmediateRunning(kind) {
    return Boolean(this._immediateState?.[kind]);
  }

  _resetImmediateState() {
    this._immediateState = {
      charge: false,
      discharge: false,
      feedin: false,
    };
  }

  _activeImmediateState(attrs) {
    const states = [];
    if (attrs?.battery_policy?.force_charge_active) {
      states.push("Charging");
    }
    if (attrs?.battery_policy?.temporary_discharge_now) {
      states.push("Discharging");
    }
    if (attrs?.feedin_policy?.temporary_feedin_now) {
      states.push("Feed-in");
    }
    if (!states.length) {
      if (this._isImmediateRunning("charge")) states.push("Charging");
      if (this._isImmediateRunning("discharge")) states.push("Discharging");
      if (this._isImmediateRunning("feedin")) states.push("Feed-in");
    }
    return states.length ? states.join(", ") : "Idle";
  }

  _formatValue(value, unit = "") {
    if (!Number.isFinite(value)) {
      return "Unavailable";
    }
    return `${value}${unit ? ` ${unit}` : ""}`;
  }

  _formatBatteryPower(value) {
    if (!Number.isFinite(value)) {
      return "Unavailable";
    }
    if (value > 0) {
      return `Charging ${value} W`;
    }
    if (value < 0) {
      return `Discharging ${Math.abs(value)} W`;
    }
    return "Idle 0 W";
  }

  _nextAvailableSlot(slots, limit) {
    const used = new Set(
      (slots || [])
        .map((slot) => Number(slot?.sort))
        .filter((slot) => Number.isInteger(slot) && slot > 0)
    );

    for (let slot = 1; slot <= limit; slot += 1) {
      if (!used.has(slot)) return slot;
    }
    return null;
  }

  _normalizeNumberState(value) {
    if (value === undefined || value === null) return "";
    const text = String(value);
    return text === "unknown" || text === "unavailable" ? "" : text;
  }

  _normalizeTimeValue(value) {
    const text = this._normalizeNumberState(value);
    if (!text) return "";
    return text.length >= 5 ? text.slice(0, 5) : text;
  }

  _collectSlotValues(kind, slotNo) {
    const fields = {};
    ["start", "end", "soc", "power", "weeks"].forEach((field) => {
      const node = this.shadowRoot.querySelector(`[data-slot-field="${kind}:${slotNo}:${field}"]`);
      if (node && node.value !== "") fields[field] = node.value;
    });
    return fields;
  }

  async _callByteWatt(service, data = {}) {
    await this._hass.callService("bytewatt", service, data);
  }

  _setStatus(type, message) {
    this._status = { type, message };
    this.render();
  }

  _errorMessage(error) {
    return (
      error?.body?.message ||
      error?.error?.message ||
      error?.message ||
      String(error || "Unknown error")
    );
  }

  async _run(action, successMessage, failurePrefix) {
    try {
      await action();
      this._setStatus("success", successMessage);
    } catch (error) {
      this._setStatus("error", `${failurePrefix}: ${this._errorMessage(error)}`);
    }
  }

  _defaultWindow() {
    return { start: "00:00", end: "00:15" };
  }

  async _applySlot(kind, slotNo) {
    await this._run(() => this._applySlotRequest(kind, slotNo), "Row updated", "Row update failed");
  }

  async _applySlotRequest(kind, slotNo) {
    const fields = this._collectSlotValues(kind, slotNo);
    if (kind === "feedin") {
      await this._callByteWatt("update_grid_feedin_slot", {
        slot: Number(slotNo),
        ...(fields.start ? { start_time: fields.start } : {}),
        ...(fields.end ? { end_time: fields.end } : {}),
        ...(fields.power ? { power_watts: Number(fields.power) } : {}),
      });
      return;
    }

    await this._callByteWatt("update_battery_slot", {
      policy_kind: kind,
      slot: Number(slotNo),
      ...(fields.start ? { start_time: fields.start } : {}),
      ...(fields.end ? { end_time: fields.end } : {}),
      ...(fields.soc ? { soc: Number(fields.soc) } : {}),
      ...(fields.power ? { power_watts: Number(fields.power) } : {}),
      ...(fields.weeks
        ? {
            weeks: fields.weeks
              .split(",")
              .map((item) => Number(item.trim()))
              .filter((item) => Number.isFinite(item)),
          }
        : {}),
    });
  }

  async _deleteSlot(kind, slotNo) {
    await this._run(
      async () => {
        if (kind === "feedin") {
          await this._callByteWatt("delete_grid_feedin_slot", { slot: Number(slotNo) });
        } else {
          await this._callByteWatt("delete_battery_slot", {
            policy_kind: kind,
            slot: Number(slotNo),
          });
        }
      },
      "Row deleted",
      "Delete failed"
    );
  }

  async _addSlot(kind) {
    const window = this._defaultWindow();
    await this._run(
      async () => {
        if (kind === "feedin") {
          const policy =
            this._stateObj(this._config.settings_target)?.attributes?.feedin_policy || {};
          const slotNo = this._nextAvailableSlot(policy.slots || [], policy.slot_limit || 6);
          if (!slotNo) {
            throw new Error("No free feed-in slots available");
          }
          await this._callByteWatt("update_grid_feedin_slot", {
            slot: slotNo,
            start_time: window.start,
            end_time: window.end,
            power_watts: 1000,
          });
          return;
        }

        const policy =
          this._stateObj(this._config.settings_target)?.attributes?.battery_policy || {};
        const slotKey = kind === "charge" ? "charge_slots" : "discharge_slots";
        const slotLimit =
          kind === "charge" ? policy.charge_slot_limit || 6 : policy.discharge_slot_limit || 6;
        const slotNo = this._nextAvailableSlot(policy[slotKey] || [], slotLimit);
        if (!slotNo) {
          throw new Error(`No free ${kind} slots available`);
        }

        const soc =
          kind === "charge"
            ? this._entityNumberValue(this._config.charge_cap, 100)
            : this._entityNumberValue(this._config.discharge_cutoff, 10);
        const power =
          kind === "charge"
            ? this._entityNumberValue(this._config.charge_power, 5000)
            : this._entityNumberValue(this._config.discharge_power, 5000);
        const cycle = this._draftValue(
          kind,
          this._config.execution_cycle,
          this._stateObj(this._config.execution_cycle)?.state || "Daily"
        );

        await this._callByteWatt("update_battery_slot", {
          policy_kind: kind,
          slot: slotNo,
          start_time: window.start,
          end_time: window.end,
          soc,
          power_watts: power,
          ...(String(cycle).toLowerCase() === "weekly"
            ? { weeks: [1, 2, 3, 4, 5, 6, 7] }
            : {}),
        });
      },
      "Row added",
      "Add row failed"
    );
  }

  _runNowData(service) {
    const data = {};
    if (service === "start_force_charge") {
      const node = this.shadowRoot.querySelector('[data-key="force-charge-limit"]');
      data.charge_cap = Number(
        node?.value || this._entityNumberValue(this._config.charge_cap, 100)
      );
    }
    if (service === "start_discharge_now") {
      data.soc = this._entityNumberValue(this._config.discharge_cutoff, 10);
      data.power_watts = this._entityNumberValue(this._config.discharge_power, 5000);
      data.duration_minutes = 60;
    }
    if (service === "start_feedin_now") {
      data.power_watts = 1000;
      data.duration_minutes = 60;
    }
    return data;
  }

  async _runNow(service) {
    const data = this._runNowData(service);
    await this._run(() => this._callByteWatt(service, data), "Action sent", "Action failed");
  }

  async _toggleImmediate(kind, startService, stopService) {
    const running = this._isImmediateRunning(kind);
    const service = running ? stopService : startService;
    const data = this._runNowData(service);
    const successMessage = running
      ? `${kind === "feedin" ? "Feed-in" : kind[0].toUpperCase() + kind.slice(1)} stopped`
      : `${kind === "feedin" ? "Feed-in" : kind[0].toUpperCase() + kind.slice(1)} started`;

    try {
      await this._callByteWatt(service, data);
      this._immediateState[kind] = !running;
      this._setStatus("success", successMessage);
    } catch (error) {
      this._setStatus("error", `Action failed: ${this._errorMessage(error)}`);
    }
  }

  async _commitPolicy(section) {
    await this._run(
      async () => {
        if (section === "charge" || section === "discharge") {
          await this._commitBatteryPolicy(section);
        } else if (section === "feedin") {
          await this._commitFeedinPolicy();
        }
        this._clearSectionDraft(section);
      },
      "Policy committed",
      "Policy commit failed"
    );
  }

  async _commitBatteryPolicy(section) {
    const toggleEntity =
      section === "charge" ? this._config.charge_switch : this._config.discharge_switch;
    const toggleDesired = this._draftValue(
      section,
      toggleEntity,
      this._stateObj(toggleEntity)?.state === "on"
    );
    await this._setSwitchIfNeeded(toggleEntity, toggleDesired);

    const cycleDesired = this._draftValue(
      section,
      this._config.execution_cycle,
      this._stateObj(this._config.execution_cycle)?.state
    );
    await this._selectIfNeeded(this._config.execution_cycle, cycleDesired);

    if (section === "charge") {
      await this._setNumberIfNeeded(
        this._config.charge_cap,
        this._draftValue(
          section,
          this._config.charge_cap,
          this._stateObj(this._config.charge_cap)?.state
        )
      );
      await this._setNumberIfNeeded(
        this._config.charge_power,
        this._draftValue(
          section,
          this._config.charge_power,
          this._stateObj(this._config.charge_power)?.state
        )
      );
    } else {
      await this._setNumberIfNeeded(
        this._config.discharge_cutoff,
        this._draftValue(
          section,
          this._config.discharge_cutoff,
          this._stateObj(this._config.discharge_cutoff)?.state
        )
      );
      await this._setNumberIfNeeded(
        this._config.discharge_power,
        this._draftValue(
          section,
          this._config.discharge_power,
          this._stateObj(this._config.discharge_power)?.state
        )
      );
    }

    const summary = this._stateObj(this._config.settings_target)?.attributes?.battery_policy || {};
    const slots = section === "charge" ? summary.charge_slots || [] : summary.discharge_slots || [];
    for (const slot of slots) {
      await this._applySlotRequest(section, String(slot.sort));
    }
  }

  async _commitFeedinPolicy() {
    const enabled = this._draftValue(
      "feedin",
      this._config.feedin_enabled,
      this._stateObj(this._config.feedin_enabled)?.state === "on"
    );
    await this._setSwitchIfNeeded(this._config.feedin_enabled, enabled);
    await this._setNumberIfNeeded(
      this._config.feedin_cutoff,
      this._draftValue(
        "feedin",
        this._config.feedin_cutoff,
        this._stateObj(this._config.feedin_cutoff)?.state
      )
    );

    const summary = this._stateObj(this._config.settings_target)?.attributes?.feedin_policy || {};
    for (const slot of summary.slots || []) {
      await this._applySlotRequest("feedin", String(slot.sort));
    }
  }

  async _setSwitchIfNeeded(entityId, desiredOn) {
    const currentOn = this._stateObj(entityId)?.state === "on";
    if (currentOn === Boolean(desiredOn)) return;
    await this._hass.callService("homeassistant", desiredOn ? "turn_on" : "turn_off", {
      entity_id: entityId,
    });
  }

  async _selectIfNeeded(entityId, desiredOption) {
    if (!entityId || desiredOption === undefined || desiredOption === null) return;
    if (this._stateObj(entityId)?.state === desiredOption) return;
    await this._hass.callService("select", "select_option", {
      entity_id: entityId,
      option: desiredOption,
    });
  }

  async _setNumberIfNeeded(entityId, desiredValue) {
    if (!entityId || desiredValue === undefined || desiredValue === null || desiredValue === "") {
      return;
    }
    const current = Number(this._stateObj(entityId)?.state);
    const desired = Number(desiredValue);
    if (Number.isFinite(current) && Number.isFinite(desired) && current === desired) return;
    await this._hass.callService("number", "set_value", {
      entity_id: entityId,
      value: desired,
    });
  }

  _bindEvents() {
    this.shadowRoot.querySelectorAll("[data-select]").forEach((node) => {
      node.addEventListener("change", (event) => {
        this._run(
          async () => {
            await this._hass.callService("select", "select_option", {
              entity_id: node.dataset.select,
              option: event.target.value,
            });
            this._resetImmediateState();
          },
          "Selection updated",
          "Selection failed"
        );
      });
    });

    this.shadowRoot.querySelectorAll("[data-policy-toggle]").forEach((node) => {
      node.addEventListener("change", () => {
        this._setDraftValue(node.dataset.section, node.dataset.policyToggle, node.checked);
      });
    });

    this.shadowRoot.querySelectorAll("[data-policy-number]").forEach((node) => {
      node.addEventListener("input", () => {
        this._setDraftValue(node.dataset.section, node.dataset.policyNumber, node.value);
      });
    });

    this.shadowRoot.querySelectorAll("[data-policy-select]").forEach((node) => {
      node.addEventListener("change", (event) => {
        this._setDraftValue(node.dataset.section, node.dataset.policySelect, event.target.value);
        if (node.dataset.policySelect === this._config.execution_cycle) {
          this.render();
        }
      });
    });

    this.shadowRoot.querySelectorAll("[data-service]").forEach((node) => {
      node.addEventListener("click", () => this._runNow(node.dataset.service));
    });

    this.shadowRoot.querySelectorAll("[data-immediate-kind]").forEach((node) => {
      node.addEventListener("click", () =>
        this._toggleImmediate(
          node.dataset.immediateKind,
          node.dataset.startService,
          node.dataset.stopService
        )
      );
    });

    this.shadowRoot.querySelectorAll("[data-apply-slot]").forEach((node) => {
      node.addEventListener("click", () => {
        const [kind, slotNo] = node.dataset.applySlot.split(":");
        this._applySlot(kind, slotNo);
      });
    });

    this.shadowRoot.querySelectorAll("[data-delete-slot]").forEach((node) => {
      node.addEventListener("click", () => {
        const [kind, slotNo] = node.dataset.deleteSlot.split(":");
        this._deleteSlot(kind, slotNo);
      });
    });

    this.shadowRoot.querySelectorAll("[data-add-slot]").forEach((node) => {
      node.addEventListener("click", () => this._addSlot(node.dataset.addSlot));
    });

    this.shadowRoot.querySelectorAll("[data-commit-policy]").forEach((node) => {
      node.addEventListener("click", () => this._commitPolicy(node.dataset.commitPolicy));
    });

    this.shadowRoot.querySelectorAll("[data-discard-policy]").forEach((node) => {
      node.addEventListener("click", () => {
        this._clearSectionDraft(node.dataset.discardPolicy);
        this.render();
      });
    });

    this.shadowRoot.querySelectorAll("[data-day-chip]").forEach((node) => {
      node.addEventListener("click", () => {
        const [kind, slotNo, day] = node.dataset.dayChip.split(":");
        const hidden = this.shadowRoot.querySelector(
          `[data-slot-field="${kind}:${slotNo}:weeks"]`
        );
        const current = (hidden?.value || "")
          .split(",")
          .map((item) => Number(item.trim()))
          .filter((item) => Number.isFinite(item));
        const dayNum = Number(day);
        const next = current.includes(dayNum)
          ? current.filter((item) => item !== dayNum)
          : [...current, dayNum];
        next.sort((a, b) => a - b);
        if (hidden) hidden.value = next.join(",");
        node.classList.toggle("active", next.includes(dayNum));
      });
    });
  }

  _escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
}

if (!customElements.get("bytewatt-policy-card")) {
  customElements.define("bytewatt-policy-card", ByteWattPolicyCard);
}

window.customCards = window.customCards || [];
window.customCards.push({
  type: "bytewatt-policy-card",
  name: "ByteWatt Policy Card",
  description: `ByteWatt policy card build ${BYTEWATT_POLICY_CARD_BUILD}.`,
});

window.bytewattPolicyCardBuild = BYTEWATT_POLICY_CARD_BUILD;
