// SPDX-License-Identifier: GPL-2.0-or-later
// Keep administrative labels separately from GWeather's serialized coordinates.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {searchLocations} from './provider.js';

const settings = new Gio.Settings({schema_id: 'org.gnome.Weather.Local'});
const pending = new Map();
const provinces = new Set('河北 山西 辽宁 吉林 黑龙江 江苏 浙江 安徽 福建 江西 山东 河南 湖北 湖南 广东 海南 四川 贵州 云南 陕西 甘肃 青海 台湾'.split(' '));
const autonomous = {'内蒙古': '内蒙古自治区', '广西': '广西壮族自治区',
    '西藏': '西藏自治区', '宁夏': '宁夏回族自治区', '新疆': '新疆维吾尔自治区'};
function key(location) {return location.get_coords().map(value => value.toFixed(5)).join(',');}
export function provinceLabel(item) {
    const name = item.admin1 || '';
    if (item.country_code !== 'CN') return name;
    if (provinces.has(name)) return name + '省';
    if (autonomous[name]) return autonomous[name];
    if (['北京', '天津', '上海', '重庆'].includes(name)) return name + '市';
    return name;
}
export function getProvince(location) {
    return settings.get_value('location-regions').deep_unpack()[key(location)] || '';
}
export function rememberProvince(location, province) {
    if (!province) return;
    const values = settings.get_value('location-regions').deep_unpack();
    if (values[key(location)] === province) return;
    values[key(location)] = province;
    settings.set_value('location-regions', new GLib.Variant('a{ss}', values));
}
function distance(location, item) {
    const [lat, lon] = location.get_coords();
    const radians = value => value * Math.PI / 180;
    const a = Math.sin(radians(item.latitude - lat) / 2) ** 2 +
        Math.cos(radians(lat)) * Math.cos(radians(item.latitude)) * Math.sin(radians(item.longitude - lon) / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(Math.min(a, 1)));
}
export async function ensureProvince(location) {
    const cached = getProvince(location);
    if (cached) return cached;
    const id = key(location);
    if (pending.has(id)) return pending.get(id);
    // Backfill places saved before administrative metadata was introduced.
    const request = (async () => {
        const normalize = name => name.trim().replace(/[市县区]$/, '');
        const name = normalize(location.get_name());
        const matches = (await searchLocations(name)).filter(item =>
            (normalize(item.name) === name && distance(location, item) < 50) ||
            // Older native places can retain English names while this API
            // returns Chinese names; require a much closer coordinate match.
            (!/[\u4e00-\u9fff]/.test(name) && distance(location, item) < 10))
            .sort((a, b) => distance(location, a) - distance(location, b));
        const province = matches.length ? provinceLabel(matches[0]) : '';
        rememberProvince(location, province);
        return province;
    })();
    pending.set(id, request);
    try {return await request;} finally {pending.delete(id);}
}
