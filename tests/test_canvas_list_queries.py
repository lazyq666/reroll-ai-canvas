import json
import tempfile
import unittest
from pathlib import Path

from infinite_canvas.canvas_list_index import CanvasListIndex


class CanvasListQueryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.actor = {"id": "designer", "role": "designer", "status": "active"}
        self.records = [
            {
                "id": f"canvas-{index:02}",
                "title": f"Study {index:02}",
                "kind": "smart",
                "project": "default",
                "visibility": "shared",
                "owner_id": "designer",
                "created_at": index + 100,
                "updated_at": 1000 - index,
            }
            for index in range(48)
        ]
        self.index = CanvasListIndex(
            lambda: Path(self.temporary.name),
            index_file=lambda: Path(self.temporary.name) / "index.json",
            record_loader=lambda actor: self.records,
        )

    def test_search_finds_results_beyond_first_page_and_preserves_access(self):
        self.records.extend([
            {**self.records[-1], "id": "hidden", "visibility": "private", "owner_id": "other"},
            {**self.records[-1], "id": "other-project", "project": "other"},
            {**self.records[-1], "id": "deleted", "deleted_at": 2000},
        ])
        page = self.index.list_records(self.actor, project="default", search="  STUDY 47 ", limit=40)
        self.assertEqual([record["id"] for record in page.records], ["canvas-47"])
        self.assertEqual(page.total, 1)
        self.assertEqual(page.next_cursor, "")

    def test_sorting_applies_before_pagination_with_pins_first(self):
        self.records[0]["pinned"] = True
        first = self.index.list_records(self.actor, project="default", sort="created", limit=2)
        second = self.index.list_records(self.actor, project="default", sort="created", limit=2, cursor=first.next_cursor)
        self.assertEqual([record["id"] for record in first.records], ["canvas-00", "canvas-47"])
        self.assertEqual([record["id"] for record in second.records], ["canvas-46", "canvas-45"])
        ascending = self.index.list_records(self.actor, project="default", sort="title", direction="asc", limit=3)
        self.assertEqual([record["id"] for record in ascending.records], ["canvas-00", "canvas-01", "canvas-02"])

    def test_private_filter_only_returns_owned_private_canvases(self):
        self.records[0]["visibility"] = "private"
        self.records[1].update(visibility="private", owner_id="other")
        private = self.index.list_records(self.actor, project="default", visibility="private")
        shared = self.index.list_records(self.actor, project="default", visibility="shared")
        self.assertEqual([record["id"] for record in private.records], ["canvas-00"])
        self.assertEqual(shared.total, 46)

    def test_mine_filters_by_creator_before_pagination_without_changing_access(self):
        self.records[0].update(created_by="designer", visibility="private")
        self.records[-1].update(created_by="designer", owner_id="other")
        self.records.extend([
            {**self.records[0], "id":"hidden", "owner_id":"other"},
            {**self.records[-1], "id":"other-project", "project":"other"},
            {**self.records[-1], "id":"deleted", "deleted_at":2000},
            {**self.records[0], "id":"owned-not-created", "created_by":"other"},
        ])
        first = self.index.list_records(self.actor, project="default", mine=True, limit=1)
        self.assertEqual(first.total, 2)
        self.assertEqual([record["id"] for record in first.records], ["canvas-00"])
        second = self.index.list_records(self.actor, project="default", mine=True, limit=1, cursor=first.next_cursor)
        self.assertEqual([record["id"] for record in second.records], ["canvas-47"])
        exhausted = self.index.list_records(self.actor, project="default", mine=True, limit=1, cursor=second.next_cursor)
        self.assertEqual(exhausted.records, [])
        self.assertEqual(exhausted.next_cursor, "")
        matching = self.index.list_records(self.actor, project="default", mine=True, search="47", sort="title", direction="asc")
        self.assertEqual([record["id"] for record in matching.records], ["canvas-47"])
        denied = self.index.list_records({**self.actor, "project_ids":[]}, project="default", mine=True)
        self.assertEqual(denied.records, [])

    def test_mine_finishes_indexing_past_other_creators(self):
        directory = Path(self.temporary.name) / "documents"
        directory.mkdir()
        for canvas_id, creator in (("a", "other"), ("z", "designer")):
            (directory / f"{canvas_id}.json").write_text(json.dumps({
                "id":canvas_id, "title":canvas_id, "kind":"smart",
                "visibility":"shared", "owner_id":"designer", "created_by":creator, "nodes":[],
            }))
        index = CanvasListIndex(lambda: directory, index_file=lambda: Path(self.temporary.name) / "derived.json")
        first = index.list_records(self.actor, project="default", mine=True, limit=1, parse_budget=1)
        self.assertTrue(first.rebuilding)
        self.assertEqual(first.records, [])
        second = index.list_records(self.actor, project="default", mine=True, limit=1, parse_budget=1)
        self.assertFalse(second.rebuilding)
        self.assertEqual([record["id"] for record in second.records], ["z"])

    def test_search_finishes_indexing_records_without_project_hints(self):
        directory = Path(self.temporary.name) / "documents"
        directory.mkdir()
        for canvas_id, title in (("a", "Other"), ("z", "Target")):
            (directory / f"{canvas_id}.json").write_text(json.dumps({
                "id":canvas_id, "title":title, "kind":"smart",
                "visibility":"shared", "owner_id":"designer", "nodes":[],
            }))
        index = CanvasListIndex(lambda: directory, index_file=lambda: Path(self.temporary.name) / "derived.json")
        first = index.list_records(self.actor, project="default", search="Target", limit=1, parse_budget=1)
        self.assertTrue(first.rebuilding)
        self.assertEqual(first.records, [])
        second = index.list_records(self.actor, project="default", search="Target", limit=1, parse_budget=1)
        self.assertFalse(second.rebuilding)
        self.assertEqual([record["id"] for record in second.records], ["z"])


if __name__ == "__main__":
    unittest.main()
