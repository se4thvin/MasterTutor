import unittest

from restore import parse_identity


class IdentityTests(unittest.TestCase):
    def test_measurements_accept_only_the_fixed_public_fields(self):
        line = "P0_ID boot_id=12345678-1234-1234-1234-123456789abc urandom=0123456789abcdef0123456789abcdef clock=1791572400 leftover=absent"
        result = parse_identity(line)
        self.assertEqual(result["clock"], 1791572400)
        self.assertEqual(result["leftover"], "absent")
        with self.assertRaises(ValueError):
            parse_identity(line + " extra=untrusted")
        with self.assertRaises(ValueError):
            parse_identity("P0_ID boot_id=invalid")


if __name__ == "__main__":
    unittest.main()
