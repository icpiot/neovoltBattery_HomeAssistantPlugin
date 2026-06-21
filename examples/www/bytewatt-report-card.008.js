const BYTEWATT_REPORT_CARD_BUILD = "008";

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

  _buildCsv(reporting) {
    const powerDiagram = reporting?.power_diagram || {};
    const summary = powerDiagram.summary || {};
    const live = reporting?.live || {};
    const today = reporting?.today || {};
    const totals = reporting?.totals || {};
    const series = powerDiagram.series || {};
    const times = powerDiagram.time || [];

    const rows = [
      ["Label", reporting?.label || "ByteWatt"],
      ["Date", powerDiagram.date || ""],
      ["Live SOC", live.soc ?? ""],
      ["Live Battery Power", live.battery_power ?? ""],
      ["Live Load Power", live.house_consumption ?? ""],
      ["Live Grid Power", live.grid_power ?? ""],
      ["Live PV Power", live.pv_power ?? ""],
      ["Power Source", live.power_source ?? ""],
      [],
      ["Today Summary"],
      ["Solar Generation", today.solar_generation ?? ""],
      ["Load Consumption", today.load_consumption ?? ""],
      ["Battery Charged", today.battery_charge ?? ""],
      ["Battery Discharged", today.battery_discharge ?? ""],
      ["Feed-in", today.feed_in ?? ""],
      ["Grid Consumption", today.grid_consumption ?? ""],
      ["Self Consumption", today.self_consumption ?? ""],
      ["Self Sufficiency", today.self_sufficiency ?? ""],
      ["Today Income", today.today_income ?? ""],
      ["Total Income", today.total_income ?? ""],
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
      ["Grid to Battery", totals.grid_battery_charge ?? ""],
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
      ["Time", "BAT", "Load", "Solar", "Feed-in", "Consumed"],
    ];

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

    return rows
      .map((row) => row.map((value) => this._csvSafe(value)).join(","))
      .join("\r\n");
  }

  _downloadCsv() {
    const reporting = this._reporting();
    if (!reporting) return;
    const csv = this._buildCsv(reporting);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = (reporting?.power_diagram?.date || "today").replaceAll("/", "-");
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

  _renderAggregateStrip(reporting) {
    if (!reporting?.aggregate) return "";
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
    if (!reporting?.aggregate) return "";
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
    return `
      <div class="overview-grid">
        <section class="overview-panel">
          <div class="overview-kicker">Today</div>
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
            ${this._metric("Today Income", this._fmtCurrency(today.today_income))}
            ${this._metric("Total Income", this._fmtCurrency(today.total_income))}
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
    return `
      <div class="summary-grid">
        ${this._summaryTile("Today's Generation", this._fmtEnergy(today.solar_generation), "solar")}
        ${this._summaryTile("Today's Consumption", this._fmtEnergy(today.load_consumption), "load")}
        ${this._summaryTile("BAT SOC", this._fmtPercent(reporting?.live?.soc), "bat")}
        ${this._summaryTile("Today's Feed-in", this._fmtEnergy(today.feed_in), "feed")}
        ${this._summaryTile("Today's Grid Consumption", this._fmtEnergy(today.grid_consumption), "grid")}
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
        ${this._liveTile("Solar", this._fmtPower(live.pv_power))}
        ${this._liveTile("Battery", this._fmtPower(live.battery_power))}
        ${this._liveTile("Load", this._fmtPower(live.house_consumption))}
        ${this._liveTile("Grid", this._fmtPower(live.grid_power))}
        ${this._liveTile("Mode", this._escape(powerSource))}
      </div>
    `;
  }

  _liveTile(label, value) {
    return `
      <div class="live-tile">
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

  _renderChart(reporting) {
    const powerDiagram = reporting?.power_diagram || {};
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
      bat: ["rgba(152, 211, 91, 0.45)", "#98d35b"],
      load: ["rgba(111, 214, 235, 0.38)", "#6fd6eb"],
      solar: ["rgba(255, 209, 60, 0.42)", "#ffd13c"],
      feed_in: ["rgba(255, 143, 62, 0.34)", "#ff8f3e"],
      consumed: ["rgba(211, 157, 108, 0.28)", "#d39d6c"],
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
            <div class="panel-date">${this._escape(powerDiagram.date || "")}</div>
            <button class="download-btn" data-download-report>Download CSV</button>
          </div>
        </div>
        ${
          this._view === "power"
            ? `
          <div class="ring-grid">
            ${this._ring("Today's Generation", this._fmtEnergy(powerSummary.solar_generation), "solar")}
            ${this._ring("Today's Consumption", this._fmtEnergy(powerSummary.load_consumption), "load")}
            ${this._ring("BAT SOC", this._fmtPercent(powerSummary.soc), "bat")}
            ${this._ring("Today's Feed-in", this._fmtEnergy(powerSummary.feed_in), "feed")}
            ${this._ring("Today's Grid Consumption", this._fmtEnergy(powerSummary.grid_consumption), "grid")}
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
    const reporting = this._reporting();

    this.shadowRoot.innerHTML = `
      <style>
        :host { display:block; width:100%; }
        ha-card {
          background:
            radial-gradient(circle at top right, rgba(76, 149, 255, 0.18), transparent 28%),
            linear-gradient(180deg, #f8fbff 0%, #eef4fb 100%);
          border-radius: 24px;
          border: 1px solid rgba(51, 92, 140, 0.12);
          color: #162334;
          box-shadow: 0 24px 48px rgba(20, 44, 78, 0.12);
          overflow: hidden;
        }
        .shell { display:grid; gap:18px; padding:20px; }
        .title-row { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
        .title-icon {
          width:34px; height:34px; border-radius:12px; display:flex; align-items:center; justify-content:center;
          background:linear-gradient(180deg, #4ba4ff, #2f75d8); color:#fff; font-weight:800;
          box-shadow:0 12px 24px rgba(47,117,216,0.22);
        }
        .title { font-size:1.4rem; font-weight:800; }
        .version-badge {
          display:inline-flex; align-items:center; justify-content:center; padding:4px 8px;
          border-radius:999px; background:#e5f1ff; color:#205ca8; font-size:0.78rem; font-weight:800;
          border:1px solid rgba(45, 104, 180, 0.18);
        }
        .selector-row {
          display:grid; grid-template-columns: 160px minmax(0, 1fr); gap:16px; align-items:center;
        }
        .label { font-size:0.95rem; font-weight:700; color:#31435d; }
        select {
          width:min(360px, 100%);
          padding:12px 14px;
          border-radius:14px;
          border:1px solid rgba(51, 92, 140, 0.18);
          background:#fff;
          color:#17263a;
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
          background:#fff;
          border-radius:18px;
          border:1px solid rgba(51, 92, 140, 0.12);
          padding:16px 18px;
          box-shadow: 0 10px 20px rgba(20, 44, 78, 0.06);
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
          color:#5c7897;
        }
        .hero-title {
          font-size:1.35rem;
          font-weight:900;
          color:#14243a;
        }
        .hero-subtitle {
          color:#486782;
          font-size:0.96rem;
          font-weight:700;
        }
        .hero-metrics {
          display:grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap:12px;
        }
        .hero-chip {
          background:#f8fbff;
          border:1px solid rgba(51, 92, 140, 0.1);
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
          color:#5a7592;
        }
        .hero-chip-value {
          font-size:1rem;
          font-weight:900;
          color:#17263a;
        }
        .aggregate-table-panel {
          background:#fff;
          border-radius:18px;
          border:1px solid rgba(51, 92, 140, 0.12);
          padding:16px 18px;
          box-shadow: 0 10px 20px rgba(20, 44, 78, 0.06);
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
          color:#16253a;
        }
        .aggregate-table-subtitle {
          font-size:0.84rem;
          color:#587491;
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
          background:#f8fbff;
          border:1px solid rgba(51, 92, 140, 0.08);
          color:#22354d;
          font-size:0.92rem;
          font-weight:700;
        }
        .aggregate-header {
          background:#edf4fc;
          color:#55718f;
          font-size:0.78rem;
          letter-spacing:0.05em;
          text-transform:uppercase;
        }
        .aggregate-cell-title {
          font-weight:900;
          color:#17263a;
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
          color:#597291;
        }
        .aggregate-metric {
          margin-top:6px;
          color:#31435d;
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
          color:#14243a;
        }
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
          border:1px solid rgba(51, 92, 140, 0.12);
          padding:18px;
          box-shadow: 0 12px 24px rgba(20, 44, 78, 0.08);
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
          color:#17263a;
        }
        .panel-date {
          padding:8px 12px;
          border-radius:999px;
          background:#eef5ff;
          color:#36567b;
          font-size:0.9rem;
          font-weight:700;
        }
        .detail-grid {
          display:grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap:12px;
        }
        .detail-cell {
          background:#f8fbff;
          border:1px solid rgba(51, 92, 140, 0.1);
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
          color:#5a7592;
        }
        .detail-value {
          font-size:1rem;
          font-weight:800;
          color:#16253a;
          word-break:break-word;
        }
        .flow-grid {
          display:grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap:14px;
        }
        .flow-card {
          background:#f8fbff;
          border:1px solid rgba(51, 92, 140, 0.1);
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
          color:#5a7592;
        }
        .flow-value {
          font-size:1.35rem;
          font-weight:800;
          color:#17263a;
        }
        .flow-sub {
          color:#496681;
          font-size:0.92rem;
          font-weight:700;
        }
        .flow-chip {
          width:max-content;
          padding:5px 10px;
          border-radius:999px;
          background:#eaf3ff;
          color:#1f5ca8;
          font-size:0.82rem;
          font-weight:800;
        }
        .flow-solar { box-shadow: inset 0 0 0 1px rgba(242, 166, 58, 0.14); }
        .flow-battery { box-shadow: inset 0 0 0 1px rgba(152, 211, 91, 0.14); }
        .flow-grid-node { box-shadow: inset 0 0 0 1px rgba(239, 143, 62, 0.14); }
        .flow-load { box-shadow: inset 0 0 0 1px rgba(111, 214, 235, 0.14); }
        .energy-layout {
          display:grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap:16px;
          align-items:center;
        }
        .energy-node {
          background:#f8fbff;
          border:1px solid rgba(51, 92, 140, 0.1);
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
          color:#355377;
          text-transform:uppercase;
          letter-spacing:0.05em;
        }
        .energy-node-value {
          font-size:1.5rem;
          font-weight:800;
          color:#15253d;
        }
        .energy-node-sub,
        .energy-bridge {
          font-size:0.88rem;
          color:#4d6787;
        }
        .energy-bridge {
          text-align:center;
          font-weight:700;
        }
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
          background:#e8eff8;
          color:#476687;
        }
        .panel-tabs button.active {
          background:#2f75d8;
          color:#fff;
        }
        .download-btn {
          background:#2f75d8;
          color:#fff;
          box-shadow:0 10px 20px rgba(47,117,216,0.2);
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
          background:#fbfdff;
        }
        .ring-solar { border-color:#f2a63a; }
        .ring-load { border-color:#7ad0df; }
        .ring-bat { border-color:#9acc54; }
        .ring-feed { border-color:#ef8d3a; }
        .ring-grid { border-color:#d9a26d; }
        .ring-value {
          font-size:1.1rem;
          font-weight:800;
          color:#17263a;
        }
        .ring-label {
          margin-top:8px;
          color:#506884;
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
          background:#eef4fb;
          color:#4a6787;
        }
        .legend-chip.active {
          background:#1f2e43;
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
          color:#30445e;
        }
        .stats-row-value {
          font-size:0.95rem;
          font-weight:800;
          color:#16253a;
          text-align:right;
        }
        .stats-bar-track {
          position:relative;
          overflow:hidden;
          height:14px;
          border-radius:999px;
          background:#edf3fa;
        }
        .stats-bar-fill {
          height:100%;
          border-radius:999px;
        }
        .tone-solar { background:linear-gradient(90deg, #f0b343, #ffd552); }
        .tone-load { background:linear-gradient(90deg, #64cfe0, #83e6f2); }
        .tone-battery { background:linear-gradient(90deg, #9ecf57, #b8e078); }
        .tone-feed { background:linear-gradient(90deg, #ff8f3e, #ffb066); }
        .tone-grid { background:linear-gradient(90deg, #d7a16c, #e8bc92); }
        .tone-info { background:linear-gradient(90deg, #4b8fff, #6ca7ff); }
        .empty {
          padding:24px;
          border-radius:18px;
          background:#fff;
          border:1px dashed rgba(51, 92, 140, 0.24);
          color:#496681;
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
      </style>
      <ha-card>
        <div class="shell">
          <div class="title-row">
            <div class="title-icon">&#9889;</div>
            <div class="title">ByteWatt Report</div>
            <div class="version-badge">v${BYTEWATT_REPORT_CARD_BUILD}</div>
          </div>
          ${this._renderSelector()}
          ${
            reporting
              ? `
            ${this._renderHeroBanner(reporting)}
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
