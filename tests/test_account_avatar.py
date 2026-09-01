import sqlite3
import tempfile
import unittest
from pathlib import Path

from infinite_canvas.auth_system import AuthSystem, hash_password


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
            self.assertIn(first["avatar_color_slot"], range(1, 11))

            reopened = AuthSystem(database).get_user("legacy")
            self.assertEqual(
                reopened["avatar_color_slot"],
                first["avatar_color_slot"],
            )

            with sqlite3.connect(database) as check:
                column = next(
                    row
                    for row in check.execute("PRAGMA table_info(users)")
                    if row[1] == "avatar_color_slot"
                )
                self.assertEqual(column[2].upper(), "INTEGER")
                self.assertEqual(column[3], 1)
                self.assertEqual(str(column[4]), "0")

    def test_every_new_account_path_assigns_a_persistent_slot(self):
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
                    self.assertIn(user["avatar_color_slot"], range(1, 11))
                    self.assertEqual(
                        auth.get_user(user["id"])["avatar_color_slot"],
                        user["avatar_color_slot"],
                    )


if __name__ == "__main__":
    unittest.main()
