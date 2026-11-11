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
window.showInfo(info, false);
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
