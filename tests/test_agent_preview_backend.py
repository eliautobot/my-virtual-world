import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


_SERVER_DATA_DIR = tempfile.TemporaryDirectory(prefix="vw-preview-tests-")
os.environ.setdefault("VW_DATA_DIR", _SERVER_DATA_DIR.name)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SERVER_ROOT = PROJECT_ROOT / "src" / "server"
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

import server  # noqa: E402


class AgentPreviewBackendTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "workspace"
        self.root.mkdir()
        self.agent = {
            "id": "test-agent",
            "statusKey": "test-agent",
            "providerKind": "test-sdk",
            "workspace": str(self.root),
        }
        server._agent_preview_records.clear()
        server._agent_preview_serial = 0

    def tearDown(self):
        self.temp.cleanup()

    def agent_patch(self):
        return mock.patch.object(server, "_agent_record_for", return_value=self.agent)

    def test_preview_bubble_settings_are_normalized_independently(self):
        self.assertEqual(
            {
                "displayMode": "consistent",
                "size": "large",
                "contentZoom": 100,
            },
            server._normalize_preview_bubble_settings(None),
        )
        self.assertEqual(
            {
                "displayMode": "world",
                "size": "small",
                "contentZoom": 200,
            },
            server._normalize_preview_bubble_settings({
                "displayMode": "world",
                "size": "small",
                "contentZoom": 450,
            }),
        )

    def test_descriptor_supports_workspace_files_and_workdirs(self):
        project = self.root / "project" / "site"
        project.mkdir(parents=True)
        page = project / "index.html"
        page.write_text("<h1>Live work</h1>", encoding="utf-8")
        with self.agent_patch():
            ok, result, status = server.get_agent_preview_descriptor(
                "test-agent", "site/index.html", str(self.root / "project")
            )
        self.assertTrue(ok)
        self.assertEqual(200, status)
        self.assertEqual("html", result["preview"]["kind"])
        self.assertEqual("project/site/index.html", result["preview"]["path"])
        self.assertTrue(result["preview"]["version"])

    def test_preview_rejects_escape_symlinks_secrets_and_unsupported_files(self):
        outside = Path(self.temp.name) / "outside"
        outside.mkdir()
        (outside / "stolen.md").write_text("secret outside", encoding="utf-8")
        os.symlink(outside, self.root / "escape")
        (self.root / ".env").write_text("TOKEN=DO_NOT_EXPOSE", encoding="utf-8")
        (self.root / "archive.zip").write_bytes(b"PK\x03\x04")
        with self.agent_patch():
            for requested, expected_code in [
                ("../outside/stolen.md", "workspace_escape"),
                ("escape/stolen.md", "workspace_escape"),
                (".env", "sensitive_path"),
                ("archive.zip", "unsupported_file"),
                ("/etc/passwd", "workspace_escape"),
            ]:
                _full, _descriptor, error = server._resolve_agent_preview_file("test-agent", requested)
                self.assertEqual(expected_code, error["error"]["code"], requested)
                self.assertNotIn("DO_NOT_EXPOSE", str(error))

    def test_preview_enforces_type_specific_size_limits(self):
        large = self.root / "huge.txt"
        large.write_bytes(b"x" * (server.AGENT_PREVIEW_TEXT_MAX_BYTES + 1))
        with self.agent_patch():
            _full, _descriptor, error = server._resolve_agent_preview_file("test-agent", "huge.txt")
        self.assertEqual("file_too_large", error["error"]["code"])
        self.assertEqual(413, error["_status"])

    def test_provider_neutral_publish_and_cursor_feed(self):
        report = self.root / "report.md"
        report.write_text("# Report\n", encoding="utf-8")
        with self.agent_patch():
            ok, first, status = server.publish_agent_preview({
                "agentId": "test-agent", "kind": "file", "path": "report.md"
            })
            self.assertTrue(ok)
            self.assertEqual(201, status)
            ok, second, status = server.publish_agent_preview({
                "agentId": "test-agent", "kind": "browser"
            })
            self.assertTrue(ok)
            self.assertEqual(201, status)

        feed = server.list_agent_previews(0)
        self.assertEqual(2, len(feed["previews"]))
        self.assertEqual("file", feed["previews"][0]["target"]["kind"])
        self.assertEqual("browser", feed["previews"][1]["target"]["kind"])
        self.assertEqual([], server.list_agent_previews(second["preview"]["serial"])["previews"])
        self.assertGreaterEqual(feed["cursor"], first["preview"]["serial"])

    def test_publish_rejects_unsafe_urls(self):
        ok, result, status = server.publish_agent_preview({
            "agentId": "test-agent", "kind": "url", "url": "javascript:alert(1)"
        })
        self.assertFalse(ok)
        self.assertEqual(400, status)
        self.assertEqual("invalid_url", result["error"]["code"])


if __name__ == "__main__":
    unittest.main()
