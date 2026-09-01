import json
import tempfile
import time
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class CanvasListIndexContractTests(unittest.TestCase):
    def setUp(self):
        from infinite_canvas.canvas_list_index import CanvasListIndex

        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name) / "canvases"
        self.cache = Path(self.temporary.name) / "cache" / "canvas-list.json"
        self.directory.mkdir(parents=True)
        self.index = CanvasListIndex(
            lambda: self.directory,
            index_file=lambda: self.cache,
        )

    def tearDown(self):
        self.temporary.cleanup()

    def write_canvas(
        self,
        canvas_id,
        *,
        project="default",
        visibility="shared",
        owner="a",
        updated_at=100,
    ):
        path = self.directory / f"{canvas_id}.json"
        path.write_text(
            json.dumps(
                {
                    "id": canvas_id,
                    "title": canvas_id,
                    "kind": "smart",
                    "project": project,
                    "visibility": visibility,
                    "owner_id": owner,
                    "revision": 3,
                    "updated_at": updated_at,
                    "nodes": [
                        {
                            "id": "node-1",
                            "images": [{"url": f"/assets/{canvas_id}.png", "kind": "image"}],
                        },
                        {"id": "node-2"},
                    ],
                }
            ),
            encoding="utf-8",
        )
        return path

    def test_filtered_batches_preserve_access_and_avoid_reparsing_unchanged_documents(self):
        self.write_canvas("shared-a", project="project-a")
        self.write_canvas("shared-b", project="project-b")
        self.write_canvas("private-a", project="project-a", visibility="private", owner="owner-a")

        first = self.index.list_records(
            {"id": "viewer", "role": "designer", "status": "active"},
            project="project-a",
            limit=1,
        )
        parse_count = self.index.document_parse_count
        second = self.index.list_records(
            {"id": "viewer", "role": "designer", "status": "active"},
            project="project-a",
            cursor=first.next_cursor,
            limit=10,
        )

        self.assertEqual([item["id"] for item in first.records], ["shared-a"])
        self.assertEqual(second.records, [])
        self.assertEqual(self.index.document_parse_count, parse_count)
        self.assertEqual(first.records[0]["node_count"], 2)
        self.assertEqual(first.records[0]["cover_url"], "/assets/shared-a.png")

    def test_projected_records_keep_list_behavior_without_legacy_json_index(self):
        from infinite_canvas.canvas_list_index import CanvasListIndex

        legacy_directory = Path(self.temporary.name) / "legacy-must-stay-absent"
        projected = [
            {
                "id": "shared-newer",
                "title": "Shared newer",
                "kind": "smart",
                "project": "project-a",
                "visibility": "shared",
                "owner_id": "owner-a",
                "updated_at": 300,
                "node_count": 2,
                "cover_url": "/assets/newer.png",
            },
            {
                "id": "private-hidden",
                "title": "Private hidden",
                "kind": "smart",
                "project": "project-a",
                "visibility": "private",
                "owner_id": "owner-a",
                "updated_at": 400,
                "node_count": 1,
                "cover_url": "",
            },
            {
                "id": "shared-other-project",
                "title": "Shared other project",
                "kind": "smart",
                "project": "project-b",
                "visibility": "shared",
                "owner_id": "owner-b",
                "updated_at": 500,
                "node_count": 3,
                "cover_url": "",
            },
        ]
        index = CanvasListIndex(
            lambda: legacy_directory,
            index_file=lambda: self.cache,
            record_loader=lambda _actor: projected,
        )

        result = index.list_records(
            {"id": "viewer", "role": "designer", "status": "active"},
            project="project-a",
            limit=20,
        )

        self.assertEqual([item["id"] for item in result.records], ["shared-newer"])
        self.assertEqual(result.records[0]["node_count"], 2)
        self.assertEqual(result.records[0]["cover_url"], "/assets/newer.png")
        self.assertEqual(result.total, 1)
        self.assertFalse(result.rebuilding)
        self.assertFalse(result.index_error)
        self.assertFalse(legacy_directory.exists())
        self.assertFalse(self.cache.exists())

    def test_corrupt_index_is_rebuilt_from_authoritative_smart_canvas_files(self):
        self.write_canvas("canvas-a")
        self.index.index_path.parent.mkdir(parents=True, exist_ok=True)
        self.index.index_path.write_text("not json", encoding="utf-8")

        result = self.index.list_records(
            {"id": "admin", "role": "admin", "status": "active"},
            project="default",
            limit=20,
        )

        self.assertEqual([item["id"] for item in result.records], ["canvas-a"])
        rebuilt = json.loads(self.index.index_path.read_text(encoding="utf-8"))
        self.assertEqual(rebuilt["version"], 1)
        self.assertIn("canvas-a", rebuilt["entries"])

    def test_valid_partial_index_rebuild_is_bounded_and_progressive(self):
        for index in range(120):
            self.write_canvas(f"canvas-{index:03d}", project="project-a")

        first = self.index.list_records(
            {"id": "admin", "role": "admin", "status": "active"},
            project="project-a",
            limit=40,
            parse_budget=50,
        )

        self.assertTrue(first.rebuilding)
        self.assertLessEqual(self.index.document_parse_count, 50)
        self.assertGreater(len(first.records), 0)

        page = first
        for _ in range(4):
            if not page.rebuilding:
                break
            page = self.index.list_records(
                {"id": "admin", "role": "admin", "status": "active"},
                project="project-a",
                limit=200,
                parse_budget=50,
            )
        self.assertFalse(page.rebuilding)
        self.assertEqual(page.total, 120)

    def test_changed_permission_record_is_hidden_until_reparsed(self):
        private_path = self.write_canvas("z-private", visibility="shared", owner="owner-a")
        self.index.list_records(
            {"id": "viewer", "role": "designer", "status": "active"}
        )
        self.write_canvas("z-private", visibility="private", owner="owner-a")
        for index in range(60):
            self.write_canvas(f"a-new-{index:03d}")

        result = self.index.list_records(
            {"id": "viewer", "role": "designer", "status": "active"},
            parse_budget=1,
        )

        self.assertNotIn("z-private", {item["id"] for item in result.records})
        self.assertTrue(private_path.exists())

    def test_rebuilding_pages_restart_until_stable_without_skipping_records(self):
        for index in range(100):
            self.write_canvas(
                f"canvas-{index:03d}",
                project="project-a",
                updated_at=1000 - index if index < 50 else 2000 - index,
            )

        seen = set()
        cursor = ""
        rebuilding = True
        for _ in range(12):
            page = self.index.list_records(
                {"id": "admin", "role": "admin", "status": "active"},
                project="project-a",
                cursor=cursor,
                limit=20,
                parse_budget=20,
            )
            seen.update(item["id"] for item in page.records)
            rebuilding = page.rebuilding
            cursor = page.next_cursor
            if not rebuilding and not cursor:
                break

        self.assertFalse(rebuilding)
        self.assertEqual(len(seen), 100)

    def test_cold_project_query_prioritizes_enough_current_project_records(self):
        for index in range(500):
            self.write_canvas(f"canvas-{index:03d}", project=f"project-{index % 10}")

        result = self.index.list_records(
            {"id": "admin", "role": "admin", "status": "active"},
            project="project-9",
            limit=40,
        )

        self.assertEqual(len(result.records), 40)
        self.assertLessEqual(self.index.document_parse_count, 500)

    def test_corrupt_document_is_cached_as_explicit_incomplete_index_error(self):
        self.write_canvas("healthy")
        (self.directory / "broken.json").write_text("{broken", encoding="utf-8")

        first = self.index.list_records(
            {"id": "admin", "role": "admin", "status": "active"}
        )
        parse_count = self.index.document_parse_count
        second = self.index.list_records(
            {"id": "admin", "role": "admin", "status": "active"}
        )

        self.assertEqual([item["id"] for item in first.records], ["healthy"])
        self.assertFalse(first.rebuilding)
        self.assertTrue(first.index_error)
        self.assertTrue(second.index_error)
        self.assertEqual(self.index.document_parse_count, parse_count)

    def test_unrelated_corrupt_document_does_not_truncate_healthy_project_pages(self):
        for index in range(100):
            self.write_canvas(f"healthy-{index:03d}", project="project-a")
        (self.directory / "broken.json").write_text("{broken", encoding="utf-8")
        self.index.list_records(
            {"id": "admin", "role": "admin", "status": "active"}
        )

        first = self.index.list_records(
            {"id": "admin", "role": "admin", "status": "active"},
            project="project-a",
            limit=40,
        )
        second = self.index.list_records(
            {"id": "admin", "role": "admin", "status": "active"},
            project="project-a",
            cursor=first.next_cursor,
            limit=40,
        )

        self.assertTrue(first.index_error)
        self.assertFalse(first.rebuilding)
        self.assertEqual(first.next_cursor, "40")
        self.assertEqual(len(first.records), 40)
        self.assertEqual(len(second.records), 40)

    def test_acceptance_corpus_routes_grouped_project_before_full_rebuild(self):
        nodes = [{"id": f"node-{index}"} for index in range(200)]
        for project_index in range(10):
            project = f"project-{project_index}"
            for canvas_index in range(1000):
                canvas_id = f"{project}-{canvas_index:04d}"
                (self.directory / f"{canvas_id}.json").write_text(
                    json.dumps(
                        {
                            "id": canvas_id,
                            "title": canvas_id,
                            "kind": "smart",
                            "project": project,
                            "visibility": "shared",
                            "updated_at": canvas_index,
                            "nodes": nodes,
                        },
                        separators=(",", ":"),
                    ),
                    encoding="utf-8",
                )

        started = time.perf_counter()
        first = self.index.list_records(
            {"id": "admin", "role": "admin", "status": "active"},
            project="project-9",
            limit=40,
        )
        first_batch_seconds = time.perf_counter() - started
        second = self.index.list_records(
            {"id": "admin", "role": "admin", "status": "active"},
            project="project-9",
            limit=40,
        )
        parse_count = self.index.document_parse_count
        next_started = time.perf_counter()
        next_page = self.index.list_records(
            {"id": "admin", "role": "admin", "status": "active"},
            project="project-9",
            cursor=second.next_cursor,
            limit=40,
        )
        next_page_seconds = time.perf_counter() - next_started

        self.assertLess(first_batch_seconds, 2.0)
        self.assertEqual(len(first.records), 40)
        self.assertTrue(first.rebuilding)
        self.assertFalse(second.rebuilding)
        self.assertEqual(second.next_cursor, "40")
        self.assertEqual(len(next_page.records), 40)
        self.assertTrue(all(item["project"] == "project-9" for item in next_page.records))
        self.assertEqual(parse_count, 1000)
        self.assertEqual(self.index.document_parse_count, parse_count)
        self.assertLess(next_page_seconds, 1.0)

    def test_project_router_ignores_nested_key_and_late_top_level_order(self):
        for index in range(40):
            self.write_canvas(f"target-{index:02d}", project="target")
        (self.directory / "target-late.json").write_text(
            json.dumps(
                {
                    "id": "target-late",
                    "nodes": [{"id": "nested", "project": "other"}],
                    "project": "target",
                    "visibility": "shared",
                    "updated_at": 0,
                }
            ),
            encoding="utf-8",
        )

        first = self.index.list_records(
            {"id": "admin", "role": "admin", "status": "active"},
            project="target",
            limit=40,
        )
        second = self.index.list_records(
            {"id": "admin", "role": "admin", "status": "active"},
            project="target",
            cursor=first.next_cursor,
            limit=40,
        )

        self.assertFalse(first.rebuilding)
        self.assertEqual(first.next_cursor, "40")
        self.assertEqual([item["id"] for item in second.records], ["target-late"])


