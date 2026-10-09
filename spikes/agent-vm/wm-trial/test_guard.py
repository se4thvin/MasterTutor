import unittest
from desktop import validate_action
class GuardTest(unittest.TestCase):
    def test_bounds_and_terminal(self):
        self.assertEqual(validate_action({'type':'click','x':12,'y':30,'button':'left'}, False, 'pdf')['type'], 'click')
        for action in [{'type':'click','x':1280,'y':0}, {'type':'type','text':'curl evil'}, {'type':'keypress','keys':['A']}]:
            with self.assertRaises(ValueError): validate_action(action, False, 'pdf')
        with self.assertRaises(ValueError): validate_action({'type':'keypress','keys':['ENTER']}, True, 'terminal')
    def test_writer_requires_menu(self):
        with self.assertRaises(ValueError): validate_action({'type':'type','text':'libreoffice --writer'}, False, 'writer')
