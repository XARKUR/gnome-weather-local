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
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='weather-portable-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for directory in ['upstream', 'overrides', 'po', 'resources']:
            shutil.copytree(ROOT / directory, self.root / directory)
        shutil.copyfile(ROOT / 'LICENSE-GPL-3', self.root / 'LICENSE-GPL-3')
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


if __name__ == '__main__':
    unittest.main()
