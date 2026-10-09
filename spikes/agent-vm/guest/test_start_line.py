import unittest

from start_line import parse_start


class StartTests(unittest.TestCase):
    def test_epoch_is_not_shell_code(self):
        self.assertEqual(parse_start(b"start 1791572400000\n"), 1791572400000)
        for line in [b"start $(id)\n", b"start 123\n", b"start 1791572400000 extra\n", b"start 1791572400000\nignored\n"]:
            with self.assertRaises(ValueError):
                parse_start(line)

    def test_line_length_is_bounded_before_parsing(self):
        with self.assertRaises(ValueError):
            parse_start(b"start " + b"1" * 8192)


if __name__ == "__main__":
    unittest.main()
