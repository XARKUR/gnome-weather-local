import './isolated.js';
// Actual Shell weather-section methods, with simulated St actors, real GWeather
// adapter objects, isolated GSettings and a local weather-cache fixture.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GWeather from 'gi://GWeather?version=4.0';
import {WeatherBridge} from '../overrides/bridge.js';
function assert(value, message) {if (!value) throw new Error(message);}
class Actor {
    constructor(props = {}) {this.children = []; this.clutter_text = {}; Object.assign(this, props);}
    add_style_class_name() {}
    remove_style_class_name() {}
    destroy_all_children() {this.children = [];}
}
const fixturesPath = GLib.build_filenamev([GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]), 'native-weather.json']);
const [, bytes] = GLib.file_get_contents(fixturesPath);
const fixtures = JSON.parse(new TextDecoder().decode(bytes));
const settings = new Gio.Settings({schema_id: 'org.gnome.Weather.Local'});
const units = new Gio.Settings({schema_id: 'org.gnome.GWeather4'});
units.set_string('temperature-unit', 'centigrade');
const location = GWeather.Location.new_detached('高州', null, 21.91965, 110.85678);
const [lat, lon] = location.get_coords();
const path = GLib.build_filenamev([GLib.get_user_cache_dir(), 'system-weather', `${lat.toFixed(5)}_${lon.toFixed(5)}.json`]);
GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o700);
const now = Math.floor(Date.now() / 3600000) * 3600;
const sample = {time: now, temperature_2m: 20, apparent_temperature: 19, weather_code: 0,
    is_day: 1, relative_humidity_2m: 80, wind_speed_10m: 5, wind_direction_10m: 90};
const hourly = Object.fromEntries(Object.entries(sample).map(([key, value]) =>
    [key, Array.from({length: 24}, (_, i) => key === 'time' ? now + i * 3600 : value)]));
GLib.file_set_contents(path, JSON.stringify({fetchedAt: Date.now(), data: {current: sample, hourly}}));
for (const [version, fixture] of Object.entries(fixtures)) {
    const Section = new Function('St', 'Clutter', 'GWeather', 'GLib', 'Pango', 'Util', '_', 'MAX_FORECASTS', 'formatTime',
        'return (' + fixture.class + ');')({Button: Actor, Label: Actor, Icon: Actor},
        {ActorAlign: {CENTER: 0}, TextDirection: {RTL: 1}}, GWeather, GLib,
        {EllipsizeMode: {NONE: 0}}, {formatTime: date => String(date.getHours())}, text => text, 5, date => String(date.getHours()));
    for (let cycle = 0; cycle < 3; cycle++) {
        settings.reset('locations');
        const section = Object.create(Section.prototype);
        section._weatherClient = {available: false};
        const original = section._weatherClient;
        const originalName = section._findBestLocationName;
        section._titleLabel = new Actor();
        section._titleLocation = new Actor();
        section._forecastGrid = new Actor();
        section._forecastGrid.layout_manager = {attach(actor) {section._forecastGrid.children.push(actor);}};
        const bridge = new WeatherBridge(section, settings);
        assert(section.visible, 'No-location card must remain accessible');
        settings.set_value('locations', new GLib.Variant('av', [location.serialize()]));
        assert(section._titleLocation.text === '高州', 'Custom location name lost');
        assert(section._forecastGrid.children.length === 15, 'Native five-hour card failed');
        assert(section._weatherClient.info instanceof GWeather.Info, 'Native info contract');
        units.set_string('temperature-unit', 'fahrenheit');
        assert(section._forecastGrid.children[2].text.trim() === '68°', 'Calendar did not redraw in Fahrenheit');
        units.set_string('temperature-unit', 'centigrade');
        assert(section._forecastGrid.children[2].text.trim() === '20°', 'Calendar did not redraw in Celsius');
        bridge.destroy(); bridge.destroy();
        assert(section._weatherClient === original, 'Original weather client not restored');
        assert(section._findBestLocationName === originalName, 'Original location method not restored');
        assert(!section.visible, 'Original visibility not restored');
        settings.reset('locations');
    }
    print(`Shell ${version}: native five-hour forecast rendering, saved-place sync, 3 bridge enable/disable cycles passed (simulated actors).`);
}
