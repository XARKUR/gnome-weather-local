import './isolated.js';
// End-to-end new-location selection with real API results and isolated settings.
import '../build/bootstrap.js';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio';
import GWeather from 'gi://GWeather?version=4.0';
import {LocationSearchEntry} from '../build/source/src/app/entry.js';
import {getProvince} from '../build/source/src/shared/regions.js';
import * as Util from '../build/source/src/misc/util.js';

if (Gio.Settings.new('org.gnome.Weather.Local').get_value('location-regions').deep_unpack() === null)
    throw new Error('Missing isolated region settings');
pkg.initGettext();
let failure = null;
const app = new Adw.Application({application_id: 'org.gnome.Weather.Local.RegionSmoke'});
app.connect('activate', () => {
    const entry = new LocationSearchEntry();
    const window = new Gtk.ApplicationWindow({application: app, child: entry});
    app.hold();
    (async () => {
        for (const [name, expected] of [['杭州', '浙江省'], ['成都', '四川省'], ['上海', '上海市'], ['南宁', '广西壮族自治区']]) {
            await entry._search(name);
            let selected = -1;
            for (let i = 0; i < entry._store.get_n_items(); i++) {
                const location = entry._store.get_item(i);
                if (location.get_name() === name && entry._metadata.get(location) === expected) {
                    selected = i;
                    if (getProvince(location)) throw new Error('Test requires an uncached place');
                    break;
                }
            }
            if (selected < 0) throw new Error(`${name}: search province missing (${entry._status.label})`);
            // The actual selection handler, rather than a test seeding metadata.
            entry._selection.set_selected(selected);
            const saved = GWeather.Location.get_world().deserialize(entry.location.serialize());
            if (getProvince(saved) !== expected) throw new Error(`${name}: province not saved after selection`);
            if (Util.getNameAndCountry(saved)[1] !== expected) throw new Error(`${name}: saved-list subtitle missing`);
            print(`${name}: API province → search subtitle → actual selection → reopened saved-list subtitle = ${expected}`);
        }
    })().catch(error => {failure = error;}).finally(() => {
        window.destroy();
        app.release();
        app.quit();
    });
});
app.run(['weather-region-smoke']);
if (failure) throw failure;
