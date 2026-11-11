"""Compile gettext catalogs, including contexts and plural forms, offline."""
import ast
from pathlib import Path
import re
import struct


def compile_catalog(source: Path, target: Path):
    entries, fields, active, fuzzy = {}, {}, None, False

    def flush():
        if 'msgid' not in fields or fuzzy:
            return
        key = fields['msgid']
        if 'msgctxt' in fields:
            key = fields['msgctxt'] + '\x04' + key
        if 'msgid_plural' in fields:
            key += '\x00' + fields['msgid_plural']
            indices = sorted(int(k[7:-1]) for k in fields if k.startswith('msgstr['))
            if indices != list(range(len(indices))):
                raise ValueError('Non-contiguous plural forms')
            value = '\x00'.join(fields[f'msgstr[{i}]'] for i in indices)
        else:
            value = fields.get('msgstr', '')
        if value or key == '':
            entries[key.encode()] = value.encode()

    for line in source.read_text(encoding='utf-8').splitlines() + ['']:
        text = line.strip()
        if not text:
            flush()
            fields, active, fuzzy = {}, None, False
        elif text.startswith('#'):
            fuzzy |= text.startswith('#,') and 'fuzzy' in text
        elif text.startswith('"'):
            if active is None:
                raise ValueError('Orphan gettext continuation')
            fields[active] += ast.literal_eval(text)
        else:
            match = re.fullmatch(r'(msgctxt|msgid_plural|msgid|msgstr(?:\[\d+\])?) (".*")', text)
            if not match:
                raise ValueError('Unsupported gettext syntax: ' + text)
            active = match[1]
            fields[active] = ast.literal_eval(match[2])
    keys = sorted(entries)
    originals = keys
    translations = [entries[key] for key in keys]
    count = len(keys)
    offset = 28 + count * 16
    tables = []
    for values in [originals, translations]:
        for value in values:
            tables.extend([len(value), offset])
            offset += len(value) + 1
    data = struct.pack('<7I', 0x950412DE, 0, count, 28, 28 + count * 8, 0, 0)
    data += struct.pack(f'<{len(tables)}I', *tables)
    data += b''.join(value + b'\x00' for value in originals + translations)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
