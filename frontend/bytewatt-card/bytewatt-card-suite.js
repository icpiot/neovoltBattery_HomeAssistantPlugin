import "./bytewatt-policy-card.js";
import "./bytewatt-report-card.js";

const BYTEWATT_CARD_SUITE_BUILD = "001";

window.customCards = window.customCards || [];
window.customCards.push({
  type: "bytewatt-card-suite",
  name: `Byte-Watt Card Suite v${BYTEWATT_CARD_SUITE_BUILD}`,
  description:
    "Loader module that registers both the Byte-Watt policy card and reporting card.",
});
