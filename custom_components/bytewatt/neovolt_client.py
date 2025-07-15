"""API client for Neovolt battery systems."""
import logging
import asyncio
import aiohttp
from typing import Dict, Any, Optional
from datetime import datetime, timedelta

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.util import dt as dt_util

from .neovolt_auth import encrypt_password

_LOGGER = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 30
DEFAULT_BASE_URL = "https://monitor.byte-watt.com"

class NeovoltClient:
    """API Client for Neovolt battery systems."""

    def __init__(
        self,
        hass: HomeAssistant,
        username: str,
        password: str,
        base_url: str = DEFAULT_BASE_URL,
    ) -> None:
        """Initialize the API client."""
        self.hass = hass
        self.username = username
        self.password = password
        self.base_url = base_url
        self.session = async_get_clientsession(hass)
        self.token: Optional[str] = None
        self._settings_cache = None

    async def async_login(self) -> bool:
        """Login to the Neovolt API using encrypted password."""
        _LOGGER.debug("Logging in to Neovolt API as %s", self.username)

        login_url = f"{self.base_url}/api/usercenter/cloud/user/login"

        # Encrypt password using the correct method
        encrypted_password = encrypt_password(self.password, self.username)

        # JSON payload with encrypted password
        payload = {
            "username": self.username,
            "password": encrypted_password
        }

        try:
            async with asyncio.timeout(DEFAULT_TIMEOUT):
                response = await self.session.post(
                    url=login_url,
                    json=payload,
                    headers={"Content-Type": "application/json"}
                )

                _LOGGER.debug(f"Login response status: {response.status}")
                raw_text = await response.text()
                _LOGGER.debug(f"Login raw response: {raw_text}")

                if response.status != 200:
                    _LOGGER.error(
                        "Login failed with status %s: %s",
                        response.status,
                        raw_text
                    )
                    return await self._async_login_fallback()

                result = await response.json()

                if result.get("code") != 0 and result.get("code") != 200:
                    _LOGGER.error(
                        "Login failed with code %s: %s",
                        result.get("code"),
                        result.get("msg")
                    )
                    return await self._async_login_fallback()

                # Extract token - handle different response formats
                if "token" in result:
                    self.token = result["token"]
                elif "data" in result and result["data"] and "token" in result["data"]:
                    self.token = result["data"]["token"]
                else:
                    _LOGGER.error("No token found in login response")
                    return False

                _LOGGER.debug("Successfully logged in to Neovolt API")
                return True

        except (asyncio.TimeoutError, aiohttp.ClientError) as error:
            _LOGGER.error("Error connecting to Neovolt API: %s", error)
            return await self._async_login_fallback()

    async def _async_login_fallback(self) -> bool:
        """Fallback login method using form data with unencrypted password."""
        _LOGGER.debug("Trying fallback login with unencrypted password")

        login_url = f"{self.base_url}/api/usercenter/cloud/user/login"

        # Form data with original password
        form_data = {
            "username": self.username,
            "password": self.password
        }

        try:
            async with asyncio.timeout(DEFAULT_TIMEOUT):
                response = await self.session.post(
                    url=login_url,
                    data=form_data
                )

                _LOGGER.debug(f"Fallback login response status: {response.status}")
                raw_text = await response.text()
                _LOGGER.debug(f"Fallback login raw response: {raw_text}")

                if response.status != 200:
                    _LOGGER.error(
                        "Fallback login failed with status %s: %s",
                        response.status,
                        raw_text
                    )
                    return False

                result = await response.json()

                if result.get("code") != 0 and result.get("code") != 200:
                    _LOGGER.error(
                        "Fallback login failed with code %s: %s",
                        result.get("code"),
                        result.get("msg")
                    )
                    return False

                # Extract token - handle different response formats
                if "token" in result:
                    self.token = result["token"]
                elif "data" in result and result["data"] and "token" in result["data"]:
                    self.token = result["data"]["token"]
                else:
                    _LOGGER.error("No token found in fallback login response")
                    return False

                _LOGGER.debug("Successfully logged in with fallback method")
                return True

        except (asyncio.TimeoutError, aiohttp.ClientError) as error:
            _LOGGER.error("Error connecting to Neovolt API with fallback method: %s", error)
            return False

    async def async_get_device_list(self) -> Optional[Dict[str, Any]]:
        """Get the list of devices."""
        if not self.token:
            if not await self.async_login():
                return None

        url = f"{self.base_url}/api/devices/list"

        try:
            async with asyncio.timeout(DEFAULT_TIMEOUT):
                response = await self.session.get(
                    url=url,
                    headers=self._get_auth_headers()
                )

                _LOGGER.debug(f"Device list response status: {response.status}")
                raw_text = await response.text()
                _LOGGER.debug(f"Device list raw response: {raw_text}")

                if response.status != 200:
                    _LOGGER.error(
                        "Failed to get device list with status %s: %s",
                        response.status,
                        raw_text
                    )

                    # Try refreshing token and retrying the request
                    if response.status == 401:
                        if await self.async_login():
                            return await self.async_get_device_list()

                    return None

                result = await response.json()

                if result.get("code") != 0 and result.get("code") != 200:
                    _LOGGER.error(
                        "Failed to get device list with code %s: %s",
                        result.get("code"),
                        result.get("msg")
                    )
                    return None

                return result.get("data")

        except (asyncio.TimeoutError, aiohttp.ClientError) as error:
            _LOGGER.error("Error fetching device list: %s", error)
            return None

    async def async_get_battery_data(self, station_id: str = None) -> Optional[Dict[str, Any]]:
        """Get data for a specific battery using the new API endpoint."""
        if not self.token:
            if not await self.async_login():
                return None

        url = f"{self.base_url}/api/report/energyStorage/getLastPowerData"

        params = {
            "sysSn": "All",
            "stationId": station_id or ""
        }

        current_date = dt_util.now().strftime("%Y-%m-%d %H:%M:%S")

        headers = self._get_auth_headers()
        headers.update({
            "Accept": "application/json, text/plain, */*",
            "language": "en-US",
            "operationDate": current_date,
            "platform": "AK9D8H",
            "System": "alphacloud"
        })

        try:
            battery_data = {}

            async with asyncio.timeout(DEFAULT_TIMEOUT):
                response = await self.session.get(
                    url=url,
                    params=params,
                    headers=headers
                )

                _LOGGER.debug(f"Battery data response status: {response.status}")
                raw_text = await response.text()
                _LOGGER.debug(f"Battery data raw response: {raw_text}")

                if response.status != 200:
                    _LOGGER.error(
                        "Failed to get battery power data with status %s: %s",
                        response.status,
                        raw_text
                    )

                    if response.status == 401:
                        if await self.async_login():
                            return await self.async_get_battery_data(station_id)

                    return None

                result = await response.json()

                _LOGGER.debug(f"Parsed battery data JSON: {result}")

                if result.get("code") != 0 and result.get("code") != 200:
                    _LOGGER.error(
                        "Failed to get battery power data with code %s: %s",
                        result.get("code"),
                        result.get("msg")
                    )
                    return None

                power_data = result.get("data", {})
                _LOGGER.debug("Received battery power data keys: %s", list(power_data.keys()) if power_data else None)
                battery_data.update(power_data)

            stats_url = f"{self.base_url}/api/report/energy/getEnergyStatistics"

            now = dt_util.now()
            end_date = now.strftime("%Y-%m-%d")
            begin_date = "2020-01-01"

            _LOGGER.debug("Fetching statistics for date range: %s to %s (current time: %s)",
                         begin_date, end_date, now.strftime("%Y-%m-%d %H:%M:%S %Z"))

            stats_params = {
                "sysSn": "All",
                "stationId": station_id or "",
                "beginDate": begin_date,
                "endDate": end_date
            }

            _LOGGER.info("Fetching energy statistics from: %s with params: %s", stats_url, stats_params)
            async with asyncio.timeout(DEFAULT_TIMEOUT):
                try:
                    stats_response = await self.session.get(
                        url=stats_url,
                        params=stats_params,
                        headers=headers
                    )
                except (asyncio.TimeoutError, aiohttp.ClientError) as stats_error:
                    _LOGGER.error("Error fetching energy statistics: %s", stats_error)
                    _LOGGER.debug("Returning only power data due to statistics fetch error")
                    return battery_data

                _LOGGER.debug(f"Energy statistics response status: {stats_response.status}")
                stats_raw_text = await stats_response.text()
                _LOGGER.debug(f"Energy statistics raw response: {stats_raw_text}")

                if stats_response.status == 200:
                    stats_result = await stats_response.json()
                    _LOGGER.info("Energy statistics response JSON: %s", stats_result)

                    if stats_result.get("code") == 200 or stats_result.get("code") == 0:
                        stats_data = stats_result.get("data", {})
                        _LOGGER.info("Energy statistics data fields: %s", list(stats_data.keys()) if stats_data else "No data")

                        if stats_data:
                            battery_data["Total_Solar_Generation"] = stats_data.get("epvT")
                            battery_data["Total_Feed_In"] = stats_data.get("eout")
                            battery_data["Total_Battery_Charge"] = stats_data.get("echarge")
                            battery_data["PV_Power_House"] = stats_data.get("epv2load")
                            battery_data["PV_Charging_Battery"] = stats_data.get("epvcharge")
                            battery_data["Total_House_Consumption"] = stats_data.get("eload")
                            battery_data["Grid_Based_Battery_Charge"] = stats_data.get("egridCharge")
                            battery_data["Grid_Power_Consumption"] = stats_data.get("einput")
                    else:
                        _LOGGER.error(
                            "Failed to get energy statistics with code %s: %s",
                            stats_result.get("code"),
                            stats_result.get("msg")
                        )
                else:
                    _LOGGER.error(
                        "Failed to get energy statistics with status %s",
                        stats_response.status
                    )

            today_url = f"{self.base_url}/api/stable/home/getSumDataForCustomer"
            today_date = now.strftime("%Y-%m-%d")

            today_params = {
                "sn": "All",
                "stationId": station_id or "",
                "tday": today_date
            }

            _LOGGER.info("Fetching today's stats from: %s with params: %s", today_url, today_params)

            async with asyncio.timeout(DEFAULT_TIMEOUT):
                try:
                    today_response = await self.session.get(
                        url=today_url,
                        params=today_params,
                        headers=headers
                    )
                except (asyncio.TimeoutError, aiohttp.ClientError) as today_error:
                    _LOGGER.error("Error fetching today's stats: %s", today_error)
                    return battery_data

                _LOGGER.debug(f"Today's stats response status: {today_response.status}")
                today_raw_text = await today_response.text()
                _LOGGER.debug(f"Today's stats raw response: {today_raw_text}")

                if today_response.status == 200:
                    today_result = await today_response.json()
                    _LOGGER.info("Today's stats response JSON: %s", today_result)

                    if today_result.get("code") == 200:
                        today_data = today_result.get("data", {})
                        _LOGGER.info("Today's stats data fields: %s", list(today_data.keys()) if today_data else "No data")

                        if today_data:
                            battery_data["PV_Generated_Today"] = today_data.get("epvtoday")
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
                        _LOGGER.error(
                            "Failed to get today's stats with code %s: %s",
                            today_result.get("code"),
                            today_result.get("msg")
                        )
                else:
                    _LOGGER.error(
                        "Failed to get today's stats with status %s",
                        today_response.status
                    )

            _LOGGER.debug("Combined battery data: %s", battery_data)
            return battery_data

        except (asyncio.TimeoutError, aiohttp.ClientError) as error:
            _LOGGER.error("Error fetching battery data: %s", error)
            return None

    def _get_auth_headers(self) -> Dict[str, str]:
        """Get the authentication headers."""
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.token}"
        }

    async def async_get_battery_settings(self):
        """Get current battery settings and cache them."""
        try:
            from .settings import BatterySettingsAPI

            settings_api = BatterySettingsAPI(self)
            settings = await settings_api.fetch_current_settings()

            if settings:
                self._settings_cache = settings
                _LOGGER.debug("Cached battery settings: %s", settings)

            return settings

        except Exception as error:
            _LOGGER.error("Error fetching battery settings: %s", error)
            return None

    async def async_update_battery_settings(self,
                                            discharge_start_time: str = None,
                                            discharge_end_time: str = None,
                                            charge_start_time: str = None,
                                            charge_end_time: str = None,
                                            minimum_soc: int = None,
                                            charge_cap: int = None) -> bool:
        """Update battery settings."""
        try:
            from .settings import BatterySettingsAPI

            settings_api = BatterySettingsAPI(self)

            result = await settings_api.update_battery_settings(
                discharge_start_time,
                discharge_end_time,
                charge_start_time,
                charge_end_time,
                minimum_soc,
                charge_cap
            )

            if result:
                await self.async_get_battery_settings()

            return result

        except Exception as error:
            _LOGGER.error("Error updating battery settings: %s", error)
            return False

    async def _async_get(self, endpoint: str) -> Optional[Dict[str, Any]]:
        """Make an async GET request."""
        url = f"{self.base_url}/{endpoint}"
        headers = self._get_auth_headers()

        try:
            async with self.session.get(url, headers=headers, timeout=DEFAULT_TIMEOUT) as response:
                if response.status == 200:
                    return await response.json()
                else:
                    _LOGGER.error("GET request failed with status %s", response.status)
                    return None
        except Exception as error:
            _LOGGER.error("Error making GET request: %s", error)
            return None

    async def _async_post(self, endpoint: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Make an async POST request."""
        url = f"{self.base_url}/{endpoint}"
        headers = self._get_auth_headers()
        headers.update({
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "language": "en-US",
            "platform": "AK9D8H",
            "System": "alphacloud"
        })

        try:
            async with self.session.post(url, headers=headers, json=data, timeout=DEFAULT_TIMEOUT) as response:
                if response.status == 200:
                    return await response.json()
                else:
                    _LOGGER.error("POST request failed with status %s for URL %s", response.status, url)
                    _LOGGER.error("Request headers: %s", headers)
                    _LOGGER.error("Request data: %s", data)
                    response_text = await response.text()
                    _LOGGER.error("Response text: %s", response_text)
                    return None
        except Exception as error:
            _LOGGER.error("Error making POST request: %s", error)
            return None

    async def _async_put(self, endpoint: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Make an async PUT request."""
        url = f"{self.base_url}/{endpoint}"
        headers = self._get_auth_headers()
        headers.update({
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "language": "en-US",
            "platform": "AK9D8H",
            "System": "alphacloud"
        })

        try:
            async with self.session.put(url, headers=headers, json=data, timeout=DEFAULT_TIMEOUT) as response:
                if response.status == 200:
                    return await response.json()
                else:
                    _LOGGER.error("PUT request failed with status %s for URL %s", response.status, url)
                    _LOGGER.error("Request headers: %s", headers)
                    _LOGGER.error("Request data: %s", data)
                    response_text = await response.text()
                    _LOGGER.error("Response text: %s", response_text)
                    return None
        except Exception as error:
            _LOGGER.error("Error making PUT request: %s", error)
            return None
