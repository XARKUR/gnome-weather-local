import './isolated.js';
import GLib from 'gi://GLib';
import GWeather from 'gi://GWeather?version=4.0';
import {searchLocations, OpenMeteoInfo} from '../overrides/provider.js';
const loop = new GLib.MainLoop(null, false);
let failed = false;
(async () => {
    for (const name of ['茂名', '高州', '惠州']) {
        const results = await searchLocations(name);
        const city = results.find(item => item.admin1 === '广东' && item.name === name);
        if (!city) throw new Error('No Guangdong match: ' + name);
        const info = new OpenMeteoInfo({application_id: 'org.gnome.Weather.Local', contact_info: 'https://open-meteo.com/',
            location: GWeather.Location.new_detached(name, null, city.latitude, city.longitude)});
        await new Promise((resolve, reject) => {
            info.connect('updated', () => info.is_valid() && !info.lastError ? resolve() : reject(new Error(info.lastError || 'Invalid weather')));
            info.update();
        });
        if (info.get_forecast_list().length < 120) throw new Error('Incomplete forecast');
        print(`${name}: search and forecast OK (${info.get_forecast_list().length} hourly samples)`);
        info.abort();
    }
})().catch(error => {failed = true; printerr(error.message + '\n' + error.stack);}).finally(() => loop.quit());
loop.run();
if (failed) imports.system.exit(1);
