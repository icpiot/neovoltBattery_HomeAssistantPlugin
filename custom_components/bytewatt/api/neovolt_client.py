"""API client for Neovolt battery systems."""
import base64
import logging
import asyncio
import json
import aiohttp
from zoneinfo import ZoneInfo
from typing import Dict, Any, Optional
from datetime import datetime, timedelta

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.util import dt as dt_util

from .neovolt_auth import EncryptionError, encrypt_password

_LOGGER = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 30
DEFAULT_BASE_URL = "https://monitor.byte-watt.com"

# Max number of times async_get_battery_data / async_get_device_list will
# re-login and retry after a session-expiry / 401 response. One retry is
# normally sufficient — the new session is fresh, so a second 6069 means
# the server is misbehaving and we should fail loudly instead of recursing
# forever and exhausting the stack.
MAX_RELOGIN_RETRIES = 1

WINDOWS_TIMEZONE_MAP = {
    "AUS Eastern Standard Time": "Australia/Sydney",
    "E. Australia Standard Time": "Australia/Brisbane",
    "W. Australia Standard Time": "Australia/Perth",
    "Cen. Australia Standard Time": "Australia/Adelaide",
    "AUS Central Standard Time": "Australia/Darwin",
}


class ByteWattAPIError(Exception):
    """Raised by async_get_battery_data when the API call cannot complete.

    Returning None on failure prevented the coordinator's _timed_operation
    circuit-breaker accounting from registering the failure — every API
    error looked like a success. Raising lets exceptions propagate through
    _timed_operation, where the circuit breaker can record them and
    eventually trip to OPEN.

    The coordinator catches this exception and falls back to cached data
    where appropriate (preserving the previous "tolerate transient errors"
    behaviour for the user-facing sensors).
    """


class ByteWattAuthError(ByteWattAPIError):
    """Raised when authentication fails and the config entry needs reauth."""


async def _decode_json_object(response, context: str) -> Optional[Dict[str, Any]]:
    """Decode an aiohttp response body to a JSON object (dict), or return None.

    Guards against three failure modes that would otherwise propagate as
    crashes into the .get() lines that follow:

      1. ContentTypeError — body's Content-Type isn't JSON
      2. ValueError / JSONDecodeError — body is JSON-shaped but malformed
      3. Valid JSON but not an object — e.g. ``[]``, ``"error"``, ``null``
         (an error page returned as a JSON string would crash
         ``result.get(...)`` because str has no .get method)

    Logs at error level and returns None so callers can fail gracefully.
    """
    try:
        decoded = await response.json()
    except (ValueError, aiohttp.ContentTypeError) as err:
        _LOGGER.error("%s: response was not valid JSON (%s)", context, err)
        return None
    if not isinstance(decoded, dict):
        _LOGGER.error(
            "%s: response decoded to %s, expected object: %r",
            context, type(decoded).__name__, decoded,
        )
        return None
    return decoded


def _stat_value(stats_data, key):
    """Read a numeric field from a stats response, coercing missing / None /
    empty / non-numeric values to 0 so derived arithmetic never raises.

    The Byte-Watt API has dropped fields without warning historically and
    returns null for sensors with no data yet (e.g. before midnight on day
    one of install). Defensive coercion to a float lets the arithmetic
    complete; the integration's sensor entities surface the underlying
    field directly so a 0 here only affects the derived total, not the
    raw reading.
    """
    value = stats_data.get(key)
    if value is None or value == "":
        return 0
    try:
        return float(value)
    except (TypeError, ValueError):
        _LOGGER.debug("Non-numeric value for %s in stats response: %r", key, value)
        return 0


def _is_success_code(result: Optional[Dict[str, Any]]) -> bool:
    """Return True when an API payload uses a success code we accept."""
    if not isinstance(result, dict):
        return False
    return result.get("code") in (0, 200)


def _first_list_value(source: Dict[str, Any], *keys: str) -> list[Any]:
    """Return the first non-empty list found under the supplied keys."""
    for key in keys:
        value = source.get(key)
        if isinstance(value, list) and len(value) > 0:
            return value
    return []


