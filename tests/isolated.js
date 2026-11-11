// SPDX-License-Identifier: GPL-3.0-or-later
// Standalone tests must be as isolated as tests launched by project.py check.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

function removeTree(file) {
    const items = file.enumerate_children('standard::name,standard::type,standard::is-symlink',
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
    let item;
    while ((item = items.next_file(null))) {
        const child = file.get_child(item.get_name());
        if (item.get_file_type() === Gio.FileType.DIRECTORY && !item.get_is_symlink()) removeTree(child);
        else child.delete(null);
    }
    items.close(null);
    file.delete(null);
}

export function isolateTest(scriptUri) {
    const existing = GLib.getenv('SYSTEM_WEATHER_TEST_ROOT');
    if (GLib.getenv('SYSTEM_WEATHER_TEST_SCRIPT') === scriptUri && existing &&
        GLib.getenv('GSETTINGS_BACKEND') === 'memory' &&
        GLib.get_user_cache_dir() === existing + '/cache') return;

    const root = GLib.dir_make_tmp('system-weather-test-XXXXXX');
    const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
    launcher.setenv('GSETTINGS_BACKEND', 'memory', true);
    launcher.setenv('LC_ALL', 'zh_CN.UTF-8', true);
    launcher.setenv('LANGUAGE', 'zh_CN:zh', true);
    launcher.setenv('SYSTEM_WEATHER_TEST_ROOT', root, true);
    launcher.setenv('SYSTEM_WEATHER_TEST_SCRIPT', scriptUri, true);
    for (const [key, directory] of [['XDG_CACHE_HOME', 'cache'], ['XDG_CONFIG_HOME', 'config'], ['XDG_DATA_HOME', 'data']]) {
        GLib.mkdir_with_parents(root + '/' + directory, 0o700);
        launcher.setenv(key, root + '/' + directory, true);
    }
    const script = GLib.filename_from_uri(scriptUri)[0];
    const project = GLib.path_get_dirname(GLib.path_get_dirname(script));
    launcher.setenv('GSETTINGS_SCHEMA_DIR', project + '/build/schemas', true);
    let status = 1;
    try {
        const child = launcher.spawnv(['gjs', '-m', script, ...System.programArgs]);
        child.wait(null);
        status = child.get_if_exited() ? child.get_exit_status() : 128 + child.get_term_sig();
    } finally {
        removeTree(Gio.File.new_for_path(root));
    }
    System.exit(status);
}

// Evaluate this module before importing application modules that read settings.
isolateTest(GLib.filename_to_uri(GLib.canonicalize_filename(System.programInvocationName,
    GLib.get_current_dir()), null));
