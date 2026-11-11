import './isolated.js';
import '../build/bootstrap.js';
import Gtk from 'gi://Gtk?version=4.0';
import {WeatherApplication} from '../build/source/src/app/application.js';
import {MainWindow} from '../build/source/src/app/window.js';
import {WorldModel} from '../build/source/src/shared/world.js';
import GWeather from 'gi://GWeather?version=4.0';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import * as Util from '../build/source/src/misc/util.js';
import {provinceLabel, rememberProvince, getProvince} from '../build/source/src/shared/regions.js';
Gtk.init();
pkg.initFormat();
pkg.initGettext();
globalThis.ngettext = imports.gettext.ngettext;
globalThis.getApp = () => Gio.Application.get_default();
let failure = null;
const SmokeApplication = GObject.registerClass(class SmokeApplication extends WeatherApplication {
    vfunc_activate() {
try {
const window = this._createWindow();
const location = GWeather.Location.new_detached('高州', null, 21.91965, 110.85678);
rememberProvince(location, provinceLabel({admin1: '广东', country_code: 'CN'}));
const reopened = GWeather.Location.get_world().deserialize(location.serialize());
if (getProvince(reopened) !== '广东省') throw new Error('Province lost when reopening a saved place');
const info = this.model.buildInfo(location);
info.abort();
const now = Math.floor(Date.now() / 1000);
const sample = {time: now, temperature_2m: 20, apparent_temperature: 19,
    weather_code: 2, is_day: 1, relative_humidity_2m: 80, wind_speed_10m: 6, wind_direction_10m: 90};
const hourly = {};
for (const [key, value] of Object.entries(sample))
    hourly[key] = Array.from({length: 168}, (_, i) => key === 'time' ? now + i * 3600 : value);
info._apply({current: sample, hourly});
// Real GTK list binding: notifications must describe the old and new lengths,
// including cached updates that synchronously emit "updated".
const model = this.model;
const originalBuildInfo = model.buildInfo;
model.buildInfo = function (place) {
    const result = originalBuildInfo.call(this, place);
    result._apply({current: sample, hourly});
    return result;
};
let publishedCount = model.get_n_items();
const notificationErrors = [];
const signal = model.connect('items-changed', (_model, position, removed, added) => {
    if (position > publishedCount || removed > publishedCount - position)
        notificationErrors.push('Removed items not present in the old model');
    publishedCount += added - removed;
    if (publishedCount !== model.get_n_items()) notificationErrors.push('Published length differs from actual model');
});
const first = model.addNewLocation(location);
const other = GWeather.Location.new_detached('成都', null, 30.66667, 104.06667);
rememberProvince(other, '四川省');
const second = model.addNewLocation(other);
model.setSelectedLocation(first);
model.removeLocation(second);
if (notificationErrors.length || model.get_n_items() !== 1 || model.loading)
    throw new Error('Location model update failed: ' + notificationErrors.join(', '));
if (!window._worldView._listbox.get_row_at_index(0) || window._worldView._listbox.get_row_at_index(1))
    throw new Error('GTK saved-place list does not match model');
model.disconnect(signal);
model.buildInfo = originalBuildInfo;
print('Location list: add, select, delete, native GTK binding and synchronous cached updates passed.');
window.showInfo(info, false);
const daily = window._cityView._infoPage._forecastDaily;
let dayWidgets = 0;
for (let child = daily.get_first_child(); child; child = child.get_next_sibling()) dayWidgets++;
if (daily._preprocess(info.get_forecast_list()).days.length < 5 || dayWidgets < 4)
    throw new Error('Daily forecast did not render multiple future days');
print('Daily forecast: multiple future days rendered, rather than the unavailable label.');
const fetchedAt = info._fetchedAt;
this.activate_action('temperature-unit', new GLib.Variant('s', 'fahrenheit'));
const weather = window._cityView._infoPage;
if (weather._temperatureLabel.label !== '68°' || !weather._apparentLabel.label.includes('66'))
    throw new Error('Actual menu action did not redraw current/apparent temperatures');
if (weather._forecastHourly.get_first_child()._forecastTemperatureLabel.label !== '68°')
    throw new Error('Hourly temperatures did not redraw in Fahrenheit');
if (weather._forecastDaily.get_first_child().minTemp !== 68 || weather._forecastDaily.get_first_child().maxTemp !== 68)
    throw new Error('Daily temperatures did not redraw in Fahrenheit');
this.activate_action('temperature-unit', new GLib.Variant('s', 'centigrade'));
if (weather._temperatureLabel.label !== '20°' || weather._forecastDaily.get_first_child().minTemp !== 20)
    throw new Error('Switching back to Celsius did not redraw');
if (info._fetchedAt !== fetchedAt || info._pending) throw new Error('Unit switch unexpectedly requested new weather');
print('Temperature menu: Celsius/Fahrenheit changes redraw current, apparent, hourly and daily values without a new request.');
const stack = window._cityView.getForecastStack();
const titles = ['hourly', 'daily'].map(name => stack.get_page(stack.get_child_by_name(name)).get_title());
if (titles.join(', ') !== '每小时, 每天')
    throw new Error('Unexpected forecast labels: ' + titles.join(', '));
if (window._refresh.tooltip_text !== '刷新') throw new Error('Refresh tooltip not translated');
if (Util.getNameAndCountry(reopened).join(', ') !== '高州, 广东省') throw new Error('Saved place did not show its province');
if (!imports.gettext.ngettext('Updated %d minute ago.', 'Updated %d minutes ago.', 2).includes('分钟'))
    throw new Error('Plural translation catalog missing');
print('Chinese UI: forecast tabs, refresh tooltip, plural forms and detached city name passed.');
} catch (error) {failure = error;}
GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {this.quit(); return GLib.SOURCE_REMOVE;});
    }
});
const app = new SmokeApplication();
app.set_application_id('org.gnome.Weather.Local.Smoke');
app.run(['system-weather-smoke']);
if (failure) throw failure;
print('GTK4 smoke check: real upstream window, custom search entry, current weather, hourly/daily forecasts constructed; no window presented.');
