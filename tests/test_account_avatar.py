import sqlite3
import tempfile
import unittest
from pathlib import Path

from infinite_canvas.auth_system import AuthSystem, hash_password
from infinite_canvas.avatar_assets import AVATAR_ASSETS


class AccountAvatarMigrationTests(unittest.TestCase):
    def test_legacy_accounts_are_backfilled_once_and_remain_stable(self):
        with tempfile.TemporaryDirectory() as tmp:
            database = Path(tmp) / "auth.db"
            connection = sqlite3.connect(database)
            try:
                connection.execute(
                    """
                    CREATE TABLE users (
                        id TEXT PRIMARY KEY,
                        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                        display_name TEXT NOT NULL,
                        password_hash TEXT NOT NULL,
                        role TEXT NOT NULL,
                        status TEXT NOT NULL,
                        created_at INTEGER NOT NULL,
                        updated_at INTEGER NOT NULL
                    )
                    """
                )
                connection.execute(
                    """
                    INSERT INTO users
                        (id, username, display_name, password_hash, role,
                         status, created_at, updated_at)
                    VALUES ('legacy', 'legacy', 'Legacy', ?, 'admin',
                            'active', 1, 1)
                    """,
                    (hash_password("legacy-password"),),
                )
                connection.commit()
            finally:
                connection.close()

            first = AuthSystem(database).get_user("legacy")
            self.assertIn(first["avatar_asset"], AVATAR_ASSETS)

            reopened = AuthSystem(database).get_user("legacy")
            self.assertEqual(
                reopened["avatar_asset"],
                first["avatar_asset"],
            )

            with sqlite3.connect(database) as check:
                column = next(
                    row
                    for row in check.execute("PRAGMA table_info(users)")
                    if row[1] == "avatar_asset"
                )
                self.assertEqual(column[2].upper(), "TEXT")

    def test_every_new_account_path_assigns_a_persistent_asset(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")
            admin = auth.create_initial_admin(
                username="admin",
                password="admin-password",
                display_name="Admin",
            )
            cli_user = auth.create_user(
                username="designer-cli",
                password="designer-password",
                role="designer",
            )
            application = auth.submit_registration(
                username="designer-web",
                password="designer-password",
                display_name="Web Designer",
            )
            approved = auth.approve_application(application["id"], admin["id"])

            for user in (admin, cli_user, approved):
                with self.subTest(username=user["username"]):
                    self.assertIn(user["avatar_asset"], AVATAR_ASSETS)
                    self.assertEqual(
                        auth.get_user(user["id"])["avatar_asset"],
                        user["avatar_asset"],
                    )

    def test_random_asset_never_returns_the_current_asset(self):
        with tempfile.TemporaryDirectory() as tmp:
            auth = AuthSystem(Path(tmp) / "auth.db")
            user = auth.create_user(
                username="designer", password="designer-password", role="designer"
            )
            for _ in range(8):
                updated = auth.randomize_avatar_asset(user["id"])
                self.assertIn(updated["avatar_asset"], AVATAR_ASSETS)
                self.assertNotEqual(user["avatar_asset"], updated["avatar_asset"])
                user = updated


if __name__ == "__main__":
    unittest.main()
