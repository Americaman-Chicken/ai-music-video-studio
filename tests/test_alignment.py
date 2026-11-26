import unittest
from align import align
class TestAlignment(unittest.TestCase):
    def test_japanese(self):
        r=align(['夏の歌','君へ'],[{'text':'夏の歌','start':1,'end':2},{'text':'君へ','start':3,'end':4}]);self.assertEqual(r['coverage'],1);self.assertEqual(r['lines'][1]['start'],3);self.assertEqual(len(r['lines'][0]['characters']),3)
    def test_failure(self):
        with self.assertRaises(ValueError): align(['夏の歌'],[{'text':'猫','start':1,'end':2}])
if __name__=='__main__': unittest.main()
