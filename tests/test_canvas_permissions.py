import unittest

from infinite_canvas.canvas_permissions import (
    can_access_canvas,
    ensure_canvas_access_fields,
    set_canvas_visibility,
)


ADMIN = {"id": "admin-1", "username": "admin", "role": "admin"}
OTHER_ADMIN = {
    "id": "admin-2",
    "username": "other-admin",
    "role": "admin",
}
DESIGNER = {
    "id": "designer-1",
    "username": "designer",
    "role": "designer",
}
GUEST = {"id": "guest-1", "username": "guest", "role": "guest"}


class CanvasPermissionsTests(unittest.TestCase):
    def test_legacy_canvas_is_owned_by_initial_admin_and_shared(self):
        canvas = {"id": "legacy", "title": "Legacy"}

        changed = ensure_canvas_access_fields(canvas, ADMIN)

        self.assertTrue(changed)
        self.assertEqual(canvas["owner_id"], ADMIN["id"])
        self.assertEqual(canvas["owner_username"], ADMIN["username"])
        self.assertEqual(canvas["visibility"], "shared")
        self.assertEqual(canvas["created_by"], ADMIN["id"])
        self.assertEqual(canvas["updated_by"], ADMIN["id"])
        self.assertFalse(ensure_canvas_access_fields(canvas, OTHER_ADMIN))

    def test_private_canvas_overrides_admin_and_designer_permissions(self):
        canvas = {"id": "one", "owner_id": ADMIN["id"], "visibility": "shared"}
        self.assertTrue(can_access_canvas(ADMIN, canvas, write=True))
        self.assertTrue(can_access_canvas(OTHER_ADMIN, canvas, write=True))
        self.assertTrue(can_access_canvas(DESIGNER, canvas, write=True))
        self.assertFalse(can_access_canvas(GUEST, canvas, write=False))

        set_canvas_visibility(canvas, "private", ADMIN)

        self.assertTrue(can_access_canvas(ADMIN, canvas, write=True))
        self.assertFalse(can_access_canvas(OTHER_ADMIN, canvas, write=False))
        self.assertFalse(can_access_canvas(DESIGNER, canvas, write=False))
        with self.assertRaises(PermissionError):
            set_canvas_visibility(canvas, "shared", OTHER_ADMIN)
        with self.assertRaises(PermissionError):
            set_canvas_visibility(canvas, "private", DESIGNER)

    def test_private_canvas_owner_matches_across_local_account_databases(self):
        canvas = {
            "id": "portable",
            "owner_id": "company-device-user-id",
            "owner_username": "admin",
            "visibility": "private",
        }
        home_admin = {
            "id": "home-device-user-id",
            "username": "ADMIN",
            "role": "admin",
        }

        self.assertTrue(can_access_canvas(home_admin, canvas, write=True))
        set_canvas_visibility(canvas, "shared", home_admin)
        self.assertEqual("shared", canvas["visibility"])

    def test_designer_project_allow_list_limits_canvas_access(self):
        scoped_designer = {
            **DESIGNER,
            "project_ids": ["project-a", "project-c"],
        }

        self.assertTrue(
            can_access_canvas(
                scoped_designer,
                {"project": "project-a", "visibility": "shared"},
            )
        )
        self.assertFalse(
            can_access_canvas(
                scoped_designer,
                {"project": "project-b", "visibility": "shared"},
            )
        )
        self.assertFalse(
            can_access_canvas(
                {**DESIGNER, "project_ids": []},
                {"project": "default", "visibility": "shared"},
            )
        )
        self.assertTrue(
            can_access_canvas(
                DESIGNER,
                {"project": "legacy-project", "visibility": "shared"},
            )
        )


if __name__ == "__main__":
    unittest.main()
