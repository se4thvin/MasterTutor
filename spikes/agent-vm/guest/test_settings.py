import base64
import json
import unittest
from start_line import parse_settings

class SettingsTest(unittest.TestCase):
    def test_optional_memory_only_password(self):
        value = base64.b64encode(json.dumps({'password': 'a' * 48}).encode())
        self.assertEqual(parse_settings(b'start 1791500000000 ' + value + b'\n'), (1791500000000, 'a' * 48))
        self.assertEqual(parse_settings(b'start 1791500000000\n'), (1791500000000, None))
    def test_rejects_extra_fields_and_shell_input(self):
        for data in [{'password': '$(bad)'}, {'password': 'a'*48, 'command': 'bad'}]:
            with self.assertRaises(ValueError):
                parse_settings(b'start 1791500000000 ' + base64.b64encode(json.dumps(data).encode()) + b'\n')
