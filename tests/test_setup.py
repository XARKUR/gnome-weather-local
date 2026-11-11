"""Portable resource builds use temporary projects and never install anything."""
import contextlib
import io
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import project


class PortableBuildTests(unittest.TestCase):
    def setup_in_home(self, home):
        import install_utils
        self.shell_state = {'enabled-extensions': ['unrelated@example', project.UUID],
                            'disabled-extensions': []}
        original_state = {key: list(value) for key, value in self.shell_state.items()}
        with patch.object(project.Path, 'home', return_value=home), \
                patch.object(project.os, 'geteuid', return_value=1000), \
                patch.object(project.subprocess, 'check_output', return_value='GNOME Shell 48.7'), \
                patch.object(project.shutil, 'which', side_effect=lambda name: '/usr/bin/' + name if name in ['gjs', 'glib-compile-schemas'] else None), \
                patch.object(install_utils, 'read_shell_state', return_value=original_state), \
                patch.object(install_utils, 'write_shell_state', side_effect=lambda state: self.shell_state.update(state)), \
                contextlib.redirect_stdout(io.StringIO()):
            project.setup()

    def test_setup_updates_owned_installation_and_keeps_backup(self):
        home = self.root / 'home'
        self.setup_in_home(home)
        target = home / '.local/share/system-weather'
        (target / 'marker').write_text('previous version')
        self.setup_in_home(home)
        self.assertFalse((target / 'marker').exists())
        backups = list((home / '.local/share/gnome-extension-project-backups/gnome-weather-local').glob('*/0/marker'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(), 'previous version')
        self.assertEqual(self.shell_state['enabled-extensions'], ['unrelated@example', project.UUID])

    def test_setup_failure_restores_old_application_and_shell_state(self):
        home = self.root / 'home'
        self.setup_in_home(home)
        target = home / '.local/share/system-weather'
        (target / 'marker').write_text('keep me')
        with patch.object(project, 'install', side_effect=RuntimeError('fixture update failure')):
            with self.assertRaisesRegex(RuntimeError, 'fixture update failure'):
                self.setup_in_home(home)
        self.assertEqual((target / 'marker').read_text(), 'keep me')
        self.assertEqual(self.shell_state['enabled-extensions'], ['unrelated@example', project.UUID])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='weather-portable-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for directory in ['upstream', 'overrides', 'po', 'resources']:
            shutil.copytree(ROOT / directory, self.root / directory)
        shutil.copyfile(ROOT / 'LICENSE-GPL-3', self.root / 'LICENSE-GPL-3')
        for name in ['README.md', 'NOTICE', 'upstream.lock.json']:
            shutil.copyfile(ROOT / name, self.root / name)
        self.addCleanup(patch.stopall)
        patch.multiple(project, ROOT=self.root, UPSTREAM=self.root / 'upstream/gnome-weather-43.0',
                       BUILD=self.root / 'build').start()
        patch.object(project.shutil, 'which', return_value=None).start()

    def build(self):
        with contextlib.redirect_stdout(io.StringIO()):
            project.build()

    def test_build_without_resource_compiler(self):
        self.build()
        self.assertEqual((self.root / 'resources/app.gresource').read_bytes(),
                         (self.root / 'build/resources/app.gresource').read_bytes())
        self.assertEqual(json.loads((self.root / 'build/bridge-modern/metadata.json').read_text())['shell-version'], ['48', '51'])

    def test_reject_modified_bundle(self):
        bundle = self.root / 'resources/app.gresource'
        bundle.write_bytes(bundle.read_bytes() + b'corruption')
        with self.assertRaisesRegex(RuntimeError, 'checksum mismatch'):
            self.build()

    def test_reject_outdated_bundle_after_source_change(self):
        style = self.root / 'upstream/gnome-weather-43.0/data/style.css'
        style.write_text(style.read_text() + '\n/* changed */\n')
        with self.assertRaisesRegex(RuntimeError, 'UI resources changed'):
            self.build()

    def install_in_home(self, home):
        with patch.object(project.Path, 'home', return_value=home), \
                patch.object(project.os, 'geteuid', return_value=1000), \
                patch.object(project.subprocess, 'check_output', return_value='GNOME Shell 48.7'), \
                contextlib.redirect_stdout(io.StringIO()):
            project.install()

    def test_install_publishes_complete_user_app_and_bridge(self):
        self.build()
        home = self.root / 'home'
        self.install_in_home(home)
        share = home / '.local/share'
        self.assertTrue((share / 'system-weather/schemas/gschemas.compiled').is_file())
        self.assertTrue((share / 'gnome-shell/extensions/weather@system.local/extension.js').is_file())
        self.assertTrue((share / 'applications/org.gnome.Weather.Local.desktop').is_file())
        self.assertTrue((share / 'icons/hicolor/scalable/apps/org.gnome.Weather.Local.svg').is_file())
        self.assertEqual(list(share.glob('.weather-install-*')), [])

    def test_failed_publication_rolls_back_for_retry(self):
        self.build()
        home = self.root / 'home'
        rename = Path.rename

        def fail_launcher(path, destination):
            if path.name == 'launcher.desktop':
                raise OSError('Simulated installation failure')
            return rename(path, destination)

        with patch.object(Path, 'rename', fail_launcher), \
                self.assertRaisesRegex(OSError, 'Simulated'):
            self.install_in_home(home)
        share = home / '.local/share'
        self.assertFalse((share / 'system-weather').exists())
        self.assertFalse((share / 'gnome-shell/extensions/weather@system.local').exists())
        self.assertEqual(list(share.glob('.weather-install-*')), [])
        self.install_in_home(home)
        self.assertTrue((share / 'system-weather/weather-local').is_file())

    def test_existing_icon_is_preserved_before_installation(self):
        self.build()
        home = self.root / 'home'
        share = home / '.local/share'
        icon = share / 'icons/hicolor/scalable/apps/org.gnome.Weather.Local.svg'
        icon.parent.mkdir(parents=True)
        icon.write_text('Existing icon')
        with self.assertRaisesRegex(RuntimeError, 'Refusing to overwrite'):
            self.install_in_home(home)
        self.assertEqual(icon.read_text(), 'Existing icon')
        self.assertFalse((share / 'system-weather').exists())


if __name__ == '__main__':
    unittest.main()
