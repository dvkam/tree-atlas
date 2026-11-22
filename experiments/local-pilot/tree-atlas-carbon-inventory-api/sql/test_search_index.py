import copy
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('search_index',Path(__file__).with_name('apply_search_index.py'))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SearchIndexDefinition(unittest.TestCase):
    def setUp(self):
        self.valid={'schema':'atlas','table':'records','method':'btree','valid':True,'ready':True,'unique':False,
                    'keyCount':3,'columns':module.COLUMNS,'predicate':None,'expressions':None,'bytes':262094848}

    def test_accepts_only_the_complete_covering_read_path(self):
        module.validate_index(self.valid)

    def test_refuses_invalid_unready_partial_wrong_table_or_column_index(self):
        for change in [{'valid':False},{'ready':False},{'table':'dictionary'},{'keyCount':2},
                       {'columns':module.COLUMNS[:-1]},{'predicate':'(lon IS NOT NULL)'},
                       {'expressions':'lower(search_id)'},{'method':'hash'},{'unique':True}]:
            with self.subTest(change=change):
                value=copy.deepcopy(self.valid);value.update(change)
                with self.assertRaisesRegex(ValueError,'another definition'):
                    module.validate_index(value)


if __name__=='__main__':
    unittest.main()