def _normalized_power_diagram(
    source: Dict[str, Any],
    *,
    report_date: str,
    battery_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Normalize chart payloads into the archived power_diagram shape."""
    battery_data = battery_data or {}
    nested = {}
    for key in ("Power_Diagram", "power_diagram"):
        value = source.get(key)
        if isinstance(value, dict) and value:
            nested = value
            break

    series = nested.get("series") if isinstance(nested.get("series"), dict) else {}
    if not isinstance(series, dict):
        series = {}
    source_series = source.get("series") if isinstance(source.get("series"), dict) else {}
    time_points = nested.get("time") if isinstance(nested.get("time"), list) else []

    if not time_points:
        time_points = _first_list_value(source, "time", "times", "chartTime", "chart_time")

    def _series_or_fallback(key: str, *fallback_keys: str) -> list[Any]:
        current = series.get(key)
        if isinstance(current, list) and len(current) > 0:
            return current
        source_series_value = source_series.get(key)
        if isinstance(source_series_value, list) and len(source_series_value) > 0:
            return source_series_value
        return _first_list_value(source, *fallback_keys)

    series = {
        "bat": _series_or_fallback("bat", "cbat", "bat"),
        "load": _series_or_fallback("load", "usePower", "homePower", "load"),
        "solar": _series_or_fallback("solar", "ppv", "solar"),
        "feed_in": _series_or_fallback("feed_in", "feedIn", "feed_in"),
        "consumed": _series_or_fallback("consumed", "gridCharge", "consumed"),
    }

    summary = nested.get("summary") if isinstance(nested.get("summary"), dict) else {}
    if not isinstance(summary, dict):
        summary = {}
    if not summary:
        summary = {
            "soc": source.get("soc"),
            "solar_generation": battery_data.get("PV_Generated_Today"),
            "load_consumption": battery_data.get("Consumed_Today"),
            "feed_in": battery_data.get("Feed_In_Today"),
            "grid_consumption": battery_data.get("Grid_Import_Today"),
            "battery_charge": battery_data.get("Battery_Charged_Today"),
            "battery_discharge": battery_data.get("Battery_Discharged_Today"),
        }

    meta = nested.get("meta") if isinstance(nested.get("meta"), dict) else {}
    if not isinstance(meta, dict):
        meta = {}
    if not meta:
        meta = {
            "power_source": source.get("powerSource"),
            "system_time": source.get("systemTime"),
            "maximum_power": source.get("maximumPower"),
            "inverter_mode": source.get("inverterMode"),
        }

    return {
        "date": nested.get("date") or report_date,
        "time": time_points,
        "series": series,
        "summary": summary,
        "meta": meta,
    }


def _decode_jwt_payload(token: str) -> Dict[str, Any]:
    """Decode the payload portion of a JWT without verifying the signature."""
    parts = str(token or "").split(".")
    if len(parts) < 2:
        return {}
    payload = parts[1].replace("-", "+").replace("_", "/")
    padding = (-len(payload)) % 4
    if padding:
        payload += "=" * padding
    try:
        decoded = base64.b64decode(payload.encode("utf-8"))
        value = json.loads(decoded.decode("utf-8"))
        return value if isinstance(value, dict) else {}
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        return {}

class NeovoltClient:
    """API Client for Neovolt battery systems."""
    
    def __init__(
        self, 
        hass: HomeAssistant, 
        username: str, 
        password: str, 
        base_url: str = DEFAULT_BASE_URL,
        host_system_id: str = "",
        host_sys_sn: str = "",
    ) -> None:
        """Initialize the API client."""
        self.hass = hass
        self.username = username
        self.password = password
        self.base_url = base_url
        self.session = async_get_clientsession(hass)
        self.token: Optional[str] = None
        self.user_id: Optional[str] = None
        self.host_system_id = host_system_id   # systemId of the Host inverter
        self.host_sys_sn = host_sys_sn         # sysSn of the Host inverter
        self.timezone_code: Optional[str] = None
        self._timezone: Optional[ZoneInfo] = None

    def _aggregate_monitoring_sys_sn(self) -> str:
        """Return the merged monitoring scope used by aggregate sensors.

        The Byte-Watt app exposes a combined "All" view for whole-system
        monitoring. Battery-specific settings are a separate concern and are
        targeted through host_system_id / host_sys_sn on the settings APIs.
        """
        return "All"

    def _set_timezone_code(self, timezone_code: str | None) -> None:
        code = str(timezone_code or "").strip()
        self.timezone_code = code or None
        self._timezone = None
        if not code:
            return
        timezone_name = WINDOWS_TIMEZONE_MAP.get(code, code)
        try:
            self._timezone = ZoneInfo(timezone_name)
        except Exception:
            _LOGGER.debug("Unable to resolve timezone code %s (%s)", code, timezone_name)
            self._timezone = None

    def _current_time(self) -> datetime:
        if self._timezone is not None:
            return dt_util.now(self._timezone)
        return dt_util.now()

    async def _async_fetch_timezone_code(self) -> Optional[str]:
        """Fetch the configured account timezone code if available."""
        headers = self._get_auth_headers()
        for endpoint in (
            "/api/stable/userInformationSetting/getCustomUserSetting",
            "/api/stable/userInformationSetting/getOtherRoleUserSetting",
        ):
            try:
                async with asyncio.timeout(DEFAULT_TIMEOUT):
                    async with self.session.get(url=f"{self.base_url}{endpoint}", headers=headers) as response:
                        if response.status != 200:
                            continue
                        result = await _decode_json_object(response, endpoint.rsplit("/", 1)[-1])
                        if not _is_success_code(result):
                            continue
                        data = result.get("data", {}) or {}
                        timezone_code = str(data.get("timezonecode") or data.get("timezoneCode") or "").strip()
                        if timezone_code:
                            return timezone_code
            except (asyncio.TimeoutError, aiohttp.ClientError, ValueError):
                continue
        return None
    
    async def async_login(self) -> bool:
        """Login to the Neovolt API using encrypted password."""
        _LOGGER.debug("Logging in to Neovolt API as %s", self.username)

        login_url = f"{self.base_url}/api/usercenter/cloud/user/login"

        # Encrypt OR fail loudly — never fall through to plaintext.
        try:
            encrypted_password = encrypt_password(self.password, self.username)
        except EncryptionError as exc:
            _LOGGER.error(
                "Cannot log in: password encryption failed (%s). "
                "Refusing to fall back to the plaintext form-data path.",
                exc,
            )
            return False

        payload = {
            "username": self.username,
            "password": encrypted_password,
        }
        
        try:
            async with asyncio.timeout(DEFAULT_TIMEOUT):
                async with self.session.post(
                    url=login_url,
                    json=payload,
                    headers={"Content-Type": "application/json"},
                ) as response:
                    if response.status != 200:
                        _LOGGER.error(
                            "Login failed with status %s: %s",
                            response.status,
                            await response.text(),
                        )
                        return False

                    result = await _decode_json_object(response, "login")
                    if result is None:
                        return False

                    if result.get("code") not in (0, 200):
                        _LOGGER.error(
                            "Login rejected with code %s: %s",
                            result.get("code"), result.get("msg"),
                        )
                        # NO plaintext fallback. The legacy _async_login_fallback
                        # path sent the password as form-data unencrypted — fine
                        # for early development against the old API, but a
                        # security smell now. If the encrypted path is rejected
                        # the credentials are wrong (or the encryption scheme
                        # rotated server-side), neither of which is fixed by
                        # leaking the plaintext.
                        return False

                    if "token" in result:
                        self.token = result["token"]
                    elif "data" in result and result["data"] and "token" in result["data"]:
                        self.token = result["data"]["token"]
                    else:
                        _LOGGER.error("No token found in login response")
                        return False

                    login_data = result.get("data") if isinstance(result.get("data"), dict) else {}
                    for key in ("userId", "userid", "user_id", "uid", "accountId", "id"):
                        value = result.get(key) or login_data.get(key)
                        if value not in (None, ""):
                            self.user_id = str(value)
                            break
                    if not self.user_id:
                        token_payload = _decode_jwt_payload(self.token or "")
                        for key in ("user_id", "userId", "userid", "uid", "accountId", "id"):
                            value = token_payload.get(key)
                            if value not in (None, ""):
                                self.user_id = str(value)
                                break

                    if not self.timezone_code:
                        timezone_code = await self._async_fetch_timezone_code()
                        if timezone_code:
                            self._set_timezone_code(timezone_code)

                    _LOGGER.debug("Successfully logged in to Neovolt API")
                    return True

        except (asyncio.TimeoutError, aiohttp.ClientError, ValueError) as error:
            _LOGGER.error("Error connecting to Neovolt API: %s", error)
            return False
    
    async def async_get_device_list(self, _retry_count: int = 0) -> Optional[Dict[str, Any]]:
        """Get the list of devices.

        ``_retry_count`` is an internal recursion guard — never pass it from
        the outside. See MAX_RELOGIN_RETRIES for the rationale.
        """
        if not self.token:
            if not await self.async_login():
                return None

        url = f"{self.base_url}/api/devices/list"

        try:
            async with asyncio.timeout(DEFAULT_TIMEOUT):
                async with self.session.get(
                    url=url, headers=self._get_auth_headers(),
                ) as response:
                    if response.status != 200:
                        _LOGGER.error(
                            "Failed to get device list with status %s: %s",
                            response.status,
                            await response.text(),
                        )
                        if response.status == 401 and _retry_count < MAX_RELOGIN_RETRIES:
                            if await self.async_login():
                                return await self.async_get_device_list(_retry_count + 1)
                        return None

                    result = await _decode_json_object(response, "getDeviceList")
                    if result is None:
                        return None

                    if result.get("code") != 0 and result.get("code") != 200:
                        if result.get("code") == 6069 and _retry_count < MAX_RELOGIN_RETRIES:
                            _LOGGER.warning("Session expired (code 6069), attempting to re-login")
                            if await self.async_login():
                                return await self.async_get_device_list(_retry_count + 1)

                        _LOGGER.error(
                            "Failed to get device list with code %s: %s",
                            result.get("code"),
                            result.get("msg"),
                        )
                        return None

                    return result.get("data")

        except (asyncio.TimeoutError, aiohttp.ClientError, ValueError) as error:
            _LOGGER.error("Error fetching device list: %s", error)
            return None
    
    async def async_get_battery_data(
        self,
        station_id: str = None,
        sys_sn: Optional[str] = None,
        _retry_count: int = 0,
    ) -> Dict[str, Any]:
        """Get data for a specific battery using the new API endpoint.

        Raises ``ByteWattAPIError`` if the critical real-time power data
        endpoint fails (login failure, network error, HTTP non-200,
        unrecoverable session expiry, or unexpected server code). The
        exception propagates through the coordinator's _timed_operation
        wrapper so the circuit breaker records the failure — previously
        a None return looked like a success to the CB and the breaker
        could never trip.

        Subsequent statistics endpoints (energy stats, today's stats,
        today's detailed stats) are still tolerated as partial failures
        — they return what was already fetched rather than raising — so
        a flaky statistics endpoint doesn't kill the real-time sensors.

        ``_retry_count`` is an internal recursion guard — never pass it
        from outside. Capped at MAX_RELOGIN_RETRIES.
        """
        if not self.token:
            if not await self.async_login():
                raise ByteWattAuthError("Login failed; cannot fetch battery data")

        # First get the real-time power data — failures of THIS call raise.
        url = f"{self.base_url}/api/report/energyStorage/getLastPowerData"

        effective_sys_sn = sys_sn or self._aggregate_monitoring_sys_sn()
        params = {"sysSn": effective_sys_sn, "stationId": station_id or ""}

        current_date = self._current_time().strftime("%Y-%m-%d %H:%M:%S")
        headers = self._get_auth_headers()
        headers.update({
            "Accept": "application/json, text/plain, */*",
            "language": "en-US",
            "operationDate": current_date,
            "platform": "AK9D8H",
            "System": "alphacloud",
        })

        try:
            battery_data: Dict[str, Any] = {}

            async with asyncio.timeout(DEFAULT_TIMEOUT):
                async with self.session.get(
                    url=url, params=params, headers=headers,
                ) as response:
                    if response.status != 200:
                        body = await response.text()
                        if response.status == 401 and _retry_count < MAX_RELOGIN_RETRIES:
                            if await self.async_login():
                                return await self.async_get_battery_data(
                                    station_id, effective_sys_sn, _retry_count + 1
                                )
                        if response.status == 401:
                            raise ByteWattAuthError("Authentication failed while fetching battery data")
                        raise ByteWattAPIError(
                            f"getLastPowerData HTTP {response.status}: {body[:200]}"
                        )

                    result = await _decode_json_object(response, "getLastPowerData")
                    if result is None:
                        raise ByteWattAPIError(
                            "getLastPowerData returned a non-JSON or non-object body"
                        )

                    if result.get("code") not in (0, 200):
                        if result.get("code") == 6069:
                            _LOGGER.warning("Session expired (code 6069), attempting to re-login")
                            if _retry_count < MAX_RELOGIN_RETRIES and await self.async_login():
                                return await self.async_get_battery_data(
                                    station_id, effective_sys_sn, _retry_count + 1
                                )
                            raise ByteWattAuthError("Session expired and re-login failed")
                        raise ByteWattAPIError(
                            f"getLastPowerData code={result.get('code')}: {result.get('msg')}"
                        )

                    power_data = result.get("data", {}) or {}
                    _LOGGER.debug("Received battery power data: %s", power_data)
                    battery_data.update(power_data)
            
            # Now get the energy statistics
            stats_url = f"{self.base_url}/api/report/energy/getEnergyStatistics"
            
            # Get date range from 2020-01-01 to tomorrow
            # TIMEZONE FIX: Using tomorrow's date as endDate prevents the midnight reset issue
            # where cumulative totals temporarily show yesterday's values for ~30 minutes
            # after midnight in timezones ahead of the API server (e.g., UTC+9:30)
            # This ensures the API always returns complete data for "today"
            now = self._current_time()
            end_date = (now + timedelta(days=1)).strftime("%Y-%m-%d")
            begin_date = "2020-01-01"
            
            _LOGGER.debug("Fetching statistics for date range: %s to %s (tomorrow used for timezone fix, current time: %s)", 
                         begin_date, end_date, now.strftime("%Y-%m-%d %H:%M:%S %Z"))
            
            stats_params = {
                "sysSn": effective_sys_sn,
                "stationId": station_id or "",
                "beginDate": begin_date,
                "endDate": end_date
            }
            
            _LOGGER.debug("Fetching energy statistics from: %s with params: %s", stats_url, stats_params)
            try:
                async with asyncio.timeout(DEFAULT_TIMEOUT):
                    async with self.session.get(
                        url=stats_url, params=stats_params, headers=headers,
                    ) as stats_response:
                        if stats_response.status == 200:
                            stats_result = await _decode_json_object(stats_response, "getEnergyStatistics")
                            if stats_result is None:
                                # Non-object response — skip stats, keep partial data.
                                return battery_data
                            _LOGGER.debug("Energy statistics response: %s", stats_result)

                            if stats_result.get("code") in (0, 200):
                                stats_data = stats_result.get("data", {}) or {}
                                if stats_data:
                                    battery_data["Total_Solar_Generation"]   = stats_data.get("epvT")
                                    battery_data["Total_Feed_In"]            = stats_data.get("eout")
                                    battery_data["Total_Battery_Charge"]     = stats_data.get("echarge")
                                    battery_data["Total_Battery_Discharge"]  = stats_data.get("edischarge")
                                    battery_data["PV_Power_House"]           = stats_data.get("epv2load")
                                    battery_data["PV_Charging_Battery"]      = stats_data.get("epvcharge")
                                    battery_data["Total_House_Consumption"]  = stats_data.get("eload")
                                    battery_data["Grid_Based_Battery_Charge"] = stats_data.get("egridCharge")
                                    battery_data["Grid_Power_Consumption"]   = stats_data.get("einput")
                            elif stats_result.get("code") == 6069:
                                _LOGGER.warning("Session expired (code 6069) during statistics fetch")
                                if _retry_count < MAX_RELOGIN_RETRIES and await self.async_login():
                                    return await self.async_get_battery_data(
                                        station_id, effective_sys_sn, _retry_count + 1
                                    )
                                raise ByteWattAuthError("Session expired during statistics fetch and re-login failed")
                            else:
                                _LOGGER.error(
                                    "Failed to get energy statistics with code %s: %s",
                                    stats_result.get("code"), stats_result.get("msg"),
                                )
                        else:
                            _LOGGER.error(
                                "Failed to get energy statistics with status %s",
                                stats_response.status,
                            )
            except (asyncio.TimeoutError, aiohttp.ClientError, ValueError) as stats_error:
                _LOGGER.error("Error fetching energy statistics: %s", stats_error)
                # Return the power data we already have rather than failing completely.
                return battery_data
            
            # Now get today's stats
            today_url = f"{self.base_url}/api/stable/home/getSumDataForCustomer"
            today_date = now.strftime("%Y-%m-%d")
            
            today_params = {
                "sn": effective_sys_sn,
                "stationId": station_id or "",
                "tday": today_date
            }
            
            _LOGGER.debug("Fetching today's stats from: %s with params: %s", today_url, today_params)
            try:
                async with asyncio.timeout(DEFAULT_TIMEOUT):
                    async with self.session.get(
                        url=today_url, params=today_params, headers=headers,
                    ) as today_response:
                        if today_response.status == 200:
                            today_result = await _decode_json_object(today_response, "getSumDataForCustomer")
                            if today_result is None:
                                return battery_data
                            _LOGGER.debug("Today's stats response: %s", today_result)

                            if _is_success_code(today_result):
                                today_data = today_result.get("data", {}) or {}
                                if today_data:
                                    battery_data["PV_Generated_Today"]    = today_data.get("epvtoday")
                                    battery_data["Total_PV_Generation"]   = today_data.get("epvtotal")
                                    battery_data["Consumed_Today"]        = today_data.get("eload")
                                    battery_data["Feed_In_Today"]         = today_data.get("eoutput")
                                    battery_data["Grid_Import_Today"]     = today_data.get("einput")
                                    battery_data["Battery_Charged_Today"] = today_data.get("echarge")
                                    battery_data["Battery_Discharged_Today"] = today_data.get("edischarge")

                                    self_consumption = today_data.get("eselfConsumption")
                                    if self_consumption is not None:
                                        battery_data["Self_Consumption"] = round(self_consumption * 100, 2)
                                    self_sufficiency = today_data.get("eselfSufficiency")
                                    if self_sufficiency is not None:
                                        battery_data["Self_Sufficiency"] = round(self_sufficiency * 100, 2)

                                    battery_data["Trees_Planted"] = today_data.get("treeNum")
                                    carbon_kg = today_data.get("carbonNum")
                                    if carbon_kg is not None:
                                        battery_data["CO2_Reduction_Tons"] = round(carbon_kg / 1000, 2)
                                    battery_data["Today_Income"] = today_data.get("todayIncome")
                                    battery_data["Total_Income"] = today_data.get("totalIncome")
                            elif today_result.get("code") == 6069:
                                _LOGGER.warning("Session expired (code 6069) during today's stats fetch")
                                if _retry_count < MAX_RELOGIN_RETRIES and await self.async_login():
                                    return await self.async_get_battery_data(
                                        station_id, effective_sys_sn, _retry_count + 1
                                    )
                                raise ByteWattAuthError("Session expired during today's stats fetch and re-login failed")
                            else:
                                _LOGGER.error(
                                    "Failed to get today's stats with code %s: %s",
                                    today_result.get("code"), today_result.get("msg"),
                                )
                        else:
                            _LOGGER.error(
                                "Failed to get today's stats with status %s",
                                today_response.status,
                            )
            except (asyncio.TimeoutError, aiohttp.ClientError, ValueError) as today_error:
                _LOGGER.error("Error fetching today's stats: %s", today_error)
                return battery_data

            # Now get today's statistics
            today_stats_url = f"{self.base_url}/api/report/power/staticsByDay"
            today_stats_date = now.strftime("%Y-%m-%d")
            today_stats_params = {
                "date": today_stats_date,
            }
            if effective_sys_sn.lower() == "all" and self.user_id:
                today_stats_params["userId"] = self.user_id
            else:
                today_stats_params["sysSn"] = effective_sys_sn

            _LOGGER.debug("Fetching today's detailed stats from: %s with params: %s", today_stats_url, today_stats_params)
            try:
                async with asyncio.timeout(DEFAULT_TIMEOUT):
                    async with self.session.get(
                        url=today_stats_url, params=today_stats_params, headers=headers,
                    ) as today_stats_response:
                        if today_stats_response.status == 200:
                            today_stats_result = await _decode_json_object(today_stats_response, "staticsByDay")
                            if today_stats_result is None:
                                return battery_data
                            _LOGGER.debug("Today's detailed stats response: %s", today_stats_result)

                            if _is_success_code(today_stats_result):
                                stats_data = today_stats_result.get("data", {}) or {}
                                # _stat_value coalesces missing / null fields to 0
                                # so the discharge arithmetic never raises TypeError.
                                if stats_data:
                                    pv_today    = _stat_value(stats_data, "epvtoday")
                                    consumed    = _stat_value(stats_data, "ehomeload")
                                    feed_in     = _stat_value(stats_data, "efeedIn")
                                    grid_import = _stat_value(stats_data, "einput")
                                    charged     = _stat_value(stats_data, "echarge")

                                    battery_data["PV_Generated_Today"]    = pv_today
                                    battery_data["Consumed_Today"]        = consumed
                                    battery_data["Feed_In_Today"]         = feed_in
                                    battery_data["Grid_Import_Today"]     = grid_import
                                    battery_data["Battery_Charged_Today"] = charged

                                    if battery_data.get("Battery_Discharged_Today") is None:
                                        # Fallback only when the dedicated API field is absent.
                                        total_gained = pv_today + grid_import
                                        total_used   = consumed + feed_in + charged
                                        battery_data["Battery_Discharged_Today"] = max(
                                            total_used - total_gained, 0
                                        )

                                    battery_data["Power_Diagram"] = {
                                        **_normalized_power_diagram(
                                            stats_data,
                                            report_date=today_stats_date,
                                            battery_data=battery_data,
                                        )
                                    }
                            elif today_stats_result.get("code") == 6069:
                                _LOGGER.warning("Session expired (code 6069) during today's detailed stats fetch")
                                if _retry_count < MAX_RELOGIN_RETRIES and await self.async_login():
                                    return await self.async_get_battery_data(
                                        station_id, effective_sys_sn, _retry_count + 1
                                    )
                                raise ByteWattAuthError(
                                    "Session expired during today's detailed stats fetch and re-login failed"
                                )
                            else:
                                _LOGGER.error(
                                    "Failed to get today's detailed stats with code %s: %s",
                                    today_stats_result.get("code"), today_stats_result.get("msg"),
                                )
                        else:
                            _LOGGER.error(
                                "Failed to get today's detailed stats with status %s",
                                today_stats_response.status,
                            )
            except (asyncio.TimeoutError, aiohttp.ClientError, ValueError) as today_stats_error:
                _LOGGER.error("Error fetching today's detailed stats: %s", today_stats_error)
                return battery_data

            _LOGGER.debug("Combined battery data: %s", battery_data)
            return battery_data

        except ByteWattAPIError:
            # Already wrapped — propagate so the circuit breaker counts it.
            raise
        except (asyncio.TimeoutError, aiohttp.ClientError, ValueError) as error:
            # Wrap transport errors so the caller sees a uniform exception type.
            raise ByteWattAPIError(f"Transport error fetching battery data: {error}") from error

    async def async_get_battery_day_snapshot(
        self,
        report_date: str,
        station_id: str = None,
        sys_sn: Optional[str] = None,
        _retry_count: int = 0,
    ) -> Dict[str, Any]:
        """Fetch one historical daily snapshot for the requested date."""
        if not self.token:
            if not await self.async_login():
                raise ByteWattAuthError("Authentication failed")

        effective_sys_sn = sys_sn or self._aggregate_monitoring_sys_sn()
        current_date = self._current_time().strftime("%Y-%m-%d %H:%M:%S")
        headers = self._get_auth_headers()
        headers.update({
            "Accept": "application/json, text/plain, */*",
            "language": "en-US",
            "operationDate": current_date,
            "platform": "AK9D8H",
            "System": "alphacloud",
        })
        battery_data: Dict[str, Any] = {}

        today_url = f"{self.base_url}/api/stable/home/getSumDataForCustomer"
        today_params = {
            "sn": effective_sys_sn,
            "stationId": station_id or "",
            "tday": report_date,
        }

        try:
            async with asyncio.timeout(DEFAULT_TIMEOUT):
                async with self.session.get(
                    url=today_url, params=today_params, headers=headers,
                ) as today_response:
                    if today_response.status == 401 and _retry_count < MAX_RELOGIN_RETRIES:
                        if await self.async_login():
                            return await self.async_get_battery_day_snapshot(
                                report_date,
                                station_id=station_id,
                                sys_sn=effective_sys_sn,
                                _retry_count=_retry_count + 1,
                            )
                        raise ByteWattAuthError("Session expired during daily summary fetch")

                    if today_response.status == 200:
                        today_result = await _decode_json_object(today_response, "getSumDataForCustomer(day)")
                        if _is_success_code(today_result):
                            today_data = today_result.get("data", {}) or {}
                            battery_data["PV_Generated_Today"] = today_data.get("epvtoday")
                            battery_data["Total_Solar_Generation"] = today_data.get("epvtotal")
                            battery_data["Total_PV_Generation"] = today_data.get("epvtotal")
                            battery_data["Consumed_Today"] = today_data.get("eload")
                            battery_data["Feed_In_Today"] = today_data.get("eoutput")
                            battery_data["Grid_Import_Today"] = today_data.get("einput")
                            battery_data["Battery_Charged_Today"] = today_data.get("echarge")
                            battery_data["Battery_Discharged_Today"] = today_data.get("edischarge")
                            self_consumption = today_data.get("eselfConsumption")
                            if self_consumption is not None:
                                battery_data["Self_Consumption"] = round(self_consumption * 100, 2)
                            self_sufficiency = today_data.get("eselfSufficiency")
                            if self_sufficiency is not None:
                                battery_data["Self_Sufficiency"] = round(self_sufficiency * 100, 2)
                            battery_data["Trees_Planted"] = today_data.get("treeNum")
                            carbon_kg = today_data.get("carbonNum")
                            if carbon_kg is not None:
                                battery_data["CO2_Reduction_Tons"] = round(carbon_kg / 1000, 2)
                            battery_data["Today_Income"] = today_data.get("todayIncome")
                            battery_data["Total_Income"] = today_data.get("totalIncome")
                    else:
                        _LOGGER.debug(
                            "Daily summary unavailable for %s (%s): HTTP %s",
                            effective_sys_sn,
                            report_date,
                            today_response.status,
                        )
        except (asyncio.TimeoutError, aiohttp.ClientError, ValueError) as today_error:
            _LOGGER.error("Error fetching daily summary for %s (%s): %s", effective_sys_sn, report_date, today_error)

        today_stats_url = f"{self.base_url}/api/report/power/staticsByDay"
        today_stats_params = {
            "date": report_date,
        }
        if effective_sys_sn.lower() == "all" and self.user_id:
            today_stats_params["userId"] = self.user_id
        else:
            today_stats_params["sysSn"] = effective_sys_sn

        try:
            async with asyncio.timeout(DEFAULT_TIMEOUT):
                async with self.session.get(
                    url=today_stats_url, params=today_stats_params, headers=headers,
                ) as today_stats_response:
                    if today_stats_response.status == 401 and _retry_count < MAX_RELOGIN_RETRIES:
                        if await self.async_login():
                            return await self.async_get_battery_day_snapshot(
                                report_date,
                                station_id=station_id,
                                sys_sn=effective_sys_sn,
                                _retry_count=_retry_count + 1,
                            )
                        raise ByteWattAuthError("Session expired during daily detail fetch")

                    if today_stats_response.status != 200:
                        _LOGGER.debug(
                            "Daily detail unavailable for %s (%s): HTTP %s",
                            effective_sys_sn,
                            report_date,
                            today_stats_response.status,
                        )
                        return battery_data

                    today_stats_result = await _decode_json_object(today_stats_response, "staticsByDay(history)")
                    if today_stats_result is None:
                        return battery_data

                    if today_stats_result.get("code") == 6069 and _retry_count < MAX_RELOGIN_RETRIES:
                        if await self.async_login():
                            return await self.async_get_battery_day_snapshot(
                                report_date,
                                station_id=station_id,
                                sys_sn=effective_sys_sn,
                                _retry_count=_retry_count + 1,
                            )
                        raise ByteWattAuthError("Session expired during daily detail fetch")

                    if not _is_success_code(today_stats_result):
                        _LOGGER.debug(
                            "Daily detail fetch returned code %s for %s (%s)",
                            today_stats_result.get("code"),
                            effective_sys_sn,
                            report_date,
                        )
                        return battery_data

                    stats_data = today_stats_result.get("data", {}) or {}
                    if not stats_data:
                        return battery_data

                    pv_today = _stat_value(stats_data, "epvtoday")
                    consumed = _stat_value(stats_data, "ehomeload") or _stat_value(stats_data, "eload")
                    feed_in = _stat_value(stats_data, "efeedIn") or _stat_value(stats_data, "eout")
                    grid_import = _stat_value(stats_data, "einput")
                    charged = _stat_value(stats_data, "echarge")
                    discharged = _stat_value(stats_data, "edischarge")

                    battery_data["PV_Generated_Today"] = pv_today or _stat_value(stats_data, "epvT")
                    battery_data["Consumed_Today"] = consumed
                    battery_data["Feed_In_Today"] = feed_in
                    battery_data["Grid_Import_Today"] = grid_import
                    battery_data["Battery_Charged_Today"] = charged or _stat_value(stats_data, "epvcharge")

                    if battery_data.get("Battery_Discharged_Today") is None:
                        battery_data["Battery_Discharged_Today"] = discharged
                    if battery_data.get("Battery_Discharged_Today") in (None, ""):
                        total_gained = pv_today + grid_import
                        total_used = consumed + feed_in + charged
                        battery_data["Battery_Discharged_Today"] = max(total_used - total_gained, 0)

                    battery_data["soc"] = stats_data.get("soc")
                    battery_data["powerSource"] = stats_data.get("powerSource")
                    battery_data["Power_Diagram"] = _normalized_power_diagram(
                        stats_data,
                        report_date=report_date,
                        battery_data=battery_data,
                    )
                    return battery_data
        except (asyncio.TimeoutError, aiohttp.ClientError, ValueError) as today_stats_error:
            _LOGGER.error("Error fetching daily detail for %s (%s): %s", effective_sys_sn, report_date, today_stats_error)
            return battery_data

        return battery_data
    
    def _get_auth_headers(self) -> Dict[str, str]:
        """Get the authentication headers."""
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.token}"
        }
    
    async def _async_get(self, endpoint: str) -> Optional[Dict[str, Any]]:
        """GET ``endpoint`` and return the decoded JSON object, or None.

        Returns None on any failure (timeout, ClientError, non-200 status,
        non-JSON body, or JSON that isn't an object). Callers can safely
        do ``response.get(...)`` without further type checks.
        """
        url = f"{self.base_url}/{endpoint}"
        headers = self._get_auth_headers()
        try:
            async with self.session.get(
                url, headers=headers,
                timeout=aiohttp.ClientTimeout(total=DEFAULT_TIMEOUT),
            ) as response:
                if response.status != 200:
                    _LOGGER.debug("GET %s failed with status %s", url, response.status)
                    return None
                return await _decode_json_object(response, f"GET {endpoint}")
        except (asyncio.TimeoutError, aiohttp.ClientError) as error:
            _LOGGER.debug("Error making GET request to %s: %s", url, error)
            return None

    async def _async_post(self, endpoint: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """POST ``data`` to ``endpoint`` and return the decoded JSON object, or None."""
        url = f"{self.base_url}/{endpoint}"
        headers = self._get_auth_headers()
        headers.update({
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "language": "en-US",
            "platform": "AK9D8H",
            "System": "alphacloud",
        })
        try:
            async with self.session.post(
                url, headers=headers, json=data,
                timeout=aiohttp.ClientTimeout(total=DEFAULT_TIMEOUT),
            ) as response:
                if response.status != 200:
                    response_text = await response.text()
                    _LOGGER.debug(
                        "POST %s failed (status %s): %s",
                        url, response.status, response_text,
                    )
                    return None
                return await _decode_json_object(response, f"POST {endpoint}")
        except (asyncio.TimeoutError, aiohttp.ClientError) as error:
            _LOGGER.debug("Error making POST request to %s: %s", url, error)
            return None

    async def _async_put(self, endpoint: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """PUT ``data`` to ``endpoint`` and return the decoded JSON object, or None."""
        url = f"{self.base_url}/{endpoint}"
        headers = self._get_auth_headers()
        headers.update({
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "language": "en-US",
            "platform": "AK9D8H",
            "System": "alphacloud",
        })
        try:
            async with self.session.put(
                url, headers=headers, json=data,
                timeout=aiohttp.ClientTimeout(total=DEFAULT_TIMEOUT),
            ) as response:
                if response.status != 200:
                    response_text = await response.text()
                    _LOGGER.debug(
                        "PUT %s failed (status %s): %s",
                        url, response.status, response_text,
                    )
                    return None
                return await _decode_json_object(response, f"PUT {endpoint}")
        except (asyncio.TimeoutError, aiohttp.ClientError) as error:
            _LOGGER.debug("Error making PUT request to %s: %s", url, error)
            return None

    async def fetch_inverter_list(self) -> list:
        """Return the list of inverters on this account.

        Used by the config flow / migration to populate the Host inverter
        selection. Re-logs in once on session expiry (code 6069).
        """
        endpoint = "api/stable/home/getCustomMenuEssList?inverterMode=0"
        async def _do():
            return await self._async_get(endpoint)
        response = await _do()
        if response and response.get("code") == 6069:
            if await self.async_login():
                response = await _do()
        if response and response.get("code") == 200:
            return response.get("data") or []
        _LOGGER.warning("Could not fetch inverter list: %s", response)
        return []
