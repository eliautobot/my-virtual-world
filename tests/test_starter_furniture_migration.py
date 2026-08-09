#!/usr/bin/env python3
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SERVER_PATH = ROOT / "src" / "server" / "server.py"


def load_server_module(data_dir):
    os.environ["VW_DATA_DIR"] = str(data_dir)
    spec = importlib.util.spec_from_file_location("starter_furniture_test_server", SERVER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def starter_office():
    furniture = [{"type": "desk", "x": index, "z": 0} for index in range(20)]
    furniture[13] = {"type": "armchair", "x": 3.8829448848333996, "z": 13.995426226952492, "rotation": 0}
    furniture[14] = {"type": "armchair", "x": 7.201852092913043, "z": 14.072239350276813, "rotation": 0}
    furniture[17] = {"type": "counter"}
    furniture[18] = {"type": "microwave"}
    furniture[19] = {"type": "countertopCoffeeMachine"}
    return {
        "id": "bld_1781275645157",
        "name": "Office",
        "type": "office",
        "interior": {"furniture": furniture},
    }


class StarterFurnitureMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.server = load_server_module(Path(cls.temp_dir.name))

    @classmethod
    def tearDownClass(cls):
        cls.temp_dir.cleanup()

    def test_untouched_starter_armchairs_are_upgraded(self):
        building = self.server.repair_starter_office_furniture_metadata(starter_office())
        for index in (13, 14):
            armchair = building["interior"]["furniture"][index]
            self.assertEqual(armchair["catalogId"], "armchair")
            self.assertEqual(armchair["assetClass"], "stationary-persistent-single-comfort-seat")
            self.assertEqual(armchair["furnitureSchemaVersion"], 2)
            self.assertEqual(armchair["lifecycle"]["routing"]["seatOffsetTiles"], 0.42)
            self.assertEqual(armchair["lifecycle"]["routing"]["approachOffsetTiles"], 1.18)
            self.assertEqual(armchair["lifecycle"]["routing"]["seatSurfaceLift"], 2.08)

    def test_user_changes_are_preserved_and_moved_armchairs_are_skipped(self):
        building = starter_office()
        building["interior"]["furniture"][13]["armchairColors"] = {"body": "#123456"}
        building["interior"]["furniture"][14]["x"] += 1
        repaired = self.server.repair_starter_office_furniture_metadata(building)
        self.assertEqual(repaired["interior"]["furniture"][13]["armchairColors"]["body"], "#123456")
        self.assertEqual(repaired["interior"]["furniture"][13]["armchairColors"]["feet"], "#4e342e")
        self.assertNotIn("furnitureSchemaVersion", repaired["interior"]["furniture"][14])

    def test_nonstarter_office_is_not_changed(self):
        building = starter_office()
        building["id"] = "custom-office"
        building["name"] = "Custom Office"
        original = copy.deepcopy(building)
        self.assertEqual(self.server.repair_starter_office_furniture_metadata(building), original)

    def test_load_persists_the_compatibility_upgrade(self):
        with tempfile.TemporaryDirectory() as data_dir:
            buildings_dir = Path(data_dir) / "buildings"
            buildings_dir.mkdir(parents=True)
            self.server.BUILDINGS_DIR = str(buildings_dir)
            path = buildings_dir / "bld_1781275645157.json"
            path.write_text(json.dumps(starter_office()), encoding="utf-8")
            loaded = self.server.load_building("bld_1781275645157")
            persisted = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(loaded["interior"]["furniture"][13]["furnitureSchemaVersion"], 2)
            self.assertEqual(persisted["interior"]["furniture"][13]["furnitureSchemaVersion"], 2)


if __name__ == "__main__":
    unittest.main()
