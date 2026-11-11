import './isolated.js';
import GLib from 'gi://GLib';
import GWeather from 'gi://GWeather?version=4.0';
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
assert(info.get_forecast_list().length === 2, 'Hourly forecast conversion');
assert(info.get_forecast_list()[0] instanceof GWeather.Info, 'Typed forecast sample');
info.abort();
print('Provider: coordinates, incomplete responses, WMO icons, typed native model, units, hourly samples passed.');
