// SPDX-License-Identifier: GPL-2.0-or-later
// Replacement location search; the rest of the window remains GNOME Weather.
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import GWeather from 'gi://GWeather';
import {LocationRow} from './locationRow.js';
import {searchLocations} from '../shared/provider.js';
import {provinceLabel, rememberProvince} from '../shared/regions.js';

export const LocationSearchEntry = GObject.registerClass({
    Properties: {
        'text': GObject.ParamSpec.string('text', '', '', GObject.ParamFlags.READWRITE, ''),
        'placeholder-text': GObject.ParamSpec.string('placeholder-text', '', '', GObject.ParamFlags.READWRITE, ''),
        'location': GObject.ParamSpec.object('location', '', '', GObject.ParamFlags.READWRITE, GWeather.Location.$gtype),
    },
    Signals: {'search-updated': {param_types: [GObject.TYPE_STRING]}},
}, class LocationSearchEntry extends Adw.Bin {
    constructor() {
        super();
        this._text = '';
        this._location = null;
        this._generation = 0;
        this._entry = new Gtk.SearchEntry({hexpand: true});
        this._status = new Gtk.Label({visible: false, wrap: true, xalign: 0, margin_top: 6});
        this._status.add_css_class('dim-label');
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        box.append(this._entry);
        box.append(this._status);
        this.set_child(box);
        this._store = new Gio.ListStore({item_type: GWeather.Location.$gtype});
        this._metadata = new WeakMap();
        this._selection = new Gtk.SingleSelection({model: this._store,
            autoselect: false, selected: GLib.MAXUINT32});
        this._factory = new Gtk.SignalListItemFactory();
        this._factory.connect('setup', (_factory, item) => item.set_child(new LocationRow({name: '', countryName: ''})));
        this._factory.connect('bind', (_factory, item) => {
            const location = item.get_item();
            item.get_child().name = location.get_name();
            item.get_child().countryName = this._metadata.get(location) || '';
        });
        this._selection.connect('notify::selected', () => {
            const selected = this._selection.get_selected_item();
            if (selected) {
                rememberProvince(selected, this._metadata.get(selected));
                this.location = selected;
            }
        });
        this.bind_property('placeholder-text', this._entry, 'placeholder-text', GObject.BindingFlags.DEFAULT);
        this.bind_property('text', this._entry, 'text', GObject.BindingFlags.BIDIRECTIONAL);
        this._entry.connect('search-changed', () => this._search(this._entry.text));
    }
    get text() {return this._text;}
    set text(value) {if (this._text !== value) {this._text = value; this.notify('text');}}
    get location() {return this._location;}
    set location(value) {this._location = value; this.notify('location');}
    setListView(view) {
        if (this._view) this._view.model = null;
        this._view = view;
        view.factory = this._factory;
        view.model = this._selection;
    }
    async _search(text) {
        const generation = ++this._generation;
        this._request?.cancel();
        const request = new Gio.Cancellable();
        this._request = request;
        this._store.remove_all();
        this.emit('search-updated', text);
        this._status.visible = text.trim().length > 0;
        this._status.label = '正在搜索…';
        try {
            const items = await searchLocations(text, request);
            if (generation !== this._generation) return;
            for (const item of items) {
                const location = GWeather.Location.new_detached(item.name, null, item.latitude, item.longitude);
                this._metadata.set(location, provinceLabel(item));
                this._store.append(location);
            }
            this._status.label = items.length ? '地点：GeoNames / Open-Meteo' :
                '未找到地点。也可以输入“名称;纬度,经度”，例如：高州;21.91965,110.85678';
        } catch (error) {
            if (generation !== this._generation) return;
            this._status.label = '搜索失败：' + error.message;
        }
    }
    vfunc_unroot() {
        this._generation++;
        this._request?.cancel();
        if (this._view) this._view.model = null;
        super.vfunc_unroot();
    }
});
LocationSearchEntry.set_layout_manager_type(Gtk.BinLayout);
