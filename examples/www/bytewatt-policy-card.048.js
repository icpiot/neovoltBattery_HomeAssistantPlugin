const BYTEWATT_POLICY_CARD_BUILD = "048";

class ByteWattPolicyCard extends HTMLElement {
  setConfig(config) {
    const variant = config?.variant || "battery_policy";
    if (!["battery_policy", "feedin_policy"].includes(variant)) {
      throw new Error("variant is required: battery_policy or feedin_policy");
    }
    this._config = this._withDefaults({ ...config, variant });
    this._drafts = this._drafts || {};
    this._immediateDrafts = this._immediateDrafts || {};
    this._immediateState = this._immediateState || {};
    this._slotDrafts = this._slotDrafts || {};
    this._slotDeleted = this._slotDeleted || {};
    this._autoRenderSuspended = this._autoRenderSuspended || false;
    this._pendingStateRender = this._pendingStateRender || false;
    this._editingSection = this._editingSection || null;
    this._editReleaseTimer = this._editReleaseTimer || null;
    this._status = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (this._autoRenderSuspended) {
      this._pendingStateRender = true;
      return;
    }
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
      offgrid_switch:
        config.offgrid_switch || `switch.${prefix}_offgrid_soc_control`,
      offgrid_wakeup_soc:
        config.offgrid_wakeup_soc || `number.${prefix}_offgrid_wakeup_soc`,
      offgrid_cutoff_soc:
        config.offgrid_cutoff_soc || `number.${prefix}_offgrid_cutoff_soc`,
      summary_soc: config.summary_soc || `sensor.${prefix}_battery_percentage`,
      summary_battery_power: config.summary_battery_power || `sensor.${prefix}_battery_power`,
      summary_battery_load: config.summary_battery_load || `sensor.${prefix}_house_consumption`,
    };
  }

  render() {
    if (!this._hass || !this._config) return;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });
    const scrollRoot = this._scrollRoot();
    const preservedScrollTop = scrollRoot ? scrollRoot.scrollTop : null;

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
            radial-gradient(circle at top right, rgba(67, 140, 255, 0.18), transparent 28%),
            radial-gradient(circle at bottom left, rgba(32, 80, 160, 0.12), transparent 34%),
            linear-gradient(180deg, #17263a 0%, #101926 100%);
          border: 1px solid rgba(130, 177, 255, 0.14);
          border-radius: 18px;
          color: #fff;
          overflow: hidden;
          box-shadow: 0 22px 44px rgba(0,0,0,0.32);
        }
        :host {
          --bytewatt-soc-width: 88px;
          --bytewatt-power-width: 110px;
          --bytewatt-time-width: 104px;
          --bytewatt-duration-width: 56px;
          --bytewatt-select-width: 132px;
          --bytewatt-action-width: 170px;
        }
        .shell {
          display: grid;
          gap: 10px;
          padding: 14px;
          box-sizing: border-box;
        }
        .header {
          display: grid;
          gap: 12px;
        }
        .title-row {
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .title-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .title-icon {
          width: 28px;
          height: 28px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #8dc5ff;
          background: linear-gradient(180deg, rgba(52, 120, 220, 0.26), rgba(44, 92, 168, 0.14));
          border: 1px solid rgba(97, 170, 255, 0.34);
          box-shadow: 0 0 0 1px rgba(255,255,255,0.03) inset, 0 8px 18px rgba(38, 92, 170, 0.24);
          font-size: 1rem;
          font-weight: 800;
        }
        .title {
          font-size: 1.15rem;
          font-weight: 800;
        }
        .version-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 4px 8px;
          border-radius: 999px;
          font-size: 0.76rem;
          font-weight: 800;
          letter-spacing: 0.04em;
          color: #e9f5ff;
          background: linear-gradient(180deg, rgba(68, 134, 230, 0.3), rgba(50, 102, 184, 0.18));
          border: 1px solid rgba(108, 180, 255, 0.34);
          box-shadow: 0 6px 14px rgba(26, 70, 136, 0.2);
        }
        .selector-row {
          display: grid;
          grid-template-columns: 140px minmax(0, 1fr);
          gap: 18px;
          align-items: center;
        }
        .selector-row select {
          width: min(100%, 360px);
          justify-self: start;
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
          grid-template-columns: repeat(5, minmax(0, 1fr));
          gap: 12px;
          align-items: stretch;
        }
        .summary-stack {
          display: grid;
          gap: 12px;
        }
        .summary-subgrid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 12px;
        }
        .summary-card {
          position: relative;
          display: grid;
          gap: 8px;
          min-width: 0;
          padding: 12px 14px 14px;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,0.1);
          background:
            linear-gradient(180deg, rgba(255,255,255,0.065), rgba(255,255,255,0.028)),
            rgba(17,29,44,0.82);
          overflow: hidden;
          transition: transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
        }
        .summary-card:hover {
          transform: translateY(-1px);
          border-color: rgba(146, 193, 255, 0.22);
          box-shadow: 0 12px 26px rgba(0,0,0,0.22);
        }
        .summary-label {
          color: rgba(122, 171, 242, 0.95);
          font-size: 0.76rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          line-height: 1.2;
          white-space: normal;
          overflow-wrap: anywhere;
        }
        .summary-value {
          color: #fff;
          font-size: 1.1rem;
          font-weight: 800;
          line-height: 1.2;
          word-break: break-word;
        }
        .summary-meter {
          position: relative;
          height: 5px;
          border-radius: 999px;
          background: rgba(255,255,255,0.08);
          overflow: hidden;
        }
        .summary-meter span {
          position: absolute;
          inset: 0 auto 0 0;
          border-radius: inherit;
          background: linear-gradient(90deg, rgba(87, 157, 255, 0.85), rgba(120, 210, 255, 1));
          box-shadow: 0 0 12px rgba(87, 157, 255, 0.55);
        }
        .summary-card.live::after {
          content: "";
          position: absolute;
          inset: auto -24% 0 -24%;
          height: 3px;
          background: linear-gradient(90deg, transparent, rgba(115, 194, 255, 0.95), transparent);
          animation: summary-sweep 2.4s linear infinite;
        }
        .summary-card.charging {
          border-color: rgba(79, 152, 255, 0.34);
          box-shadow: 0 12px 28px rgba(52, 107, 187, 0.24);
        }
        .summary-card.discharging {
          border-color: rgba(154, 109, 255, 0.34);
          box-shadow: 0 12px 28px rgba(94, 53, 177, 0.22);
        }
        .summary-card.feedin {
          border-color: rgba(102, 214, 117, 0.34);
          box-shadow: 0 12px 28px rgba(41, 130, 58, 0.22);
        }
        .summary-card.idle {
          border-color: rgba(255,255,255,0.1);
        }
        .summary-card.unavailable {
          opacity: 0.86;
        }
        .summary-card .summary-value.live-pulse {
          animation: summary-pulse 1.85s ease-in-out infinite;
        }
        .summary-card.battery-breakout {
          gap: 10px;
          padding: 12px 14px;
        }
        .summary-title {
          color: #fff;
          font-size: 0.95rem;
          font-weight: 800;
          line-height: 1.2;
          word-break: break-word;
        }
        .summary-meta {
          color: rgba(220, 230, 243, 0.56);
          font-size: 0.76rem;
          font-weight: 600;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          line-height: 1.2;
          white-space: normal;
          overflow-wrap: anywhere;
        }
        .summary-breakout-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
        }
        .summary-breakout-cell {
          display: grid;
          gap: 4px;
          min-width: 0;
        }
        .summary-breakout-label {
          color: rgba(122, 171, 242, 0.92);
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          line-height: 1.2;
          white-space: normal;
          overflow-wrap: anywhere;
        }
        .summary-breakout-value {
          color: #fff;
          font-size: 0.96rem;
          font-weight: 800;
          line-height: 1.2;
          word-break: break-word;
        }
        .section {
          display: grid;
          gap: 12px;
          border: 1px solid rgba(255,255,255,0.09);
          border-radius: 16px;
          background:
            linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.018)),
            rgba(17, 26, 40, 0.72);
          padding: 12px;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
        }
        .section-content {
          display: grid;
          grid-template-columns: minmax(280px, 0.95fr) minmax(420px, 1.55fr);
          gap: 0;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px;
          overflow: hidden;
          background:
            linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01)),
            rgba(11, 20, 32, 0.42);
        }
        .section-side {
          display: grid;
          gap: 10px;
          min-width: 0;
          padding: 12px;
          align-content: start;
          grid-auto-rows: max-content;
        }
        .section-side.immediate {
          background: transparent;
          border-right: 1px solid rgba(255,255,255,0.08);
        }
        .immediate-panel {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          justify-content: flex-start;
          gap: 12px;
          min-height: 0;
          align-self: start;
          padding: 12px;
          border-radius: 12px;
          background: linear-gradient(180deg, rgba(18, 26, 38, 0.92), rgba(16, 24, 36, 0.88));
          border: 1px solid rgba(255,255,255,0.07);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.02);
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
        .section-icon.offgrid {
          color: #8ec7ff;
          background: rgba(142, 199, 255, 0.16);
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
        .pending-banner {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 10px;
          background: rgba(255, 196, 0, 0.12);
          border: 1px solid rgba(255, 196, 0, 0.22);
          color: #ffd979;
          font-size: 0.84rem;
          font-weight: 700;
        }
        .stack {
          display: grid;
          gap: 12px;
        }
        .field-title {
          font-size: 0.93rem;
          font-weight: 700;
        }
        .field-title.compact {
          color: rgba(236, 242, 250, 0.92);
          font-size: 0.76rem;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          line-height: 1.2;
          min-height: 1.85rem;
          display: flex;
          align-items: flex-end;
        }
        .field-note {
          color: rgba(132, 184, 255, 0.88);
          font-size: 0.7rem;
          line-height: 1.25;
        }
        .field-note.inline {
          margin: 0;
          white-space: normal;
          overflow-wrap: anywhere;
          max-width: 170px;
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
        .charge-policy-grid {
          grid-template-columns:
            var(--bytewatt-select-width)
            var(--bytewatt-soc-width)
            var(--bytewatt-power-width);
          gap: 12px 22px;
          align-items: end;
          justify-content: start;
        }
        .discharge-policy-grid {
          grid-template-columns:
            var(--bytewatt-select-width)
            var(--bytewatt-soc-width)
            var(--bytewatt-power-width);
          gap: 12px 22px;
          align-items: end;
          justify-content: start;
        }
        .offgrid-policy-grid {
          grid-template-columns: repeat(2, minmax(0, max-content));
          gap: 12px 20px;
          align-items: end;
          justify-content: start;
        }
        .policy-cell {
          display: grid;
          gap: 8px;
          min-width: 0;
          align-content: start;
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
        .policy-value.inline-note {
          display: inline-flex;
          align-items: center;
          justify-content: flex-start;
          gap: 8px;
          width: max-content;
          max-width: none;
        }
        .policy-value.immediate-value {
          display: inline-flex;
          align-items: center;
          justify-content: flex-start;
          gap: 0;
          width: auto;
        }
        .policy-value.immediate-value input {
          width: auto;
          min-width: 0;
        }
        .policy-value.immediate-value.soc input {
          width: var(--bytewatt-soc-width);
        }
        .policy-value.immediate-value.power input {
          width: var(--bytewatt-power-width);
        }
        .policy-value.immediate-value.duration input {
          width: var(--bytewatt-duration-width);
        }
        .policy-value.immediate-inline-note {
          display: inline-flex;
          align-items: flex-start;
          justify-content: flex-start;
          gap: 8px;
          width: min(100%, calc(var(--bytewatt-power-width) + 190px));
          max-width: 100%;
          flex-wrap: wrap;
        }
        .policy-value.immediate-inline-note input {
          width: var(--bytewatt-power-width);
        }
        .policy-cell.select-cell select {
          width: var(--bytewatt-select-width);
          justify-self: start;
        }
        .policy-cell.number-cell .policy-value {
          justify-content: start;
        }
        .policy-cell.number-cell.percent .policy-value {
          grid-template-columns: var(--bytewatt-soc-width);
        }
        .policy-cell.number-cell.watt .policy-value {
          grid-template-columns: var(--bytewatt-power-width);
        }
        .policy-cell.number-cell.watt .policy-value.inline-note {
          grid-template-columns: none;
        }
        .policy-cell.number-cell .policy-value input {
          width: 100%;
        }
        .policy-cell.number-cell.watt .policy-value.inline-note input {
          width: var(--bytewatt-power-width);
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
        .slot.pending {
          border-color: rgba(255, 196, 0, 0.22);
          box-shadow: inset 0 0 0 1px rgba(255, 196, 0, 0.08);
        }
        .slot.deleted {
          opacity: 0.72;
          border-color: rgba(255, 107, 107, 0.2);
          background: rgba(120, 26, 26, 0.08);
        }
        .slot-top {
          display: grid;
          gap: 14px;
        }
        .slot-name {
          font-size: 0.92rem;
          font-weight: 800;
        }
        .slot-badge {
          display: inline-block;
          margin-left: 8px;
          padding: 2px 6px;
          border-radius: 999px;
          background: rgba(255, 196, 0, 0.15);
          color: #ffd979;
          font-size: 0.68rem;
          font-weight: 800;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          vertical-align: middle;
        }
        .slot-badge.delete {
          background: rgba(255, 107, 107, 0.16);
          color: #ffb3b3;
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
        .slot-value.inline-note {
          display: inline-flex;
          align-items: flex-start;
          justify-content: flex-start;
          gap: 8px;
          width: min(100%, calc(var(--bytewatt-power-width) + 190px));
          max-width: 100%;
          flex-wrap: wrap;
        }
        .slot-field.time input {
          width: var(--bytewatt-time-width);
        }
        .slot-field.soc input {
          width: var(--bytewatt-soc-width);
        }
        .slot-field.power input {
          width: var(--bytewatt-power-width);
        }
        .charge-slot {
          gap: 8px;
          padding: 12px;
        }
        .charge-slot-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }
        .charge-slot-grid {
          display: grid;
          grid-template-columns:
            var(--bytewatt-soc-width)
            var(--bytewatt-time-width)
            var(--bytewatt-time-width)
            var(--bytewatt-power-width);
          gap: 10px 18px;
          min-width: 0;
          align-items: end;
          justify-content: start;
        }
        .charge-slot-grid.immediate-grid-compact {
          display: flex;
          flex-wrap: wrap;
          align-items: end;
          gap: 14px 16px;
          justify-content: flex-start;
        }
        .charge-slot-grid.immediate-grid-compact .slot-field {
          flex: 0 0 auto;
          align-content: start;
        }
        .charge-slot-grid.immediate-grid-compact.two {
          gap: 14px 16px;
        }
        .charge-slot-grid.immediate-grid-compact .slot-field.power {
          flex-basis: calc(var(--bytewatt-power-width) + 190px);
        }
        .slot-delete-icon {
          width: 28px;
          min-width: 28px;
          height: 28px;
          padding: 0;
          border-radius: 6px;
          border: 1px solid rgba(255,255,255,0.08);
          background: rgba(255,255,255,0.06);
          color: rgba(220, 230, 243, 0.8);
          font-size: 1rem;
          line-height: 1;
        }
        .slot-delete-icon:hover {
          background: rgba(169, 70, 58, 0.18);
          color: #fff;
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
          justify-content: flex-end;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
        }
        .footer-actions {
          display: inline-flex;
          justify-content: flex-end;
          gap: 10px;
          width: auto;
        }
        .footer-actions button {
          min-width: var(--bytewatt-action-width);
        }
        .commit-button {
          min-width: 150px;
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
          height: 32px;
          padding: 5px 9px;
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
          height: 32px;
          padding: 5px 10px;
          color: #fff;
          font-weight: 700;
          font-size: 0.88rem;
          background: rgba(255,255,255,0.08);
          cursor: pointer;
          white-space: nowrap;
          line-height: 1;
        }
        button.primary {
          background: linear-gradient(90deg, #3275e3 0%, #53a0ff 100%);
          border-color: transparent;
          box-shadow: 0 10px 22px rgba(50, 117, 227, 0.22);
        }
        button.purple {
          background: linear-gradient(90deg, #8846f4 0%, #b36dff 100%);
          border-color: transparent;
          box-shadow: 0 10px 22px rgba(136, 70, 244, 0.2);
        }
        button.green {
          background: linear-gradient(90deg, #63b84b 0%, #86e367 100%);
          border-color: transparent;
          box-shadow: 0 10px 22px rgba(99, 184, 75, 0.18);
        }
        button.danger {
          background: linear-gradient(90deg, rgba(127, 53, 45, 0.95) 0%, rgba(169, 70, 58, 0.95) 100%);
          border-color: transparent;
        }
        .status {
          padding: 10px 12px;
          border-radius: 10px;
          border: 1px solid rgba(255,255,255,0.08);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.02);
        }
        .status.success {
          background: linear-gradient(180deg, rgba(62,142,92,0.2), rgba(45,108,70,0.14));
          color: #c6f5d2;
        }
        .status.error {
          background: linear-gradient(180deg, rgba(163,52,52,0.24), rgba(118,38,38,0.16));
          color: #ffd3d3;
        }
        .status.info {
          background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.035));
          color: rgba(220, 230, 243, 0.82);
        }
        @keyframes summary-sweep {
          from { transform: translateX(-18%); opacity: 0.5; }
          50% { opacity: 1; }
          to { transform: translateX(18%); opacity: 0.5; }
        }
        @keyframes summary-pulse {
          0%, 100% { transform: translateY(0); opacity: 0.92; }
          50% { transform: translateY(-1px); opacity: 1; }
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
          .selector-row,
          .button-row,
          .charge-policy-grid,
          .discharge-policy-grid,
          .charge-slot-grid,
          .immediate-grid-compact,
          .immediate-grid-compact.two,
          .slot-grid,
          .slot-grid.feedin,
          .footer-actions {
            grid-template-columns: 1fr;
          }
          .summary-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 6px;
          }
          .summary-card {
            gap: 6px;
            padding: 9px 8px 10px;
            border-radius: 12px;
          }
          .summary-label,
          .summary-breakout-label {
            font-size: 0.62rem;
            letter-spacing: 0.03em;
          }
          .summary-value {
            font-size: 0.92rem;
          }
          .summary-title {
            font-size: 0.84rem;
          }
          .summary-meta {
            font-size: 0.68rem;
          }
          .summary-subgrid {
            grid-template-columns: 1fr;
            gap: 8px;
          }
          .summary-breakout-grid {
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 6px;
          }
          .summary-breakout-value {
            font-size: 0.82rem;
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
        @media (max-width: 640px) and (orientation: portrait) {
          .summary-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
            gap: 6px !important;
          }
          .summary-card {
            gap: 6px !important;
            padding: 9px 8px 10px !important;
            border-radius: 12px !important;
          }
          .summary-label,
          .summary-breakout-label {
            font-size: 0.62rem !important;
            letter-spacing: 0.03em !important;
          }
          .summary-value {
            font-size: 0.92rem !important;
          }
          .summary-title {
            font-size: 0.84rem !important;
          }
          .summary-meta {
            font-size: 0.68rem !important;
          }
        }
      </style>
      <ha-card>
        <div class="shell">
          <div class="header">
            <div class="title-row">
              <div class="title-icon">${cardIcon}</div>
              <div class="title-wrap">
                <div class="title">${cardTitle}</div>
                <div class="version-badge">v${BYTEWATT_POLICY_CARD_BUILD}</div>
              </div>
            </div>
            ${this._renderSelector()}
          </div>
          ${this._renderStatus()}
          ${this._renderSummary(attrs)}
          <div class="body">${body}</div>
        </div>
      </ha-card>
    `;

    this._bindEvents();
    this._restoreScrollPosition(scrollRoot, preservedScrollTop);
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
    const showFeedin = !this._isAllSystemsSelection();
    const showOffgrid =
      !this._isAllSystemsSelection() && Boolean(batteryPolicy.offgrid_supported);
    return `
      ${this._renderChargeSection(batteryPolicy)}
      ${this._renderDischargeSection(batteryPolicy)}
      ${showFeedin ? this._renderFeedinSection(this._stateObj(this._config.settings_target)?.attributes?.feedin_policy || {}) : ""}
      ${showOffgrid ? this._renderOffgridSection(batteryPolicy) : ""}
    `;
  }

  _renderSummary(attrs) {
    const monitoringSummary = attrs?.monitoring_summary || {};
    const allSystemSummaries = Array.isArray(attrs?.all_system_summaries) ? attrs.all_system_summaries : [];
    const selectedSoc = Number(monitoringSummary?.soc);
    const selectedBatteryPower = Number(monitoringSummary?.battery_power);
    const selectedBatteryLoad = Number(monitoringSummary?.house_consumption);
    const soc = Number.isFinite(selectedSoc)
      ? selectedSoc
      : this._readSummaryNumber(
          this._config.summary_soc,
          ["_battery_percentage", "_soc"],
          ["Battery Percentage", "Battery SOC", "SOC"]
        );
    const batteryPower = Number.isFinite(selectedBatteryPower)
      ? selectedBatteryPower
      : this._readSummaryNumber(
          this._config.summary_battery_power,
          ["_battery_power", "_pbat"],
          ["Battery Power"]
        );
    const batteryLoad = Number.isFinite(selectedBatteryLoad)
      ? selectedBatteryLoad
      : this._readSummaryNumber(
          this._config.summary_battery_load,
          ["_house_consumption", "_house_load", "_pload"],
          ["House Consumption", "House Load"]
        );
    const activeImmediate = this._activeImmediateState(attrs);
    const activeTone = this._summaryToneFromImmediate(activeImmediate);
    const chargeWatts = Number.isFinite(batteryPower) && batteryPower < 0 ? Math.abs(batteryPower) : 0;
    const dischargeWatts = Number.isFinite(batteryPower) && batteryPower > 0 ? batteryPower : 0;
    const chargeTone = chargeWatts > 0 ? "charging" : Number.isFinite(batteryPower) ? "idle" : "unavailable";
    const dischargeTone = dischargeWatts > 0 ? "discharging" : Number.isFinite(batteryPower) ? "idle" : "unavailable";
    const loadTone = Number.isFinite(batteryLoad) && batteryLoad > 0 ? "live" : "idle";
    const socTone = Number.isFinite(soc) ? "live" : "unavailable";
    const totalsGrid = `
      <div class="summary-grid">
        <div class="summary-card ${socTone}">
          <div class="summary-label">${this._isAllSystemsSelection() ? "Total SOC" : "Current SOC"}</div>
          <div class="summary-value ${Number.isFinite(soc) ? "live-pulse" : ""}">${this._formatValue(soc, "%")}</div>
          ${this._renderSummaryMeter(Number.isFinite(soc) ? Math.max(0, Math.min(100, soc)) : null)}
        </div>
        <div class="summary-card ${chargeTone} ${chargeWatts > 0 ? "live" : ""}">
          <div class="summary-label">${this._isAllSystemsSelection() ? "Total Battery Charge" : "Battery Charge"}</div>
          <div class="summary-value ${chargeWatts > 0 ? "live-pulse" : ""}">${this._formatValue(Number.isFinite(batteryPower) ? chargeWatts : Number.NaN, "W")}</div>
          ${this._renderSummaryMeter(this._summaryPowerMeterPercent(chargeWatts))}
        </div>
        <div class="summary-card ${dischargeTone} ${dischargeWatts > 0 ? "live" : ""}">
          <div class="summary-label">${this._isAllSystemsSelection() ? "Total Battery Discharge" : "Battery Discharge"}</div>
          <div class="summary-value ${dischargeWatts > 0 ? "live-pulse" : ""}">${this._formatValue(Number.isFinite(batteryPower) ? dischargeWatts : Number.NaN, "W")}</div>
          ${this._renderSummaryMeter(this._summaryPowerMeterPercent(dischargeWatts))}
        </div>
        <div class="summary-card ${loadTone} ${Number.isFinite(batteryLoad) ? "live" : "unavailable"}">
          <div class="summary-label">${this._isAllSystemsSelection() ? "Total Battery Load" : "Battery Load"}</div>
          <div class="summary-value">${this._formatValue(batteryLoad, "W")}</div>
          ${this._renderSummaryMeter(this._summaryLoadMeterPercent(batteryLoad))}
        </div>
        <div class="summary-card ${activeTone} ${activeTone !== "idle" ? "live" : ""}">
          <div class="summary-label">Active Immediate State</div>
          <div class="summary-value ${activeTone !== "idle" ? "live-pulse" : ""}">${this._escapeHtml(activeImmediate)}</div>
          ${this._renderSummaryMeter(activeTone === "idle" ? 0 : 100)}
        </div>
      </div>
    `;

    if (this._isAllSystemsSelection() && allSystemSummaries.length) {
      return `
        <div class="summary-stack">
          ${totalsGrid}
          <div class="summary-subgrid">
            ${allSystemSummaries.map((item) => this._renderBatterySummaryCard(item)).join("")}
          </div>
        </div>
      `;
    }

    return totalsGrid;
  }

  _renderBatterySummaryCard(item) {
    const soc = Number(item?.soc);
    const batteryPower = Number(item?.battery_power);
    const batteryLoad = Number(item?.house_consumption);
    const chargeWatts = Number.isFinite(batteryPower) && batteryPower < 0 ? Math.abs(batteryPower) : 0;
    const dischargeWatts = Number.isFinite(batteryPower) && batteryPower > 0 ? batteryPower : 0;
    const tone = chargeWatts > 0 ? "charging" : dischargeWatts > 0 ? "discharging" : "idle";
    const title = this._escapeHtml(item?.sys_sn || item?.label || item?.system_id || "Battery");
    const meta = item?.remark ? this._escapeHtml(item.remark) : "";
    return `
      <div class="summary-card battery-breakout ${tone}">
        <div class="summary-title">${title}</div>
        ${meta ? `<div class="summary-meta">${meta}</div>` : ""}
        <div class="summary-breakout-grid">
          <div class="summary-breakout-cell">
            <div class="summary-breakout-label">SOC</div>
            <div class="summary-breakout-value">${this._formatValue(soc, "%")}</div>
          </div>
          <div class="summary-breakout-cell">
            <div class="summary-breakout-label">Charge</div>
            <div class="summary-breakout-value">${this._formatValue(Number.isFinite(batteryPower) ? chargeWatts : Number.NaN, "W")}</div>
          </div>
          <div class="summary-breakout-cell">
            <div class="summary-breakout-label">Discharge</div>
            <div class="summary-breakout-value">${this._formatValue(Number.isFinite(batteryPower) ? dischargeWatts : Number.NaN, "W")}</div>
          </div>
          <div class="summary-breakout-cell">
            <div class="summary-breakout-label">Load</div>
            <div class="summary-breakout-value">${this._formatValue(batteryLoad, "W")}</div>
          </div>
        </div>
      </div>
    `;
  }

  _renderStatus() {
    const status = this._status || { type: "info", message: "Ready" };
    return `<div class="status ${this._escapeHtml(status.type)}">${this._escapeHtml(status.message)}</div>`;
  }

  _renderChargeSection(summary) {
    const cycle = this._cycleState("charge");
    const rows = this._mergedSectionSlots("charge", summary.charge_slots || [], cycle.weekly);
    const limit = summary.charge_slot_limit || 6;
    const enabled = this._policyEnabled("charge", this._config.charge_switch);
    const pending = this._sectionHasPending("charge");
    const chargeDisabledReason = this._chargeDisabledReason();
    return this._renderSection(
      "charge",
      "&#9889;",
      "Battery Charge",
      `
        <div class="eyebrow">Immediate</div>
        <div class="stack">
          <div class="field-title">SOC (%)</div>
          ${this._numberInput("force-charge-limit", this._immediateDraftValue("force-charge-limit", this._entityNumberValue(this._config.charge_cap, 100)), "%")}
        </div>
        ${this._renderImmediateAction(
          "charge",
          "Start Charging Now",
          "Stop Charging",
          "start_force_charge",
          "stop_force_charge",
          "primary",
          chargeDisabledReason
        )}
      `,
      `
        <div class="eyebrow">Policy</div>
        ${pending ? `<div class="pending-banner">Pending changes not committed</div>` : ""}
        ${this._toggleCell("Charge policy", this._config.charge_switch, "charge")}
        ${
          enabled
            ? `
              <div class="policy-grid charge-policy-grid">
                ${this._selectCell("Execution Cycle", this._config.execution_cycle, "charge", cycle.options)}
                ${this._numberCell("SOC (%)", this._config.charge_cap, "charge", "%")}
                ${this._numberCell("POWER (W)", this._config.charge_power, "charge", "W")}
              </div>
            `
            : `<div class="muted">Charge policy is off. Enable it to show schedule settings.</div>`
        }
      `,
      `
        ${
          enabled
            ? `
              ${this._renderScheduleHead(limit)}
              ${this._renderBatterySchedule("charge", rows, cycle.weekly, limit, "Add Charge Row")}
              ${this._renderFooter("charge", rows.length < limit, "Add Charge Row")}
            `
            : pending
              ? `${this._renderFooter("charge", false, "")}`
            : ""
        }
      `
    );
  }

  _renderDischargeSection(summary) {
    const cycle = this._cycleState("discharge");
    const rows = this._mergedSectionSlots("discharge", summary.discharge_slots || [], cycle.weekly);
    const limit = summary.discharge_slot_limit || 6;
    const enabled = this._policyEnabled("discharge", this._config.discharge_switch);
    const pending = this._sectionHasPending("discharge");
    const immediateDischargeSoc = this._immediateDraftValue(
      "immediate-discharge-soc",
      this._entityNumberValue(this._config.discharge_cutoff, 10)
    );
    const immediateDischargePower = this._immediateDraftValue(
      "immediate-discharge-power",
      this._entityNumberValue(this._config.discharge_power, 5000)
    );
    const immediateDischargeDuration = this._immediateDraftValue("immediate-discharge-duration", 60);
    return this._renderSection(
      "discharge",
      "&#8595;",
      "Battery Discharge",
      `
        <div class="eyebrow">Immediate</div>
        <div class="stack">
          <div class="field-title">Discharge Now</div>
          ${this._immediatePairFields([
            {
              label: "SOC (%)",
              key: "immediate-discharge-soc",
              value: immediateDischargeSoc,
              unit: "%",
            },
            {
              label: "POWER (W)",
              key: "immediate-discharge-power",
              value: immediateDischargePower,
              unit: "W",
            },
            {
              label: "DURATION (MIN)",
              key: "immediate-discharge-duration",
              value: immediateDischargeDuration,
              unit: "min",
            },
          ])}
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
        ${pending ? `<div class="pending-banner">Pending changes not committed</div>` : ""}
        ${this._toggleCell("Discharge policy", this._config.discharge_switch, "discharge")}
        ${
          enabled
            ? `
              <div class="policy-grid discharge-policy-grid">
                ${this._selectCell("Execution Cycle", this._config.execution_cycle, "discharge", cycle.options)}
                ${this._numberCell("SOC (%)", this._config.discharge_cutoff, "discharge", "%")}
                ${this._numberCell("POWER (W)", this._config.discharge_power, "discharge", "W")}
              </div>
            `
            : `<div class="muted">Discharge policy is off. Enable it to show schedule settings.</div>`
        }
      `,
      `
        ${
          enabled
            ? `
              ${this._renderScheduleHead(limit)}
              ${this._renderBatterySchedule("discharge", rows, cycle.weekly, limit, "Add Discharge Row")}
              ${this._renderFooter("discharge", rows.length < limit, "Add Discharge Row")}
            `
            : pending
              ? `${this._renderFooter("discharge", false, "")}`
            : ""
        }
      `
    );
  }

  _renderFeedinSection(summary) {
    const hasSummary = Boolean(summary && Object.keys(summary).length);
    const rows = hasSummary ? this._mergedSectionSlots("feedin", summary.slots || [], false) : [];
    const limit = hasSummary ? summary.slot_limit || 6 : 6;
    const enabled = this._policyEnabled("feedin", this._config.feedin_enabled);
    const pending = this._sectionHasPending("feedin");
    const immediateCutoffSoc = this._immediateDraftValue(
      "immediate-feedin-cutoff",
      this._entityNumberValue(this._config.feedin_cutoff, 0)
    );
    const immediatePower = this._immediateDraftValue(
      "immediate-feedin-power",
      this._immediateFeedinPower(summary)
    );
    const immediateDuration = this._immediateDraftValue(
      "immediate-feedin-duration",
      this._immediateFeedinDuration(summary)
    );
    return this._renderSection(
      "feedin",
      "&#8593;",
      "Feed-in",
      `
        <div class="eyebrow">Immediate</div>
        <div class="stack">
          <div class="field-title">Feed-in Now</div>
          ${this._immediatePairFields([
            {
              label: "SOC (%)",
              key: "immediate-feedin-cutoff",
              value: immediateCutoffSoc,
              unit: "%",
            },
            {
              label: "POWER (W)",
              key: "immediate-feedin-power",
              value: immediatePower,
              unit: "W",
            },
            {
              label: "DURATION (MIN)",
              key: "immediate-feedin-duration",
              value: immediateDuration,
              unit: "min",
            },
          ])}
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
        ${pending ? `<div class="pending-banner">Pending changes not committed</div>` : ""}
        ${this._toggleCell("Feed-in policy", this._config.feedin_enabled, "feedin")}
        ${
          !hasSummary
            ? `<div class="muted">Select an individual battery to edit feed-in schedule settings.</div>`
            : enabled
            ? `
              <div class="policy-grid">
                ${this._numberCell("SOC (%)", this._config.feedin_cutoff, "feedin", "%")}
              </div>
            `
            : `<div class="muted">Feed-in policy is off. Enable it to show schedule settings.</div>`
        }
        `,
        `
          ${
            hasSummary && enabled
              ? `
                ${this._renderScheduleHead(limit)}
                ${this._renderFeedinSchedule(rows, limit, "Add Feed-in Row")}
                ${this._renderFooter("feedin", rows.length < limit, "Add Feed-in Row")}
              `
            : hasSummary && pending
              ? `${this._renderFooter("feedin", false, "")}`
            : ""
        }
      `
    );
  }

  _renderOffgridSection(summary) {
    const pending = this._sectionHasPending("offgrid");
    const enabled = this._policyEnabled("offgrid", this._config.offgrid_switch);
    return this._renderSection(
      "offgrid",
      "&#8962;",
      "Off-grid SOC Control",
      `
        <div class="eyebrow">Immediate</div>
        <div class="stack">
          <div class="field-title">No immediate actions</div>
          <div class="muted">This section only supports policy values. Use Commit Policy to save changes.</div>
        </div>
      `,
      `
        <div class="eyebrow">Policy</div>
        ${pending ? `<div class="pending-banner">Pending changes not committed</div>` : ""}
        ${this._toggleCell("Off-grid SOC Control", this._config.offgrid_switch, "offgrid")}
        ${
          enabled
            ? `
              <div class="policy-grid offgrid-policy-grid">
                ${this._numberCell("Wake-up SOC (%)", this._config.offgrid_wakeup_soc, "offgrid", "%")}
                ${this._numberCell("Cut-off SOC (%)", this._config.offgrid_cutoff_soc, "offgrid", "%")}
              </div>
            `
            : `<div class="muted">Off-grid SOC Control is off.</div>`
        }
      `,
      `${enabled || pending ? this._renderFooter("offgrid", false, "") : ""}`
    );
  }

  _renderSection(kind, icon, title, immediateBlock, policyBlock, scheduleBlock) {
    return `
      <div class="section" data-section-kind="${kind}">
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

  _renderImmediateAction(kind, startLabel, stopLabel, startService, stopService, buttonClass, customDisabledReason = "") {
    const attrs = this._currentTargetAttrs();
    const activity = this._activityState(kind, attrs);
    const flags = this._immediateFlags(attrs);
    const running = activity.running;
    const blocked = !running && Object.entries(flags).some(([name, active]) => name !== kind && active);
    const disabledReason = !running && customDisabledReason
      ? customDisabledReason
      : blocked
        ? "Another immediate action is active"
        : "";
    const statusText = running
      ? activity.source === "schedule"
        ? "Running from schedule"
        : "Running"
      : disabledReason || "Stopped";
    return `
      <div class="stack">
        <div class="immediate-status">
          <span class="immediate-status-dot ${running ? "running" : ""}"></span>
          <span>${statusText}</span>
        </div>
        <div class="button-row single-action">
          <button
            class="${this._escapeHtml(buttonClass)}"
            data-immediate-kind="${kind}"
            data-start-service="${startService}"
            data-stop-service="${stopService}"
            ${disabledReason ? "disabled" : ""}
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
    const renderRow = (slot) =>
      kind === "charge"
        ? this._renderChargeSlot(slot, weekly)
        : this._renderBatterySlot(kind, slot, weekly);

    if (!rows.length && weekly) {
      return `
        <div class="stack">
          ${renderRow({ sort: 1, soc: "", start: "", end: "", power: "", weeks: [] })}
        </div>
      `;
    }

    return `
      <div class="stack">
        ${
          rows.length
            ? rows.map((slot) => renderRow(slot)).join("")
            : `<div class="schedule-empty">No schedule rows defined.</div>`
        }
      </div>
    `;
  }

  _renderChargeSlot(slot, weekly) {
    const slotNo = slot.sort || 1;
    const deleteLabel = slot.__deleted ? "Undo delete" : "&times;";
    return `
      <div class="slot charge-slot ${slot.__deleted ? "deleted" : ""} ${slot.__pending ? "pending" : ""}">
        <div class="charge-slot-header">
          <div class="slot-name">Setting ${slotNo}${slot.__new ? ' <span class="slot-badge">New</span>' : slot.__pending ? ' <span class="slot-badge">Pending</span>' : ""}${slot.__deleted ? ' <span class="slot-badge delete">Delete on commit</span>' : ""}</div>
          <button
            class="slot-delete-icon"
            type="button"
            title="Delete setting ${slotNo}"
            aria-label="Delete setting ${slotNo}"
            data-delete-slot="charge:${slotNo}"
          >
            ${deleteLabel}
          </button>
        </div>
        <div class="charge-slot-grid">
          ${this._slotField("SOC (%)", `charge:${slotNo}:soc`, slot.soc, "number")}
          ${this._slotField("Start Time", `charge:${slotNo}:start`, slot.start, "time")}
          ${this._slotField("End Time", `charge:${slotNo}:end`, slot.end, "time")}
          ${this._slotField("POWER (W)", `charge:${slotNo}:power`, slot.power, "number")}
        </div>
        ${
          weekly
            ? `
              <div class="stack">
                <div class="eyebrow">Days</div>
                ${this._dayChipGroup("charge", slotNo, slot.weeks || [])}
              </div>
            `
            : ""
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
      </div>
    `;
  }

  _renderBatterySlot(kind, slot, weekly) {
    const slotNo = slot.sort || 1;
    const deleteLabel = slot.__deleted ? "Undo delete" : "&times;";
    return `
      <div class="slot charge-slot ${slot.__deleted ? "deleted" : ""} ${slot.__pending ? "pending" : ""}">
        <div class="charge-slot-header">
          <div class="slot-name">Setting ${slotNo}${slot.__new ? ' <span class="slot-badge">New</span>' : slot.__pending ? ' <span class="slot-badge">Pending</span>' : ""}${slot.__deleted ? ' <span class="slot-badge delete">Delete on commit</span>' : ""}</div>
          <button
            class="slot-delete-icon"
            type="button"
            title="Delete setting ${slotNo}"
            aria-label="Delete setting ${slotNo}"
            data-delete-slot="${kind}:${slotNo}"
          >
            ${deleteLabel}
          </button>
        </div>
        <div class="charge-slot-grid">
          ${this._slotField("SOC (%)", `${kind}:${slotNo}:soc`, slot.soc, "number")}
          ${this._slotField("Start Time", `${kind}:${slotNo}:start`, slot.start, "time")}
          ${this._slotField("End Time", `${kind}:${slotNo}:end`, slot.end, "time")}
          ${this._slotField("POWER (W)", `${kind}:${slotNo}:power`, slot.power, "number")}
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
    const deleteLabel = slot.__deleted ? "Undo delete" : "&times;";
    return `
      <div class="slot charge-slot ${slot.__deleted ? "deleted" : ""} ${slot.__pending ? "pending" : ""}">
        <div class="charge-slot-header">
          <div class="slot-name">Setting ${slotNo}${slot.__new ? ' <span class="slot-badge">New</span>' : slot.__pending ? ' <span class="slot-badge">Pending</span>' : ""}${slot.__deleted ? ' <span class="slot-badge delete">Delete on commit</span>' : ""}</div>
          <button
            class="slot-delete-icon"
            type="button"
            title="Delete setting ${slotNo}"
            aria-label="Delete setting ${slotNo}"
            data-delete-slot="feedin:${slotNo}"
          >
            ${deleteLabel}
          </button>
        </div>
        <div class="charge-slot-grid">
          ${this._slotReadonlyField("SOC (%)", "POLICY", "soc")}
          ${this._slotField("Start Time", `feedin:${slotNo}:start`, slot.start, "time")}
          ${this._slotField("End Time", `feedin:${slotNo}:end`, slot.end, "time")}
          ${this._slotField("POWER (W)", `feedin:${slotNo}:power`, slot.power, "number")}
        </div>
      </div>
    `;
  }

  _renderFooter(section, canAdd = false, addLabel = "") {
    return `
      <div class="footer">
        <div class="footer-actions ${section === "charge" ? "charge-footer-actions" : ""}">
          ${canAdd ? `<button data-add-slot="${section}">${addLabel}</button>` : ``}
          <button class="primary commit-button" data-commit-policy="${section}">Commit Policy</button>
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
      <div class="policy-cell select-cell">
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
    const unitClass = unit === "%" ? "percent" : unit === "W" ? "watt" : "generic";
    const note = unit === "W" ? this._combinedPowerNote(value, this._currentTargetAttrs(), true) : "";
    const valueClass = note ? "policy-value inline-note" : "policy-value";
    return `
      <div class="policy-cell number-cell ${unitClass}">
        <div class="field-title">${label}</div>
        <div class="${valueClass}">
          <input type="number" data-policy-number="${entityId}" data-section="${section}" value="${this._escapeHtml(value ?? "")}" />
          ${note}
        </div>
      </div>
    `;
  }

  _numberInput(key, value, unit, disabled = false) {
    const unitClass =
      unit === "%" ? "soc" : unit === "W" ? "power" : unit === "min" ? "duration" : "generic";
    return `
      <div class="policy-value immediate-value ${unitClass}">
        <input type="number" data-key="${key}" value="${this._escapeHtml(this._normalizeNumberState(value))}" ${disabled ? "disabled" : ""} />
      </div>
    `;
  }

  _immediatePairFields(fields) {
    const compactClass = fields.length <= 2 ? "immediate-grid-compact two" : "immediate-grid-compact";
    return `
      <div class="charge-slot-grid ${compactClass}">
        ${fields
          .map(
            (field) => {
              const note = field.unit === "W" ? this._combinedPowerNote(field.value, this._currentTargetAttrs(), true) : "";
              const inputBlock = note
                ? `
                  <div class="policy-value immediate-inline-note">
                    <input type="number" data-key="${field.key}" value="${this._escapeHtml(this._normalizeNumberState(field.value))}" ${Boolean(field.disabled) ? "disabled" : ""} />
                    ${note}
                  </div>
                `
                : this._numberInput(field.key, field.value, field.unit, Boolean(field.disabled));
              return `
              <div class="slot-field ${this._escapeHtml(field.unit === "W" ? "power" : "soc")}">
                <div class="field-title compact">${this._escapeHtml(field.label)}</div>
                ${inputBlock}
              </div>
            `;
            }
          )
          .join("")}
      </div>
    `;
  }

  _slotField(label, key, value, type) {
    const inputValue =
      type === "time" ? this._normalizeTimeValue(value) : this._normalizeNumberState(value);
    const fieldClass =
      type === "time" ? "time" : label.includes("SOC") ? "soc" : label.includes("Power") ? "power" : "generic";
    const note =
      type !== "time" && label.includes("POWER")
        ? this._combinedPowerNote(inputValue, this._currentTargetAttrs(), true)
        : "";
    const inputBlock = note
      ? `<div class="slot-value inline-note"><input type="${type}" data-slot-field="${key}" value="${this._escapeHtml(inputValue)}" />${note}</div>`
      : `<input type="${type}" data-slot-field="${key}" value="${this._escapeHtml(inputValue)}" />`;
    return `
      <div class="slot-field ${fieldClass}">
        <div class="field-title compact">${label}</div>
        ${inputBlock}
      </div>
    `;
  }

  _slotReadonlyField(label, value, fieldClass = "generic") {
    return `
      <div class="slot-field ${fieldClass}">
        <div class="field-title compact">${label}</div>
        <input type="text" value="${this._escapeHtml(value)}" readonly disabled />
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
    const value = this._executionCycleDraftValue(state?.state || "");
    return {
      value,
      options: state?.attributes?.options || [],
      weekly: String(value).toLowerCase() === "weekly",
    };
  }

  _slotDraftBucket(section) {
    this._slotDrafts[section] = this._slotDrafts[section] || {};
    return this._slotDrafts[section];
  }

  _slotDeletedBucket(section) {
    this._slotDeleted[section] = this._slotDeleted[section] || {};
    return this._slotDeleted[section];
  }

  _savedSlotNumbers(rows) {
    return new Set(
      (rows || [])
        .map((slot) => Number(slot?.sort))
        .filter((slotNo) => Number.isInteger(slotNo) && slotNo > 0)
    );
  }

  _defaultDraftSlot(section, slotNo, weekly = false) {
    if (section === "feedin") {
      return { sort: slotNo, start: "", end: "", power: "", __new: true };
    }
    return {
      sort: slotNo,
      soc:
        section === "charge"
          ? this._entityNumberValue(this._config.charge_cap, 100)
          : this._entityNumberValue(this._config.discharge_cutoff, 10),
      start: "",
      end: "",
      power:
        section === "charge"
          ? this._entityNumberValue(this._config.charge_power, 5000)
          : this._entityNumberValue(this._config.discharge_power, 5000),
      weeks: weekly ? [1, 2, 3, 4, 5, 6, 7] : [],
      __new: true,
    };
  }

  _mergedSectionSlots(section, rows, weekly = false) {
    const draftBucket = this._slotDraftBucket(section);
    const deletedBucket = this._slotDeletedBucket(section);
    const merged = new Map();

    for (const row of rows || []) {
      const slotNo = Number(row?.sort);
      if (!Number.isInteger(slotNo) || slotNo <= 0) continue;
      const draft = draftBucket[slotNo] || {};
      merged.set(slotNo, {
        ...row,
        ...draft,
        sort: slotNo,
        __saved: true,
        __new: Boolean(draft.__new),
        __pending: Boolean(draft.__dirty || draft.__new || deletedBucket[slotNo]),
        __deleted: Boolean(deletedBucket[slotNo]),
      });
    }

    for (const [slotKey, draft] of Object.entries(draftBucket)) {
      const slotNo = Number(slotKey);
      if (!Number.isInteger(slotNo) || slotNo <= 0 || merged.has(slotNo)) continue;
      merged.set(slotNo, {
        ...this._defaultDraftSlot(section, slotNo, weekly),
        ...draft,
        sort: slotNo,
        __saved: false,
        __new: true,
        __pending: true,
        __deleted: Boolean(deletedBucket[slotNo]),
      });
    }

    return Array.from(merged.values()).sort((a, b) => Number(a.sort) - Number(b.sort));
  }

  _setSlotDraftValue(section, slotNo, field, value) {
    const bucket = this._slotDraftBucket(section);
    const current = bucket[slotNo] || {};
    bucket[slotNo] = {
      ...current,
      sort: Number(slotNo),
      [field]: value,
      __dirty: true,
      __new: Boolean(current.__new),
    };
  }

  _toggleDeleteSlot(section, slotNo, savedRows = []) {
    const numericSlot = Number(slotNo);
    const deletedBucket = this._slotDeletedBucket(section);
    const draftBucket = this._slotDraftBucket(section);
    const saved = this._savedSlotNumbers(savedRows).has(numericSlot);
    if (!saved) {
      delete draftBucket[numericSlot];
      delete deletedBucket[numericSlot];
      return;
    }
    if (deletedBucket[numericSlot]) {
      delete deletedBucket[numericSlot];
    } else {
      deletedBucket[numericSlot] = true;
    }
  }

  _clearSlotDrafts(section) {
    this._slotDrafts[section] = {};
    this._slotDeleted[section] = {};
  }

  _sectionHasPending(section) {
    return this._sectionFieldHasPending(section) || this._sectionSlotHasPending(section);
  }

  _sectionSavedRows(section) {
    const attrs = this._currentTargetAttrs();
    const batteryPolicy = attrs?.battery_policy || {};
    const feedinPolicy = attrs?.feedin_policy || {};
    if (section === "charge") return batteryPolicy.charge_slots || [];
    if (section === "discharge") return batteryPolicy.discharge_slots || [];
    if (section === "feedin") return feedinPolicy.slots || [];
    return [];
  }

  _editableSelector() {
    return 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';
  }

  _isEditableElement(node) {
    return Boolean(node?.matches?.(this._editableSelector()));
  }

  _sectionKindForNode(node) {
    return node?.closest?.("[data-section-kind]")?.dataset?.sectionKind || null;
  }

  _beginEditSession(section) {
    this._editingSection = section || null;
    this._autoRenderSuspended = true;
    this._pendingStateRender = false;
    if (this._editReleaseTimer) {
      clearTimeout(this._editReleaseTimer);
      this._editReleaseTimer = null;
    }
  }

  _scheduleEditSessionRelease() {
    if (this._editReleaseTimer) {
      clearTimeout(this._editReleaseTimer);
    }
    this._editReleaseTimer = setTimeout(() => {
      const active = this.shadowRoot?.activeElement;
      if (this._isEditableElement(active)) {
        return;
      }
      this._editingSection = null;
      this._autoRenderSuspended = false;
      this._editReleaseTimer = null;
      if (this._pendingStateRender) {
        this._pendingStateRender = false;
        this.render();
      }
    }, 250);
  }

  _stateObj(entityId) {
    return entityId ? this._hass.states[entityId] : null;
  }

  _currentTargetAttrs() {
    return this._stateObj(this._config.settings_target)?.attributes || {};
  }

  _draftBucket(section) {
    this._drafts[section] = this._drafts[section] || {};
    return this._drafts[section];
  }

  _executionCycleDraftValue(fallback = "") {
    const chargeDraft = this._draftBucket("charge")[this._config.execution_cycle];
    const dischargeDraft = this._draftBucket("discharge")[this._config.execution_cycle];
    if (chargeDraft !== undefined) return chargeDraft;
    if (dischargeDraft !== undefined) return dischargeDraft;
    return fallback;
  }

  _setExecutionCycleDraftValue(value) {
    this._draftBucket("charge")[this._config.execution_cycle] = value;
    this._draftBucket("discharge")[this._config.execution_cycle] = value;
  }

  _clearExecutionCycleDraftValue() {
    delete this._draftBucket("charge")[this._config.execution_cycle];
    delete this._draftBucket("discharge")[this._config.execution_cycle];
  }

  _draftValue(section, key, fallback) {
    const bucket = this._draftBucket(section);
    return Object.prototype.hasOwnProperty.call(bucket, key) ? bucket[key] : fallback;
  }

  _setDraftValue(section, key, value) {
    this._draftBucket(section)[key] = value;
  }

  _immediateDraftValue(key, fallback) {
    return Object.prototype.hasOwnProperty.call(this._immediateDrafts, key)
      ? this._immediateDrafts[key]
      : fallback;
  }

  _setImmediateDraftValue(key, value) {
    this._immediateDrafts[key] = value;
  }

  _clearSectionDraft(section) {
    this._drafts[section] = {};
  }

  _clearAllDrafts() {
    this._drafts = {};
    this._slotDrafts = {};
    this._slotDeleted = {};
  }

  _normalizedWeeks(value) {
    return (Array.isArray(value) ? value : [])
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item))
      .sort((a, b) => a - b);
  }

  _slotComparable(section, row, weekly = false) {
    const base = {
      start: this._normalizeTimeValue(row?.start),
      end: this._normalizeTimeValue(row?.end),
      power: this._normalizeNumberState(row?.power),
    };
    if (section !== "feedin") {
      base.soc = this._normalizeNumberState(row?.soc);
    }
    if (weekly && section !== "feedin") {
      base.weeks = this._normalizedWeeks(row?.weeks);
    }
    return base;
  }

  _slotDraftIsMeaningful(section, row, weekly = false) {
    const comparable = this._slotComparable(section, row, weekly);
    return Object.values(comparable).some((value) => {
      if (Array.isArray(value)) return value.length > 0;
      return value !== "";
    });
  }

  _slotChanged(section, row, savedRow, weekly = false) {
    if (!savedRow) {
      return this._slotDraftIsMeaningful(section, row, weekly);
    }
    return JSON.stringify(this._slotComparable(section, row, weekly)) !== JSON.stringify(this._slotComparable(section, savedRow, weekly));
  }

  _sectionFieldHasPending(section) {
    if (section === "charge") {
      return (
        this._savedToggleValue(this._config.charge_switch) !== this._policyEnabled("charge", this._config.charge_switch) ||
        this._savedExecutionCycleValue() !== this._executionCycleDraftValue(this._savedExecutionCycleValue()) ||
        this._savedNumberValue(this._config.charge_cap) !== this._draftNumberValue("charge", this._config.charge_cap) ||
        this._savedNumberValue(this._config.charge_power) !== this._draftNumberValue("charge", this._config.charge_power)
      );
    }
    if (section === "discharge") {
      return (
        this._savedToggleValue(this._config.discharge_switch) !== this._policyEnabled("discharge", this._config.discharge_switch) ||
        this._savedExecutionCycleValue() !== this._executionCycleDraftValue(this._savedExecutionCycleValue()) ||
        this._savedNumberValue(this._config.discharge_cutoff) !== this._draftNumberValue("discharge", this._config.discharge_cutoff) ||
        this._savedNumberValue(this._config.discharge_power) !== this._draftNumberValue("discharge", this._config.discharge_power)
      );
    }
    if (section === "feedin") {
      return (
        this._savedToggleValue(this._config.feedin_enabled) !== this._policyEnabled("feedin", this._config.feedin_enabled) ||
        this._savedNumberValue(this._config.feedin_cutoff) !== this._draftNumberValue("feedin", this._config.feedin_cutoff)
      );
    }
    if (section === "offgrid") {
      return (
        this._savedToggleValue(this._config.offgrid_switch) !== this._policyEnabled("offgrid", this._config.offgrid_switch) ||
        this._savedNumberValue(this._config.offgrid_wakeup_soc) !== this._draftNumberValue("offgrid", this._config.offgrid_wakeup_soc) ||
        this._savedNumberValue(this._config.offgrid_cutoff_soc) !== this._draftNumberValue("offgrid", this._config.offgrid_cutoff_soc)
      );
    }
    return false;
  }

  _sectionSlotHasPending(section) {
    const savedRows = this._sectionSavedRows(section);
    const savedMap = new Map(
      (savedRows || [])
        .map((row) => [Number(row?.sort), row])
        .filter(([slotNo]) => Number.isInteger(slotNo) && slotNo > 0)
    );
    const deletedBucket = this._slotDeletedBucket(section);
    const draftBucket = this._slotDraftBucket(section);
    const weekly = section !== "feedin" && this._cycleState(section).weekly;

    for (const slotKey of Object.keys(deletedBucket)) {
      const slotNo = Number(slotKey);
      if (savedMap.has(slotNo)) {
        return true;
      }
    }

    for (const [slotKey, draft] of Object.entries(draftBucket)) {
      const slotNo = Number(slotKey);
      if (!Number.isInteger(slotNo) || slotNo <= 0) continue;
      if (deletedBucket[slotNo]) continue;
      if (this._slotChanged(section, draft, savedMap.get(slotNo), weekly)) {
        return true;
      }
    }

    return false;
  }

  _savedToggleValue(entityId) {
    return this._stateObj(entityId)?.state === "on";
  }

  _savedNumberValue(entityId) {
    return this._normalizeNumberState(this._stateObj(entityId)?.state);
  }

  _savedExecutionCycleValue() {
    return String(this._stateObj(this._config.execution_cycle)?.state || "");
  }

  _draftNumberValue(section, entityId) {
    return this._normalizeNumberState(
      this._draftValue(section, entityId, this._stateObj(entityId)?.state)
    );
  }

  _policyEnabled(section, entityId) {
    return Boolean(
      this._draftValue(section, entityId, this._stateObj(entityId)?.state === "on")
    );
  }

  _entityNumberValue(entityId, fallback) {
    const current = Number(this._stateObj(entityId)?.state);
    return Number.isFinite(current) ? current : fallback;
  }

  _readEntityNumber(entityId) {
    const current = Number(this._stateObj(entityId)?.state);
    return Number.isFinite(current) ? current : null;
  }

  _readSummaryNumber(primaryEntityId, suffixes = [], friendlyNames = []) {
    const directState = this._stateObj(primaryEntityId);
    const direct = this._readEntityNumber(primaryEntityId);
    if (Number.isFinite(direct)) {
      return direct;
    }

    const states = Object.entries(this._hass?.states || {});
    const suffixMatch = states.find(([entityId, stateObj]) => {
      const entityIdLower = String(entityId || "").toLowerCase();
      if (!entityIdLower.startsWith("sensor.") || !entityIdLower.includes("byte")) return false;
      if (
        !suffixes.some((suffix) => {
          const normalized = String(suffix || "").toLowerCase();
          return entityIdLower.endsWith(normalized) || entityIdLower.includes(normalized);
        })
      ) {
        return false;
      }
      if (!this._entityMatchesSelectedTarget(entityId, stateObj)) return false;
      return Number.isFinite(Number(stateObj?.state));
    });
    if (suffixMatch) {
      return Number(suffixMatch[1].state);
    }

    const friendlyMatch = states.find(([entityId, stateObj]) => {
      const entityIdLower = String(entityId || "").toLowerCase();
      const friendlyName = String(stateObj?.attributes?.friendly_name || "").toLowerCase();
      if (!entityIdLower.startsWith("sensor.")) return false;
      if (
        !friendlyNames.some((name) => {
          const normalized = String(name || "").toLowerCase();
          return friendlyName.includes(normalized);
        })
      ) {
        return false;
      }
      if (!this._entityMatchesSelectedTarget(entityId, stateObj)) return false;
      return Number.isFinite(Number(stateObj?.state));
    });
    if (friendlyMatch) {
      return Number(friendlyMatch[1].state);
    }

    return null;
  }

  _currentTargetLabel() {
    return String(this._stateObj(this._config.settings_target)?.state || "").trim();
  }

  _isAllSystemsSelection(value = this._currentTargetLabel()) {
    const normalized = String(value || "").trim().toLowerCase();
    return !normalized || normalized === "all" || normalized === "all systems" || normalized === "__all__";
  }

  _selectedTargetToken() {
    const label = this._currentTargetLabel();
    if (this._isAllSystemsSelection(label)) return null;
    return String(label).toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  _allSystemsBatteryCount(attrs = this._currentTargetAttrs()) {
    if (!this._isAllSystemsSelection()) return 1;
    const summaries = Array.isArray(attrs?.all_system_summaries) ? attrs.all_system_summaries : [];
    return summaries.length > 0 ? summaries.length : 1;
  }

  _combinedPowerNote(value, attrs = this._currentTargetAttrs(), inline = false) {
    const count = this._allSystemsBatteryCount(attrs);
    const parsed = Number(value);
    if (!this._isAllSystemsSelection() || count <= 1 || !Number.isFinite(parsed)) {
      return "";
    }
    const total = parsed * count;
    const className = inline ? "field-note inline" : "field-note";
    return `<div class="${className}">Combined total ${this._escapeHtml(this._normalizeNumberState(total))} W (${this._escapeHtml(this._normalizeNumberState(parsed))} W each x ${count})</div>`;
  }

  _entityMatchesSelectedTarget(entityId, stateObj) {
    const token = this._selectedTargetToken();
    if (!token) return true;
    const source = [
      entityId,
      stateObj?.attributes?.friendly_name,
      stateObj?.attributes?.device_name,
      stateObj?.attributes?.name,
      stateObj?.attributes?.system_sn,
      stateObj?.attributes?.sys_sn,
      stateObj?.attributes?.serial,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    return source.includes(token);
  }

  _immediateFlags(attrs = this._currentTargetAttrs()) {
    return {
      charge: this._activityState("charge", attrs).running,
      discharge: this._activityState("discharge", attrs).running,
      feedin: this._activityState("feedin", attrs).running,
    };
  }

  _isImmediateRunning(kind, attrs = this._currentTargetAttrs()) {
    return Boolean(this._immediateFlags(attrs)[kind]);
  }

  _resetImmediateState() {
    this._immediateDrafts = {};
    this._immediateState = {
      charge: false,
      discharge: false,
      feedin: false,
    };
  }

  _activeImmediateState(attrs) {
    const flags = this._immediateFlags(attrs);
    const states = [];
    if (flags.charge) states.push("Charging");
    if (flags.discharge) states.push("Discharging");
    if (flags.feedin) states.push("Feed-in");
    return states.length ? states.join(", ") : "Idle";
  }

  _chargeDisabledReason() {
    const soc = this._readSummaryNumber(
      this._config.summary_soc,
      ["_battery_percentage", "_soc"],
      ["Battery Percentage", "Battery SOC", "SOC"]
    );
    if (Number.isFinite(soc) && soc >= 100) {
      return "Charge disabled: battery SOC is 100%";
    }
    return "";
  }

  _temporaryImmediateFlags(attrs = this._currentTargetAttrs()) {
    return {
      charge: Boolean(attrs?.battery_policy?.force_charge_active || this._immediateState?.charge),
      discharge: Boolean(
        attrs?.battery_policy?.temporary_discharge_now || this._immediateState?.discharge
      ),
      feedin: Boolean(attrs?.feedin_policy?.temporary_feedin_now || this._immediateState?.feedin),
    };
  }

  _activityState(kind, attrs = this._currentTargetAttrs()) {
    const temporaryFlags = this._temporaryImmediateFlags(attrs);
    if (temporaryFlags[kind]) {
      return { running: true, source: "immediate" };
    }
    if (this._scheduledActionActive(kind, attrs)) {
      return { running: true, source: "schedule" };
    }
    return { running: false, source: "idle" };
  }

  _scheduledActionActive(kind, attrs = this._currentTargetAttrs()) {
    if (kind === "charge") {
      if (!this._stateObj(this._config.charge_switch) || this._stateObj(this._config.charge_switch)?.state !== "on") {
        return false;
      }
      const cycle = this._cycleState("charge");
      return this._anyActiveSlot(attrs?.battery_policy?.charge_slots || [], cycle.weekly);
    }
    if (kind === "discharge") {
      if (!this._stateObj(this._config.discharge_switch) || this._stateObj(this._config.discharge_switch)?.state !== "on") {
        return false;
      }
      const cycle = this._cycleState("discharge");
      return this._anyActiveSlot(attrs?.battery_policy?.discharge_slots || [], cycle.weekly);
    }
    if (kind === "feedin") {
      if (!this._stateObj(this._config.feedin_enabled) || this._stateObj(this._config.feedin_enabled)?.state !== "on") {
        return false;
      }
      return this._anyActiveSlot(attrs?.feedin_policy?.slots || [], false);
    }
    return false;
  }

  _anyActiveSlot(slots, weekly) {
    return (slots || []).some((slot) => this._isSlotActive(slot, weekly));
  }

  _isSlotActive(slot, weekly = false) {
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const start = this._timeToMinutes(slot?.start);
    const end = this._timeToMinutes(slot?.end);
    if (start === null || end === null) return false;

    if (weekly) {
      const weeks = Array.isArray(slot?.weeks) ? slot.weeks.map(Number) : [];
      const currentDay = ((now.getDay() + 6) % 7) + 1;
      if (!weeks.includes(currentDay)) {
        return false;
      }
    }

    if (start === end) return false;
    if (end > start) {
      return nowMinutes >= start && nowMinutes < end;
    }
    return nowMinutes >= start || nowMinutes < end;
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

  _renderSummaryMeter(percent) {
    if (!Number.isFinite(percent)) return "";
    const clamped = Math.max(0, Math.min(100, percent));
    return `<div class="summary-meter"><span style="width:${clamped}%"></span></div>`;
  }

  _summaryToneFromBatteryPower(value) {
    if (!Number.isFinite(value)) return "unavailable";
    if (value > 0) return "charging live";
    if (value < 0) return "discharging live";
    return "idle";
  }

  _summaryToneFromImmediate(value) {
    const text = String(value || "").toLowerCase();
    if (text.includes("feed-in")) return "feedin";
    if (text.includes("discharging")) return "discharging";
    if (text.includes("charging")) return "charging";
    return "idle";
  }

  _summaryIsAnimatedTone(tone) {
    return /charging|discharging|feedin/.test(String(tone || ""));
  }

  _summaryPowerMeterPercent(value) {
    if (!Number.isFinite(value)) return null;
    return Math.max(0, Math.min(100, Math.abs(value) / 100));
  }

  _summaryLoadMeterPercent(value) {
    if (!Number.isFinite(value)) return null;
    return Math.max(0, Math.min(100, Math.abs(value) / 100));
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
    if (text === "unknown" || text === "unavailable") return "";
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) return text;
    return Number.isInteger(parsed) ? String(parsed) : String(parsed);
  }

  _normalizeTimeValue(value) {
    const text = this._normalizeNumberState(value);
    if (!text) return "";
    return text.length >= 5 ? text.slice(0, 5) : text;
  }

  _immediateFeedinPower(summary) {
    const firstSlot = (summary?.slots || []).find((slot) => Number(slot?.power) > 0);
    return Number.isFinite(Number(firstSlot?.power)) ? Number(firstSlot.power) : 1000;
  }

  _immediateFeedinDuration(summary) {
    const firstSlot = (summary?.slots || []).find((slot) => slot?.start && slot?.end);
    const start = this._timeToMinutes(firstSlot?.start);
    const end = this._timeToMinutes(firstSlot?.end);
    if (start === null || end === null) return 60;
    const diff = end >= start ? end - start : end + 1440 - start;
    return diff > 0 ? diff : 60;
  }

  _timeToMinutes(value) {
    const text = this._normalizeTimeValue(value);
    if (!text || !text.includes(":")) return null;
    const [hh, mm] = text.split(":").map((item) => Number(item));
    if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
    return hh * 60 + mm;
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

  _scrollRoot() {
    return window.document.scrollingElement || window.document.documentElement || null;
  }

  _restoreScrollPosition(scrollRoot, scrollTop) {
    if (!scrollRoot || scrollTop === null || scrollTop === undefined) return;
    window.requestAnimationFrame(() => {
      scrollRoot.scrollTop = scrollTop;
    });
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

  _validateSlotRows(section, rows, weekly = false) {
    const activeRows = (rows || []).filter((row) => !row.__deleted);
    for (const row of activeRows) {
      if (!row.start || !row.end) {
        throw new Error(`Setting ${row.sort} is missing a start or end time`);
      }
      if (this._timeToMinutes(row.end) <= this._timeToMinutes(row.start)) {
        throw new Error(`Setting ${row.sort} must end after it starts`);
      }
      if (section !== "feedin" && (row.soc === "" || row.soc === undefined || row.soc === null)) {
        throw new Error(`Setting ${row.sort} is missing SOC`);
      }
      if (row.power === "" || row.power === undefined || row.power === null) {
        throw new Error(`Setting ${row.sort} is missing POWER`);
      }
      if (weekly && section !== "feedin" && (!Array.isArray(row.weeks) || row.weeks.length === 0)) {
        throw new Error(`Setting ${row.sort} must include at least one day`);
      }
    }
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
    const savedRows = this._sectionSavedRows(kind);
    this._toggleDeleteSlot(kind, slotNo, savedRows);
    this._setStatus("info", "Pending row change not committed");
    this.render();
  }

  async _addSlot(kind) {
    const savedRows = this._sectionSavedRows(kind);
    const currentRows =
      kind === "feedin"
        ? this._mergedSectionSlots(kind, savedRows, false)
        : this._mergedSectionSlots(
            kind,
            savedRows,
            this._cycleState(kind).weekly
          );
    const limit =
      kind === "feedin"
        ? (this._currentTargetAttrs()?.feedin_policy?.slot_limit || 6)
        : (kind === "charge"
            ? this._currentTargetAttrs()?.battery_policy?.charge_slot_limit || 6
            : this._currentTargetAttrs()?.battery_policy?.discharge_slot_limit || 6);
    const slotNo = this._nextAvailableSlot(currentRows, limit);
    if (!slotNo) {
      this._setStatus("error", `No free ${kind} slots available`);
      return;
    }
    const draft = this._defaultDraftSlot(
      kind,
      slotNo,
      kind !== "feedin" && this._cycleState(kind).weekly
    );
    this._slotDraftBucket(kind)[slotNo] = {
      ...draft,
      __new: true,
      __dirty: true,
    };
    delete this._slotDeletedBucket(kind)[slotNo];
    this._setStatus("info", "Pending row added. Commit Policy to save.");
    this.render();
  }

  _runNowData(service) {
    const data = {};
    if (service === "start_force_charge") {
      const node = this.shadowRoot.querySelector('[data-key="force-charge-limit"]');
      data.charge_cap = Number(
        node?.value || this._immediateDraftValue("force-charge-limit", this._entityNumberValue(this._config.charge_cap, 100))
      );
    }
    if (service === "start_discharge_now") {
      const socNode = this.shadowRoot.querySelector('[data-key="immediate-discharge-soc"]');
      const powerNode = this.shadowRoot.querySelector('[data-key="immediate-discharge-power"]');
      const durationNode = this.shadowRoot.querySelector('[data-key="immediate-discharge-duration"]');
      data.soc = Number(
        socNode?.value || this._immediateDraftValue("immediate-discharge-soc", this._entityNumberValue(this._config.discharge_cutoff, 10))
      );
      data.power_watts = Number(
        powerNode?.value || this._immediateDraftValue("immediate-discharge-power", this._entityNumberValue(this._config.discharge_power, 5000))
      );
      data.duration_minutes = Number(durationNode?.value || this._immediateDraftValue("immediate-discharge-duration", 60));
    }
    if (service === "start_feedin_now") {
      const powerNode = this.shadowRoot.querySelector('[data-key="immediate-feedin-power"]');
      const durationNode = this.shadowRoot.querySelector('[data-key="immediate-feedin-duration"]');
      data.power_watts = Number(powerNode?.value || this._immediateDraftValue("immediate-feedin-power", 1000));
      data.duration_minutes = Number(durationNode?.value || this._immediateDraftValue("immediate-feedin-duration", 60));
    }
    return data;
  }

  async _runNow(service) {
    const data = this._runNowData(service);
    await this._run(
      async () => {
        await this._syncImmediateLinkedFields(service, data);
        await this._callByteWatt(service, data);
      },
      "Action sent",
      "Action failed"
    );
  }

  async _toggleImmediate(kind, startService, stopService) {
    const attrs = this._currentTargetAttrs();
    const flags = this._immediateFlags(attrs);
    const running = flags[kind];
    const blocked = !running && Object.entries(flags).some(([name, active]) => name !== kind && active);
    if (blocked) {
      this._setStatus("error", "Another immediate action is already active");
      return;
    }
    const service = running ? stopService : startService;
    const data = this._runNowData(service);
    const actionLabel = kind === "feedin" ? "Feed-in" : kind[0].toUpperCase() + kind.slice(1);
    const successMessage = running
      ? `${actionLabel} stop requested`
      : `${actionLabel} start requested`;

    try {
      await this._syncImmediateLinkedFields(service, data);
      await this._callByteWatt(service, data);
      this._immediateState[kind] = !running;
      this._setStatus("success", successMessage);
    } catch (error) {
      this._setStatus("error", `Action failed: ${this._errorMessage(error)}`);
    }
  }

  async _syncImmediateLinkedFields(service, data) {
    if (service === "start_feedin_now") {
      const cutoffNode = this.shadowRoot.querySelector('[data-key="immediate-feedin-cutoff"]');
      const cutoffValue = Number(
        cutoffNode?.value || this._entityNumberValue(this._config.feedin_cutoff, 0)
      );
      await this._setNumberIfNeeded(this._config.feedin_cutoff, cutoffValue);
    }
  }

  _immediateKindForKey(key) {
    if (key === "force-charge-limit") return "charge";
    if (String(key || "").startsWith("immediate-discharge-")) return "discharge";
    if (String(key || "").startsWith("immediate-feedin-")) return "feedin";
    return null;
  }

  _startServiceForImmediateKind(kind) {
    if (kind === "charge") return "start_force_charge";
    if (kind === "discharge") return "start_discharge_now";
    if (kind === "feedin") return "start_feedin_now";
    return null;
  }

  async _reapplyImmediateIfRunning(key) {
    const kind = this._immediateKindForKey(key);
    if (!kind || !this._isImmediateRunning(kind)) return;
    const service = this._startServiceForImmediateKind(kind);
    if (!service) return;
    const data = this._runNowData(service);
    await this._run(
      async () => {
        await this._syncImmediateLinkedFields(service, data);
        await this._callByteWatt(service, data);
      },
      `${kind === "feedin" ? "Feed-in" : kind[0].toUpperCase() + kind.slice(1)} updated`,
      "Immediate update failed"
    );
  }

  async _commitPolicy(section) {
    await this._run(
      async () => {
        if (section === "charge" || section === "discharge") {
          await this._commitBatteryPolicy(section);
        } else if (section === "feedin") {
          await this._commitFeedinPolicy();
        } else if (section === "offgrid") {
          await this._commitOffgridPolicy();
        }
        this._clearSectionDraft(section);
        this._clearSlotDrafts(section);
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
    const savedSlots = section === "charge" ? summary.charge_slots || [] : summary.discharge_slots || [];
    const slots = this._mergedSectionSlots(section, savedSlots, String(cycleDesired).toLowerCase() === "weekly");
    this._validateSlotRows(section, slots, String(cycleDesired).toLowerCase() === "weekly");

    const deletedSlots = Object.keys(this._slotDeletedBucket(section)).map((slot) => Number(slot));
    for (const slotNo of deletedSlots) {
      await this._callByteWatt("delete_battery_slot", {
        policy_kind: section,
        slot: slotNo,
      });
    }

    for (const slot of slots.filter((row) => !row.__deleted)) {
      await this._callByteWatt("update_battery_slot", {
        policy_kind: section,
        slot: Number(slot.sort),
        start_time: this._normalizeTimeValue(slot.start),
        end_time: this._normalizeTimeValue(slot.end),
        soc: Number(slot.soc),
        power_watts: Number(slot.power),
        ...(String(cycleDesired).toLowerCase() === "weekly"
          ? { weeks: Array.isArray(slot.weeks) ? slot.weeks : [] }
          : {}),
      });
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
    const slots = this._mergedSectionSlots("feedin", summary.slots || [], false);
    this._validateSlotRows("feedin", slots, false);

    const deletedSlots = Object.keys(this._slotDeletedBucket("feedin")).map((slot) => Number(slot));
    for (const slotNo of deletedSlots) {
      await this._callByteWatt("delete_grid_feedin_slot", { slot: slotNo });
    }

    for (const slot of slots.filter((row) => !row.__deleted)) {
      await this._callByteWatt("update_grid_feedin_slot", {
        slot: Number(slot.sort),
        start_time: this._normalizeTimeValue(slot.start),
        end_time: this._normalizeTimeValue(slot.end),
        power_watts: Number(slot.power),
      });
    }
  }

  async _commitOffgridPolicy() {
    await this._setSwitchIfNeeded(
      this._config.offgrid_switch,
      this._draftValue("offgrid", this._config.offgrid_switch, this._stateObj(this._config.offgrid_switch)?.state === "on")
    );
    await this._setNumberIfNeeded(
      this._config.offgrid_wakeup_soc,
      this._draftValue("offgrid", this._config.offgrid_wakeup_soc, this._stateObj(this._config.offgrid_wakeup_soc)?.state)
    );
    await this._setNumberIfNeeded(
      this._config.offgrid_cutoff_soc,
      this._draftValue("offgrid", this._config.offgrid_cutoff_soc, this._stateObj(this._config.offgrid_cutoff_soc)?.state)
    );
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
    this.shadowRoot.querySelectorAll(this._editableSelector()).forEach((node) => {
      node.addEventListener("focusin", () => {
        this._beginEditSession(this._sectionKindForNode(node));
      });
      node.addEventListener("focusout", () => {
        this._scheduleEditSessionRelease();
      });
    });

    this.shadowRoot.querySelectorAll("[data-select]").forEach((node) => {
      node.addEventListener("change", (event) => {
        this._run(
          async () => {
            this._clearAllDrafts();
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
        this.render();
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

    this.shadowRoot.querySelectorAll("[data-key]").forEach((node) => {
      node.addEventListener("input", () => {
        this._setImmediateDraftValue(node.dataset.key, node.value);
      });
      node.addEventListener("change", () => {
        this._setImmediateDraftValue(node.dataset.key, node.value);
        this._reapplyImmediateIfRunning(node.dataset.key);
      });
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

    this.shadowRoot.querySelectorAll("[data-slot-field]").forEach((node) => {
      node.addEventListener("input", () => {
        const [kind, slotNo, field] = node.dataset.slotField.split(":");
        const value =
          field === "weeks"
            ? (node.value || "")
                .split(",")
                .map((item) => Number(item.trim()))
                .filter((item) => Number.isFinite(item))
            : node.value;
        this._setSlotDraftValue(kind, Number(slotNo), field, value);
      });
    });

    this.shadowRoot.querySelectorAll("[data-add-slot]").forEach((node) => {
      node.addEventListener("click", () => this._addSlot(node.dataset.addSlot));
    });

    this.shadowRoot.querySelectorAll("[data-commit-policy]").forEach((node) => {
      node.addEventListener("click", () => this._commitPolicy(node.dataset.commitPolicy));
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
        this._setSlotDraftValue(kind, Number(slotNo), "weeks", next);
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

