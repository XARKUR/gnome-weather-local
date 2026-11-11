"""Manage only the extension enable lists; application preferences stay untouched."""
import ast
from contextlib import contextmanager
import os
from pathlib import Path
import subprocess


def desktop_environment():
    env = dict(os.environ)
    bus = Path('/run/user') / str(os.getuid()) / 'bus'
    if bus.exists():
        env.setdefault('XDG_RUNTIME_DIR', str(bus.parent))
        env.setdefault('DBUS_SESSION_BUS_ADDRESS', 'unix:path=' + str(bus))
    return env


def read_shell_state():
    state = {}
    for key in ['enabled-extensions', 'disabled-extensions']:
        value = subprocess.check_output(['gsettings', 'get', 'org.gnome.shell', key],
                                        text=True, env=desktop_environment())
        state[key] = ast.literal_eval(value.replace('@as ', ''))
    return state


def write_shell_state(state):
    for key, value in state.items():
        subprocess.run(['gsettings', 'set', 'org.gnome.shell', key, repr(value)],
                       check=True, env=desktop_environment())


@contextmanager
def extension_update(uuid, conflicts=()):
    original = read_shell_state()
    affected = {uuid, *conflicts}
    temporary = {key: list(value) for key, value in original.items()}
    temporary['enabled-extensions'] = [item for item in temporary['enabled-extensions'] if item not in affected]
    temporary['disabled-extensions'] = list(dict.fromkeys([*temporary['disabled-extensions'], *affected]))
    try:
        write_shell_state(temporary)
        yield
        enabled = [item for item in original['enabled-extensions'] if item not in affected] + [uuid]
        disabled = [item for item in original['disabled-extensions'] if item != uuid]
        disabled += [item for item in conflicts if item in original['enabled-extensions'] and item not in disabled]
        write_shell_state({'enabled-extensions': enabled, 'disabled-extensions': disabled})
    except BaseException:
        write_shell_state(original)
        raise
