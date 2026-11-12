#!/usr/bin/env python3
"""Build a source-pinned GNOME Weather fork and matching Shell bridge. No sudo."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from po_compile import compile_catalog
from install_utils import extension_update

ROOT = Path(__file__).resolve().parent
UPSTREAM = ROOT / 'upstream/gnome-weather-43.0'
BUILD = ROOT / 'build'
APP_ID = 'org.gnome.Weather.Local'
UUID = 'weather@system.local'


def run(*args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, **kwargs)


def replace(path, old, new):
    source = path.read_text()
    if source.count(old) != 1:
        raise ValueError(f'Unexpected upstream source: {path.name}: {old}')
    path.write_text(source.replace(old, new))


def build():
    source = BUILD / 'source'
    if source.exists():
        shutil.rmtree(source)
    shutil.copytree(UPSTREAM, source)
    shutil.copyfile(ROOT / 'LICENSE-GPL-3', source / 'COPYING-GPL-3')
    for file in (source / 'src').rglob('*.js'):
        text = file.read_text().replace("'org.gnome.Weather'", repr(APP_ID))
        file.write_text(text)
    for file in list((source / 'data').glob('*.ui')) + list((source / 'src').rglob('*.ui')):
        file.write_text(file.read_text().replace('<interface>', '<interface domain="org.gnome.Weather.Local">'))
    shutil.copyfile(ROOT / 'overrides/entry.js', source / 'src/app/entry.js')
    shutil.copyfile(ROOT / 'overrides/provider.js', source / 'src/shared/provider.js')
    shutil.copyfile(ROOT / 'overrides/regions.js', source / 'src/shared/regions.js')
    model = source / 'src/shared/world.js'
    replace(model, "import GWeather from 'gi://GWeather';", "import GWeather from 'gi://GWeather';\nimport {OpenMeteoInfo} from './provider.js';")
    replace(model, 'return new GWeather.Info({', 'return new OpenMeteoInfo({')
    replace(model, '''    #invalidate() {
        this.getAll();
        this.items_changed(0, this._allInfos.length, this._allInfos.length);
    }''', '''    #invalidate() {
        const removed = this._allInfos.length;
        this.getAll();
        this.items_changed(0, removed, this._allInfos.length);
    }''')
    replace(model, '''        info.update();
        this._updateLoadingCount(+1);''', '''        this._updateLoadingCount(+1);
        info.update();''')
    replace(model, '''        for (let i = 0; i < this._allInfos.length; i++) {
            if (this._allInfos[i] == oldInfo) {
                this.items_changed(i, 1, 0);
                break;
            }
        }
''', '')
    replace(model, '''        this.getAll();
        this._queueSaveSettings();''', '''        this.#invalidate();
        this._queueSaveSettings();''')
    application = source / 'src/app/application.js'
    replace(application, 'this.currentLocationController = new CurrentLocationController.CurrentLocationController(this.model);',
            'this.currentLocationController = {autoLocationAvailable: false, currentLocation: null};')
    replace(application, 'Gtk.Window.set_default_icon_name(pkg.name);', "Gtk.Window.set_default_icon_name('org.gnome.Weather');")
    replace(application, 'GLib.set_application_name(name_prefix + _("Weather"));', "GLib.set_application_name('Gnome Weather');")
    replace(application, '''        gwSettings.connect('changed::temperature-unit', function () {
            temperatureAction.state = resolveDefaultTemperatureUnit(gwSettings.get_enum('temperature-unit'));
        });''', '''        gwSettings.connect('changed::temperature-unit', () => {
            temperatureAction.state = resolveDefaultTemperatureUnit(gwSettings.get_enum('temperature-unit'));
            for (const window of this.get_windows()) window._cityView?.refreshUnits();
        });''')
    replace(source / 'src/app/city.js', '''    update() {
        this._stack.visible_child_name = 'loading';''', '''    refreshUnits() {
        if (this._info?.is_valid()) this._onUpdate(this._info);
    }

    update() {
        this._stack.visible_child_name = 'loading';''')
    replace(source / 'src/app/window.js', 'this._searchView.icon_name = pkg.name;', "this._searchView.icon_name = 'org.gnome.Weather';")
    replace(source / 'src/app/window.js', 'application_name: _("Weather"),', "application_name: 'Gnome Weather',")
    replace(source / 'src/app/window.js', 'developer_name: _("The GNOME Project"),', "developer_name: 'GNOME Weather contributors / 本地修改版',")
    replace(source / 'src/app/window.js', 'application_icon: pkg.name,', "application_icon: 'org.gnome.Weather',")
    replace(source / 'src/misc/util.js', "import GWeather from 'gi://GWeather';",
            "import GWeather from 'gi://GWeather';\nimport {getProvince} from '../shared/regions.js';")
    replace(source / 'src/misc/util.js', 'function getNameAndCountry(location) {', '''function getNameAndCountry(location) {
    // Use saved administrative metadata; never infer a detached location's country.
    const province = getProvince(location);
    if (province) return [location.get_name(), province];
    return [location.get_name()];''')
    # The old country lookup is unreachable; remove it from the generated source.
    utility = source / 'src/misc/util.js'
    text = utility.read_text()
    start = text.index('    let country = location.get_parent();', text.index('function getNameAndCountry'))
    end = text.index('\n}', start)
    utility.write_text(text[:start] + text[end:])
    world = source / 'src/app/world.js'
    replace(world, "import * as Util from '../misc/util.js';",
            "import * as Util from '../misc/util.js';\nimport {ensureProvince} from '../shared/regions.js';")
    replace(world, "        grid.connect('remove', () => {", '''        if (!countryName)
            ensureProvince(location).then(province => { grid.countryName = province; }).catch(error => log(error.message));

        grid.connect('remove', () => {''')
    compile_catalog(ROOT / 'po/zh_CN.po', BUILD / 'locale/zh_CN/LC_MESSAGES' / (APP_ID + '.mo'))
    resources = BUILD / 'resources'
    resources.mkdir(exist_ok=True)
    compiler = shutil.which('glib-compile-resources')
    if not compiler:
        local = ROOT / 'tools/glib/usr/bin/glib-compile-resources'
        if local.is_file():
            compiler = str(local)
    xml = (source / 'data/org.gnome.Weather.data.gresource.xml').read_text().replace(' preprocess="xml-stripblanks"', '')
    manifest = resources / 'app.gresource.xml'
    manifest.write_text(xml)
    if compiler:
        run(compiler, manifest, '--sourcedir', source / 'data', '--target', resources / 'app.gresource')
    else:
        bundled = ROOT / 'resources/app.gresource'
        recorded = json.loads((ROOT / 'resources/manifest.json').read_text())
        if hashlib.sha256(xml.encode()).hexdigest() != recorded['resource_xml_sha256']:
            raise RuntimeError('UI resource list changed; rebuild the bundled resources.')
        for name, digest in recorded['inputs'].items():
            if hashlib.sha256((source / 'data' / name).read_bytes()).hexdigest() != digest:
                raise RuntimeError('UI resources changed; rebuild with glib-compile-resources before installing.')
        if hashlib.sha256(bundled.read_bytes()).hexdigest() != recorded['artifact_sha256']:
            raise RuntimeError('Bundled UI resource checksum mismatch.')
        shutil.copyfile(bundled, resources / 'app.gresource')
        print('Using verified portable UI resources; no resource compiler required.')
    schema = (source / 'data/org.gnome.Weather.gschema.xml').read_text().replace('id="org.gnome.Weather"', f'id="{APP_ID}"').replace('path="/org/gnome/Weather/"', 'path="/org/gnome/Weather/Local/"')
    schema = schema.replace('  </schema>', '''    <key name="location-regions" type="a{ss}">
      <default>{}</default>
      <summary>Saved province or state by geographic coordinates</summary>
    </key>
  </schema>''')
    schema_dir = BUILD / 'schemas'
    schema_dir.mkdir(exist_ok=True)
    (schema_dir / (APP_ID + '.gschema.xml')).write_text(schema)
    run('glib-compile-schemas', '--strict', schema_dir)
    (BUILD / 'bootstrap.js').write_text('''// Generated launch environment; source modules are in build/source/src.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
const root = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
Gio.resources_register(Gio.Resource.load(root + '/resources/app.gresource'));
Gtk.init();
Gtk.IconTheme.get_for_display(Gdk.Display.get_default()).add_search_path(root + '/source/data/icons');
globalThis.pkg = {
    name: 'org.gnome.Weather.Local', version: '0.1.4 (based on GNOME Weather 43.0)',
    initFormat() {String.prototype.format = imports.format.format;},
    initGettext() {
        imports.gettext.bindtextdomain('org.gnome.Weather.Local', root + '/locale');
        imports.gettext.textdomain('org.gnome.Weather.Local');
        const gettext = imports.gettext.domain('org.gnome.Weather.Local');
        globalThis._ = gettext.gettext;
        globalThis.C_ = gettext.pgettext;
    },
};
''')
    (BUILD / 'app.js').write_text("import './bootstrap.js';\nimport './source/src/app/main.js';\n")
    launcher = BUILD / 'weather-local'
    launcher.write_text('''#!/bin/sh
set -eu
project_build=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export GSETTINGS_SCHEMA_DIR="$project_build/schemas"
export LC_ALL=zh_CN.UTF-8
export LANGUAGE=zh_CN:zh
exec gjs -m "$project_build/app.js" "$@"
''')
    launcher.chmod(0o755)
    for major in ['43', 'modern']:
        bridge = BUILD / ('bridge-' + major)
        bridge.mkdir(exist_ok=True)
        (bridge / 'schemas').mkdir(exist_ok=True)
        shutil.copyfile(schema_dir / (APP_ID + '.gschema.xml'), bridge / 'schemas' / (APP_ID + '.gschema.xml'))
        metadata = dict(uuid=UUID, name='Gnome Weather', description='Open-Meteo 天气来源；与 Gnome Weather 应用同步地点。', version=5)
        metadata['shell-version'] = ['43'] if major == '43' else ['48', '51']
        (bridge / 'metadata.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
        if major == 'modern':
            for file in ['provider.js', 'bridge.js']:
                shutil.copyfile(ROOT / 'overrides' / file, bridge / file)
            (bridge / 'extension.js').write_text('''import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {WeatherBridge} from './bridge.js';
export default class extends Extension {
    enable() {
        try { this._bridge = new WeatherBridge(Main.panel.statusArea.dateMenu._weatherItem, this.getSettings('org.gnome.Weather.Local')); }
        catch (error) {this.disable(); throw error;}
    }
    disable() {this._bridge?.destroy(); this._bridge = null;}
}
''')
        else:
            provider = (ROOT / 'overrides/provider.js').read_text()
            provider = re.sub(r'^import .*?;\n', '', provider, flags=re.M).replace('export ', '')
            (bridge / 'provider.js').write_text('const {Gio, GLib, GObject, GWeather, Soup} = imports.gi;\nvar Provider = (() => {\n' + provider + '\nreturn {OpenMeteoInfo};\n})();\n')
            adapter = (ROOT / 'overrides/bridge.js').read_text()
            adapter = re.sub(r'^import .*?;\n', '', adapter, flags=re.M).replace('export class WeatherBridge', 'var WeatherBridge = class WeatherBridge')
            (bridge / 'bridge.js').write_text('const {Gio, GWeather} = imports.gi;\nconst Me = imports.misc.extensionUtils.getCurrentExtension();\nconst {OpenMeteoInfo} = Me.imports.provider.Provider;\n' + adapter)
            (bridge / 'extension.js').write_text('''const Main = imports.ui.main;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
class Extension {
    enable() {
        try {this._bridge = new Me.imports.bridge.WeatherBridge(Main.panel.statusArea.dateMenu._weatherItem, ExtensionUtils.getSettings('org.gnome.Weather.Local'));}
        catch (error) {this.disable(); throw error;}
    }
    disable() {this._bridge?.destroy(); this._bridge = null;}
}
function init() {return new Extension();}
''')
        shutil.copyfile(UPSTREAM / 'COPYING.md', bridge / 'COPYING.md')
        run('glib-compile-schemas', '--strict', bridge / 'schemas')
        dist = ROOT / 'dist'
        dist.mkdir(exist_ok=True)
        package = dist / (UUID + ('-gnome43' if major == '43' else '') + '.zip')
        with zipfile.ZipFile(package, 'w', zipfile.ZIP_DEFLATED) as archive:
            for file in sorted(bridge.rglob('*')):
                if file.is_file() and file.name != 'gschemas.compiled':
                    info = zipfile.ZipInfo(file.relative_to(bridge).as_posix(), (2026, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o100644 << 16
                    archive.writestr(info, file.read_bytes())
        package.with_suffix('.zip.sha256').write_text(hashlib.sha256(package.read_bytes()).hexdigest() + '  ' + package.name + '\n')
    print('Built app and GNOME 43 / 48 / 51 weather bridges:', BUILD)


def check(live=False):
    run(sys.executable, '-m', 'unittest', 'discover', '-s', ROOT / 'tests', '-p', 'test_*.py')
    run('gjs', '-m', ROOT / 'tests/provider.js')
    node = shutil.which('node')
    if not node:
        node = str(sorted((Path.home() / '.local/share/fnm/node-versions').glob('*/installation/bin/node'))[-1])
    for directory in [ROOT / 'overrides', BUILD / 'source/src']:
        for file in directory.rglob('*.js'):
            run(node, '--input-type=module', '--check', input=file.read_bytes())
    for file in (BUILD / 'bridge-43').glob('*.js'):
        run(node, '--check', file)
    for file in (BUILD / 'bridge-modern').glob('*.js'):
        run(node, '--input-type=module', '--check', input=file.read_bytes())
    with tempfile.TemporaryDirectory(prefix='weather-check-') as temp:
        env = dict(os.environ, GSETTINGS_BACKEND='memory', GSETTINGS_SCHEMA_DIR=str(BUILD / 'schemas'), XDG_CACHE_HOME=temp,
                   LC_ALL='zh_CN.UTF-8', LANGUAGE='zh_CN:zh')
        run('gjs', '-m', ROOT / 'tests/bridge.js', env=env)
        run('gjs', '-m', ROOT / 'tests/ui.js', env=env)
        if live:
            run('gjs', '-m', ROOT / 'tests/live.js', env=dict(env, XDG_CACHE_HOME=str(Path(temp) / 'live')))
            run('gjs', '-m', ROOT / 'tests/regions-live.js', env=env)


def install():
    if os.geteuid() == 0:
        raise RuntimeError('Run as the desktop user, without sudo.')
    target = Path.home() / '.local/share/system-weather'
    shell = subprocess.check_output(['gnome-shell', '--version'], text=True)
    match = re.search(r'Shell (\d+)', shell)
    major = match[1] if match else None
    if major not in ['43', '48', '51']:
        raise RuntimeError('Bridge requires GNOME 43, 48 or 51.')
    extension = Path.home() / '.local/share/gnome-shell/extensions' / UUID
    desktop = Path.home() / '.local/share/applications' / (APP_ID + '.desktop')
    icon = Path.home() / '.local/share/icons/hicolor/scalable/apps' / (APP_ID + '.svg')
    destinations = [target, extension, desktop, icon]
    for path in destinations:
        if path.exists() or path.is_symlink():
            raise RuntimeError('Refusing to overwrite existing installation file: ' + str(path))
    # Prepare every file before exposing the app or extension. A failed copy or
    # publication must not leave a partial installation that blocks a retry.
    share = Path.home() / '.local/share'
    share.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.weather-install-', dir=share) as temp:
        staging = Path(temp)
        app = staging / 'app'
        app.mkdir()
        for directory in ['source', 'resources', 'schemas', 'locale']:
            shutil.copytree(BUILD / directory, app / directory)
        for name in ['app.js', 'bootstrap.js', 'weather-local']:
            shutil.copy2(BUILD / name, app / name)
        for name in ['README.md', 'NOTICE', 'upstream.lock.json']:
            shutil.copyfile(ROOT / name, app / name)
        bridge = staging / 'bridge'
        shutil.copytree(BUILD / ('bridge-43' if major == '43' else 'bridge-modern'), bridge)
        launcher = staging / 'launcher.desktop'
        launcher.write_text(f'''[Desktop Entry]
Type=Application
Name=Gnome Weather
Comment=Open-Meteo 天气，支持城市搜索和自定义经纬度
Exec="{target / 'weather-local'}"
Icon=org.gnome.Weather.Local
Terminal=false
StartupNotify=true
Categories=GNOME;GTK;Utility;
''')
        staged_icon = staging / 'icon.svg'
        shutil.copyfile(app / 'source/data/icons/hicolor/scalable/apps/org.gnome.Weather.svg', staged_icon)
        published = []
        try:
            for prepared, destination in zip([app, bridge, launcher, staged_icon], destinations):
                destination.parent.mkdir(parents=True, exist_ok=True)
                if destination.exists() or destination.is_symlink():
                    raise RuntimeError('Installation destination appeared during preparation: ' + str(destination))
                prepared.rename(destination)
                published.append(destination)
        except BaseException:
            for path in reversed(published):
                if path.is_dir():
                    shutil.rmtree(path)
                else:
                    path.unlink()
            raise
    print('Installed separate user app and disabled bridge. Original GNOME Weather unchanged.')
    print('Enable bridge after logout/login:', UUID)


def setup():
    """Install using existing GNOME runtime libraries, with no development tools."""
    if os.geteuid() == 0:
        raise RuntimeError('Run ./install.sh as your desktop user, without sudo.')
    if not shutil.which('gjs') or not shutil.which('glib-compile-schemas'):
        raise RuntimeError('Missing GNOME runtime: install gjs and libglib2.0-bin first.')
    run('gjs', '-c', "imports.gi.versions.Gtk = '4.0'; imports.gi.versions.Soup = '3.0'; "
        "imports.gi.versions.GWeather = '4.0'; const {Gtk, Adw, Soup, GWeather, Geoclue} = imports.gi;")
    build()
    share = Path.home() / '.local/share'
    target = share / 'system-weather'
    extension = share / 'gnome-shell/extensions' / UUID
    desktop = share / 'applications' / (APP_ID + '.desktop')
    icon = share / 'icons/hicolor/scalable/apps' / (APP_ID + '.svg')
    paths = [target, extension, desktop, icon]
    for path in paths:
        if path.is_symlink():
            raise RuntimeError('Refusing to replace an installation symlink: ' + str(path))
    owned = False
    if target.exists():
        bootstrap = target / 'bootstrap.js'
        if not bootstrap.is_file() or "name: 'org.gnome.Weather.Local'" not in bootstrap.read_text():
            raise RuntimeError('Existing application directory is not gnome-weather-local.')
        owned = True
    if extension.exists():
        if json.loads((extension / 'metadata.json').read_text()).get('uuid') != UUID:
            raise RuntimeError('Existing extension has a different identity.')
        owned = True
    if desktop.exists():
        if f'Exec="{target / "weather-local"}"' not in desktop.read_text():
            raise RuntimeError('Existing launcher has a different identity.')
        owned = True
    if icon.exists() and not owned:
        raise RuntimeError('Existing icon has no matching application installation.')
    existing = [path for path in paths if path.exists()]
    backup = None
    if existing:
        backup = share / 'gnome-extension-project-backups/gnome-weather-local' / datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
        backup.mkdir(parents=True)
    with extension_update(UUID):
        moved = []
        try:
            for i, path in enumerate(existing):
                saved = backup / str(i)
                path.rename(saved)
                moved.append((path, saved))
            install()
        except BaseException:
            for path, saved in reversed(moved):
                saved.rename(path)
            raise
    if backup:
        print('Previous installation backed up:', backup)
    print('安装完成：从应用列表打开 Gnome Weather。请注销并重新登录，以加载日历扩展。')



if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['build', 'check', 'install', 'setup'])
    parser.add_argument('--live', action='store_true', help='Test the two public APIs with the requested city names')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    if args.command == 'install' and not args.apply:
        parser.error('install requires --apply')
    if args.command == 'build': build()
    elif args.command == 'check': check(args.live)
    elif args.command == 'setup': setup()
    else: install()
