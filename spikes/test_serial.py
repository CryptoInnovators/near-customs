import unittest
from serial import serial, load


def rep(*wallets):
    return {'rows': [{'wallet': w, 'class': c} for w, c in wallets]}


class Serial(unittest.TestCase):
    def test_threshold_counts_launches_not_buys(self):
        r = {'a': rep(('x', 'unlinked'), ('x', 'unlinked')), 'b': rep(('x', 'unlinked'), ('y', 'unlinked')), 'c': rep(('x', 'unlinked'), ('y', 'unlinked'))}
        self.assertEqual(serial(r, 3), [('x', ['a', 'b', 'c'])])
        self.assertEqual([w for w, _ in serial(r, 2)], ['x', 'y'])

    def test_creator_row_is_not_a_serial_buyer(self):
        r = {n: rep(('c', 'creator')) for n in 'abc'}
        self.assertEqual(serial(r, 3), [])

    def test_real_replays(self):
        hits = dict(serial(load(), 3))
        self.assertGreaterEqual(len(hits), 20)
        self.assertEqual(len(hits['wrapz-z.near']), 11)
        self.assertNotIn('provenhire.near', hits)


if __name__ == '__main__':
    unittest.main()
