import './isolated.js';
import GLib from 'gi://GLib';
import GWeather from 'gi://GWeather?version=4.0';
import Gio from 'gi://Gio';
import {coordinates, manualLocation, validateForecast, describe, OpenMeteoInfo} from '../overrides/provider.js';
function assert(value, message) {if (!value) throw new Error(message);}
function throws(fn) {let threw = false; try {fn();} catch (_) {threw = true;} assert(threw, 'Expected rejection');}
assert(manualLocation('高州;21.91965,110.85678').name === '高州', 'Named coordinates');
assert(manualLocation('21.91965, 110.85678').latitude === 21.91965, 'Plain coordinates');
assert(manualLocation('高州') === null, 'Name treated as coordinates');
throws(() => coordinates(NaN, 20));
throws(() => manualLocation('91,180'));
throws(() => manualLocation('0,181'));
throws(() => validateForecast({current: {time: 1, temperature_2m: 5, weather_code: 0}, hourly: {time: [1]}}));
assert(describe(0, false)[1] === 'weather-clear-night', 'Night icon');
assert(describe(96)[1] === 'weather-storm', 'Thunderstorm icon');
assert(describe(999)[0] === '未知天气', 'Unknown weather incorrectly presented as clear');
const sample = {time: 1794412800, temperature_2m: 20, apparent_temperature: 18, weather_code: 0,
    is_day: 0, relative_humidity_2m: 80, wind_speed_10m: 36, wind_direction_10m: 90};
const data = {current: sample, hourly: Object.fromEntries(Object.entries(sample).map(([key, value]) => [key, [value, value]]))};
data.hourly.time[1] += 3600;
validateForecast(data);
const location = GWeather.Location.new_detached('高州', null, 21.91965, 110.85678);
const info = new OpenMeteoInfo({location, application_id: 'org.gnome.Weather.Local', contact_info: 'https://open-meteo.com/'}, sample);
assert(info instanceof GWeather.Info, 'Adapter must satisfy native typed forecast models');
assert(info.is_valid(), 'Current conditions');
assert(info.get_value_temp(GWeather.TemperatureUnit.FAHRENHEIT)[1] === 68, 'Temperature units');
assert(info.get_value_wind(GWeather.SpeedUnit.MS)[1] === 10, 'Wind units');
assert(info.get_symbolic_icon_name() === 'weather-clear-night-symbolic', 'Native card icon');
info._apply(data);
const units = new Gio.Settings({schema_id: 'org.gnome.GWeather4'});
units.set_string('temperature-unit', 'fahrenheit');
assert(info.get_value_temp(GWeather.TemperatureUnit.DEFAULT)[1] === 68, 'Default ignores saved Fahrenheit preference');
assert(Math.abs(info.get_value_apparent(GWeather.TemperatureUnit.DEFAULT)[1] - 64.4) < 0.001, 'Apparent temperature unit');
assert(info.get_forecast_list()[0].get_value_temp(GWeather.TemperatureUnit.DEFAULT)[1] === 68, 'Hourly units');
units.set_string('temperature-unit', 'centigrade');
assert(info.get_value_temp(GWeather.TemperatureUnit.DEFAULT)[1] === 20, 'Switch back to Celsius');
assert(info.get_forecast_list().length === 2, 'Hourly forecast conversion');
assert(info.get_forecast_list()[0] instanceof GWeather.Info, 'Typed forecast sample');
// JSON null must not become a valid 32°F / 0 m/s through numeric coercion.
const missing = new OpenMeteoInfo({location}, {...sample, temperature_2m: null,
    apparent_temperature: null, wind_speed_10m: null});
for (const unit of [GWeather.TemperatureUnit.CENTIGRADE, GWeather.TemperatureUnit.FAHRENHEIT,
    GWeather.TemperatureUnit.KELVIN]) {
    assert(!missing.get_value_temp(unit)[0] && Number.isNaN(missing.get_value_temp(unit)[1]), 'Missing temperature became valid');
    assert(!missing.get_value_apparent(unit)[0] && Number.isNaN(missing.get_value_apparent(unit)[1]), 'Missing apparent temperature became valid');
}
assert(!missing.get_value_wind(GWeather.SpeedUnit.MS)[0], 'Missing wind became valid calm weather');
const optionalMissing = new OpenMeteoInfo({location}, {...sample, apparent_temperature: null, wind_speed_10m: null});
assert(optionalMissing.is_valid(), 'Missing optional fields invalidated the actual temperature');
assert(!optionalMissing.get_value_apparent(GWeather.TemperatureUnit.FAHRENHEIT)[0] &&
    Number.isNaN(optionalMissing.get_value_apparent(GWeather.TemperatureUnit.FAHRENHEIT)[1]), 'Missing apparent value was converted');
assert(!optionalMissing.get_value_wind(GWeather.SpeedUnit.MS)[0], 'Missing optional wind was converted');
const noHourly = JSON.parse(JSON.stringify(data));
noHourly.hourly.temperature_2m.fill(null);
throws(() => validateForecast(noHourly));
const partial = JSON.parse(JSON.stringify(data));
partial.hourly.temperature_2m[0] = null;
info._apply(validateForecast(partial));
assert(info.get_forecast_list().length === 1, 'Missing hourly temperature must be skipped');
info._fetchedAt = Date.now() - 25 * 60 * 60 * 1000;
assert(!info.is_valid(), 'Expired cached weather remains valid');
assert(!info.get_value_temp(GWeather.TemperatureUnit.FAHRENHEIT)[0], 'Expired temperature getter remains valid');
assert(info.get_forecast_list().length === 0, 'Expired parent still exposes hourly forecasts');
info.abort();
print('Provider: coordinates, incomplete responses, WMO icons, native models, units, missing values and cache expiry passed.');
