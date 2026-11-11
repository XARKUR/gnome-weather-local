// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';
import GWeather from 'gi://GWeather?version=4.0';
import {OpenMeteoInfo} from './provider.js';

class WeatherClient {
    constructor(settings, launch) {
        this.settings = settings;
        this.launch = launch;
        this.available = true;
        this.loading = false;
        this.hasLocation = false;
        this._listeners = new Map();
        this._nextId = 1;
        this._settingsSignal = settings.connect('changed::locations', () => this._load());
        this._load();
    }
    connect(signal, callback) {
        if (signal !== 'changed') throw new Error('Unsupported weather signal');
        const id = this._nextId++;
        this._listeners.set(id, callback);
        return id;
    }
    disconnect(id) {this._listeners.delete(id);}
    _changed() {for (const fn of this._listeners.values()) fn(this);}
    _load() {
        if (this.info) {
            this.info.disconnect(this._infoSignal);
            this.info.abort();
        }
        const serialized = this.settings.get_value('locations').deep_unpack()[0];
        const location = serialized ? GWeather.Location.get_world().deserialize(serialized) : null;
        this.hasLocation = Boolean(location);
        this.loading = false;
        this.info = new OpenMeteoInfo({application_id: 'org.gnome.Weather.Local',
            contact_info: 'https://open-meteo.com/', location});
        this._infoSignal = this.info.connect('updated', () => {this.loading = false; this._changed();});
        this._changed();
        if (this.hasLocation) this.update();
    }
    update() {
        if (!this.hasLocation) return;
        this.loading = !this.info.is_valid();
        this._changed();
        this.info.update();
    }
    activateApp() {Gio.DesktopAppInfo.new('org.gnome.Weather.Local.desktop')?.launch([], null);}
    destroy() {
        this.settings.disconnect(this._settingsSignal);
        if (this.info) {this.info.disconnect(this._infoSignal); this.info.abort();}
        this._listeners.clear();
    }
}
export class WeatherBridge {
    constructor(section, settings) {
        if (!section?._weatherClient || typeof section._sync !== 'function')
            throw new Error('Unsupported GNOME weather card');
        this.section = section;
        this.original = section._weatherClient;
        this.originalName = section._findBestLocationName;
        this.nameWasOwn = Object.prototype.hasOwnProperty.call(section, '_findBestLocationName');
        this.client = new WeatherClient(settings);
        section._weatherClient = this.client;
        section._findBestLocationName = location => location.get_name();
        this.client.connect('changed', () => section._sync());
        try {section._sync();}
        catch (error) {this.destroy(); throw error;}
    }
    destroy() {
        if (!this.client) return;
        this.section._weatherClient = this.original;
        if (this.nameWasOwn) this.section._findBestLocationName = this.originalName;
        else delete this.section._findBestLocationName;
        this.client.destroy();
        this.client = null;
        this.section._sync();
    }
}
