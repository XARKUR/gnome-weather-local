// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import GWeather from 'gi://GWeather?version=4.0';
import Soup from 'gi://Soup?version=3.0';

const session = new Soup.Session({timeout: 20, user_agent: 'SystemWeather/0.1 (GNOME Weather local fork)'});
const FRESH = 15 * 60 * 1000, MAX_STALE = 24 * 60 * 60 * 1000;
const unitSettings = new Gio.Settings({schema_id: 'org.gnome.GWeather4'});
function temperatureUnit(unit) {
    // to_real(DEFAULT) resolves the locale, not the user's saved preference.
    if (unit === GWeather.TemperatureUnit.DEFAULT)
        unit = unitSettings.get_enum('temperature-unit');
    return GWeather.TemperatureUnit.to_real(unit);
}
export function coordinates(latitude, longitude) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 || Math.abs(longitude) > 180)
        throw new Error('经纬度无效：纬度 -90～90，经度 -180～180');
    return [latitude, longitude];
}
function url(base, parameters) {
    return base + '?' + Object.entries(parameters).map(([k, v]) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}
export function requestJSON(address, cancellable = null) {
    return new Promise((resolve, reject) => {
        const message = Soup.Message.new('GET', address);
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
            try {
                const bytes = source.send_and_read_finish(result);
                const status = message.get_status();
                if (status < 200 || status >= 300) throw new Error(`天气服务返回 HTTP ${status}`);
                const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                if (data.error) throw new Error(data.reason || '天气服务请求失败');
                resolve(data);
            } catch (error) {reject(error);}
        });
    });
}
export function manualLocation(text) {
    // Search entry also accepts “名称;纬度,经度” or “纬度,经度”.
    const match = text.trim().match(/^(?:(.+?)[;；])?\s*(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!match) return null;
    const [lat, lon] = coordinates(Number(match[2]), Number(match[3]));
    return {name: match[1]?.trim() || `${lat}, ${lon}`, latitude: lat, longitude: lon};
}
export async function searchLocations(text, cancellable = null) {
    const manual = manualLocation(text);
    if (manual) return [manual];
    if (text.trim().length < 2) return [];
    const data = await requestJSON(url('https://geocoding-api.open-meteo.com/v1/search',
        {name: text.trim(), language: 'zh', count: 30}), cancellable);
    return (data.results || []).filter(item => Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
        .map(item => ({...item, displayName: [...new Set([item.name, item.admin2, item.admin1, item.country].filter(Boolean))].join(' · ')}));
}
export function describe(code, isDay = true) {
    if (code === 0) return ['晴', isDay ? 'weather-clear' : 'weather-clear-night'];
    if (code === 1 || code === 2) return ['多云', isDay ? 'weather-few-clouds' : 'weather-few-clouds-night'];
    if (code === 3) return ['阴', 'weather-overcast'];
    if (code === 45 || code === 48) return ['雾', 'weather-fog'];
    if ([71, 73, 75, 77, 85, 86].includes(code)) return ['雪', 'weather-snow'];
    if ([95, 96, 99].includes(code)) return ['雷雨', 'weather-storm'];
    if ([56, 57, 66, 67].includes(code)) return ['冻雨', 'weather-freezing-rain'];
    if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return ['雨', 'weather-showers'];
    return ['未知天气', 'weather-severe-alert'];
}
export function validateForecast(data) {
    if (!Number.isFinite(data.current?.time) || !Number.isFinite(data.current?.temperature_2m) ||
        !Number.isFinite(data.current?.weather_code) || !Array.isArray(data.hourly?.time) ||
        data.hourly.time.length === 0 || !data.hourly.time.every(Number.isFinite))
        throw new Error('天气服务返回了不完整的数据');
    for (const field of ['temperature_2m', 'apparent_temperature', 'weather_code', 'is_day',
        'relative_humidity_2m', 'wind_speed_10m', 'wind_direction_10m']) {
        if (!Array.isArray(data.hourly[field]) || data.hourly[field].length !== data.hourly.time.length)
            throw new Error(`逐小时数据不完整：${field}`);
    }
    return data;
}
function cachePath(location) {
    const [lat, lon] = location.get_coords();
    return GLib.build_filenamev([GLib.get_user_cache_dir(), 'system-weather', `${lat.toFixed(5)}_${lon.toFixed(5)}.json`]);
}
export const OpenMeteoInfo = GObject.registerClass({GTypeName: 'SystemOpenMeteoInfo'},
class OpenMeteoInfo extends GWeather.Info {
    _init(params = {}, sample = null) {
        super._init({...params, enabled_providers: GWeather.Provider.NONE});
        this._sample = sample;
        this._data = null;
        this._forecasts = [];
        this._fetchedAt = 0;
        this._lastAttempt = 0;
        this._generation = 0;
        this._pending = null;
        this.lastError = null;
        if (!sample && this.location) {
            try {
                const [ok, bytes] = GLib.file_get_contents(cachePath(this.location));
                const saved = ok && JSON.parse(new TextDecoder().decode(bytes));
                if (saved && Number.isFinite(saved.fetchedAt) && Date.now() - saved.fetchedAt >= 0 &&
                    Date.now() - saved.fetchedAt < MAX_STALE) {
                    this._apply(validateForecast(saved.data));
                    this._fetchedAt = saved.fetchedAt;
                }
            } catch (_) { /* Missing or invalid cache: fetch normally. */ }
        }
    }
    _apply(data) {
        this._data = data;
        this._sample = data.current;
        this._fetchedAt = Date.now();
        this._forecasts = data.hourly.time.map((time, i) => {
            const sample = {time};
            for (const [key, values] of Object.entries(data.hourly)) sample[key] = values[i];
            return new OpenMeteoInfo({location: this.location,
                application_id: 'org.gnome.Weather.Local', contact_info: 'https://open-meteo.com/'}, sample);
        }).filter(info => info.is_valid());
    }
    update() {
        if (this._pending) return;
        if (Date.now() - this._fetchedAt < FRESH || Date.now() - this._lastAttempt < 60000) {
            this.emit('updated');
            return;
        }
        this._lastAttempt = Date.now();
        const generation = ++this._generation;
        const cancellable = new Gio.Cancellable();
        this._pending = cancellable;
        const [latitude, longitude] = coordinates(...this.location.get_coords());
        const fields = 'temperature_2m,apparent_temperature,weather_code,is_day,relative_humidity_2m,wind_speed_10m,wind_direction_10m';
        requestJSON(url('https://api.open-meteo.com/v1/forecast', {latitude, longitude,
            current: fields, hourly: fields, forecast_days: 7, timeformat: 'unixtime', timezone: 'auto'}), cancellable)
            .then(data => {
                if (generation !== this._generation) return;
                this._apply(validateForecast(data));
                this._fetchedAt = Date.now();
                this.lastError = null;
                try {
                    const path = cachePath(this.location);
                    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o700);
                    GLib.file_set_contents(path, JSON.stringify({fetchedAt: this._fetchedAt, data}));
                } catch (_) { /* Cache write failure must not discard valid weather. */ }
            }).catch(error => {
                if (generation === this._generation) this.lastError = error.message;
            }).finally(() => {
                if (generation !== this._generation) return;
                this._pending = null;
                this.emit('updated');
            });
    }
    abort() {
        this._generation++;
        this._pending?.cancel();
        this._pending = null;
    }
    is_valid() {return (!this._data || Date.now() - this._fetchedAt < MAX_STALE) &&
        Number.isFinite(this._sample?.temperature_2m) && Number.isFinite(this._sample?.weather_code);}
    network_error() {return Boolean(this.lastError);}
    get_forecast_list() {return this._forecasts;}
    get_value_update() {return [this.is_valid(), this._sample?.time || 0];}
    get_value_temp(unit) {
        let value = this._sample?.temperature_2m;
        const real = temperatureUnit(unit);
        if (real === GWeather.TemperatureUnit.FAHRENHEIT) value = value * 9 / 5 + 32;
        else if (real === GWeather.TemperatureUnit.KELVIN) value += 273.15;
        return [Number.isFinite(value), value ?? NaN];
    }
    get_value_apparent(unit) {
        const value = this._sample?.apparent_temperature;
        const real = temperatureUnit(unit);
        return [Number.isFinite(value), real === GWeather.TemperatureUnit.FAHRENHEIT ? value * 9 / 5 + 32 :
            real === GWeather.TemperatureUnit.KELVIN ? value + 273.15 : value];
    }
    get_value_temp_min() {return [false, NaN];}
    get_value_temp_max() {return [false, NaN];}
    get_conditions() {return describe(this._sample?.weather_code, Boolean(this._sample?.is_day))[0];}
    get_sky() {return this.get_conditions();}
    get_icon_name() {return describe(this._sample?.weather_code, Boolean(this._sample?.is_day))[1];}
    get_symbolic_icon_name() {return this.get_icon_name() + '-symbolic';}
    get_temp_summary() {return `${Math.round(this.get_value_temp(GWeather.TemperatureUnit.DEFAULT)[1])}°`;}
    get_humidity() {return Number.isFinite(this._sample?.relative_humidity_2m) ? `${Math.round(this._sample.relative_humidity_2m)}%` : '—';}
    get_value_wind(unit) {
        let speed = this._sample?.wind_speed_10m;
        // Unlike TemperatureUnit, SpeedUnit has no introspected to_real().
        // For DEFAULT the native widget falls back to our explicitly labelled string.
        switch (unit) {
        case GWeather.SpeedUnit.DEFAULT: return [false, 0, GWeather.WindDirection.INVALID];
        case GWeather.SpeedUnit.MS: speed /= 3.6; break;
        case GWeather.SpeedUnit.MPH: speed /= 1.609344; break;
        case GWeather.SpeedUnit.KNOTS: speed /= 1.852; break;
        case GWeather.SpeedUnit.BFT: return [false, 0, GWeather.WindDirection.INVALID];
        }
        return [Number.isFinite(speed), speed ?? NaN, GWeather.WindDirection.INVALID];
    }
    get_wind() {return Number.isFinite(this._sample?.wind_speed_10m) ? `${this._sample.wind_speed_10m} km/h` : '—';}
    get_attribution() {
        return '<a href="https://open-meteo.com/">天气数据：Open-Meteo</a> · ' +
            '<a href="https://www.geonames.org/">地点：GeoNames</a>' +
            (this.lastError ? ' · 更新失败，显示缓存：' + GLib.markup_escape_text(this.lastError, -1) : '');
    }
});