class CanvasListProgressiveUiTests(unittest.TestCase):
    def test_current_project_batch_blocks_first_paint_and_later_pages_are_on_demand(self):
        source = (ROOT / "static/js/canvas-list.js").read_text(encoding="utf-8")

        self.assertIn("loadCurrentProjectBatch", source)
        self.assertIn("project=${encodeURIComponent(currentProjectId)}", source)
        self.assertIn("requestIdleCallback", source)
        self.assertIn("renderCanvasBatch", source)
        self.assertIn("loadSecondaryCanvasData", source)
        self.assertIn("loadNextCanvasBatch", source)
        self.assertIn("updateLoadMoreButton", source)
        self.assertIn("refreshProjectsInBackground", source)
        self.assertNotIn("loadSecondaryCanvasData({refreshTrash:false})", source)
        self.assertNotIn("rebuilding && !data.index_error", source)
        self.assertNotIn("persistMeta(c.id, { board_x: c.board_x, board_y: c.board_y });", source)

    def test_project_counts_use_bounded_index_rebuilds(self):
        source = (ROOT / "backend/main.py").read_text(encoding="utf-8")

        self.assertIn("CANVAS_LIST_INDEX.list_records(actor, parse_budget=50)", source)
        self.assertIn('"rebuilding": rebuilding', source)
        self.assertIn('"index_error": index_error', source)


if __name__ == "__main__":
    unittest.main()
