#!/usr/bin/env python3
import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SERVER_ROOT = ROOT / "src" / "server"
SERVER_PATH = SERVER_ROOT / "server.py"


def load_server(data_dir):
    os.environ["VW_DATA_DIR"] = str(data_dir)
    if str(SERVER_ROOT) not in sys.path:
        sys.path.insert(0, str(SERVER_ROOT))
    spec = importlib.util.spec_from_file_location("sms_backend_test_server", SERVER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SmsBackendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.import_data = tempfile.TemporaryDirectory(prefix="vw-sms-import-")
        cls.server = load_server(cls.import_data.name)

    @classmethod
    def tearDownClass(cls):
        cls.import_data.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="vw-sms-test-")
        self.data_dir = Path(self.temp.name)
        self.original_config = copy.deepcopy(self.server.VW_CONFIG)
        self.original_data_dir = self.server.DATA_DIR
        self.original_check_feature = self.server.check_feature
        self.original_get_roster = self.server.get_roster
        self.server.DATA_DIR = str(self.data_dir)
        self.server.VW_CONFIG["features"]["sms"] = True
        self.server.VW_CONFIG["sms"] = {
            "ownerAgentId": "sms-agent",
            "twilioAccountSid": "AC_TEST_ONLY",
            "twilioAuthToken": "secret-test-token",
            "fromNumber": "+15550001111",
            "publicMediaBaseUrl": "",
            "syncHistory": True,
        }
        self.server.check_feature = lambda feature: feature == "sms" or self.original_check_feature(feature)
        self.server.get_roster = lambda meta=None: [{
            "id": "sms-agent", "statusKey": "sms-agent", "name": "SMS Agent", "emoji": "📨", "status": "idle",
        }]
        self.server._SMS_SYNC_CACHE = {"at": 0.0, "result": None}

    def tearDown(self):
        self.server.VW_CONFIG = self.original_config
        self.server.DATA_DIR = self.original_data_dir
        self.server.check_feature = self.original_check_feature
        self.server.get_roster = self.original_get_roster
        self.server._SMS_SYNC_CACHE = {"at": 0.0, "result": None}
        self.temp.cleanup()

    def test_phone_normalization_thread_modes_and_atomic_persistence(self):
        self.assertEqual("+15551234567", self.server._normalize_sms_phone("(555) 123-4567"))
        result, status = self.server._set_sms_thread_mode("555-123-4567", "user")
        self.assertEqual(200, status)
        self.assertTrue(result["ok"])
        self.assertEqual("user", self.server._sms_thread_mode("+1 (555) 123-4567"))
        persisted = json.loads((self.data_dir / "sms-thread-modes.json").read_text(encoding="utf-8"))
        self.assertEqual({"+15551234567": "user"}, persisted)

    def test_twilio_sync_builds_inbox_with_inbound_and_outbound_messages(self):
        remote = {
            "messages": [
                {
                    "sid": "SM_INBOUND", "from": "+15552223333", "to": "+15550001111", "body": "Inbound hello",
                    "status": "received", "date_sent": "Sun, 10 Aug 2026 03:30:00 +0000", "num_media": "0",
                },
                {
                    "sid": "SM_OUTBOUND", "from": "+15550001111", "to": "+15552223333", "body": "Agent reply",
                    "status": "delivered", "date_sent": "Sun, 10 Aug 2026 03:31:00 +0000", "num_media": "0",
                },
            ]
        }
        with mock.patch.object(self.server, "_twilio_request_json", return_value=remote):
            result, status = self.server._sync_sms_history(force=True)
        self.assertEqual(200, status)
        self.assertEqual(2, result["imported"])
        threads = self.server._sms_threads()
        self.assertEqual(1, len(threads))
        self.assertEqual("+15552223333", threads[0]["phone"])
        self.assertEqual(2, threads[0]["messageCount"])
        self.assertEqual("outbound", threads[0]["lastType"])
        thread = self.server._sms_thread("+15552223333")
        self.assertEqual(["inbound", "outbound"], [item["type"] for item in thread["messages"]])
        self.assertEqual("2026-08-10T03:30:00+00:00", thread["messages"][0]["timestamp"])
        self.assertNotIn("twilioAuthToken", self.server._sms_status_payload())

    def test_user_and_agent_control_are_enforced_when_sending(self):
        phone = "+15554445555"
        calls = []

        def fake_request(url, data=None):
            calls.append((url, data))
            return {"sid": f"SM_{len(calls)}", "status": "queued"}

        with mock.patch.object(self.server, "_twilio_request_json", side_effect=fake_request):
            blocked, blocked_status = self.server._send_sms({"to": phone, "body": "manual", "sender": "user"})
            self.assertEqual(409, blocked_status)
            self.assertIn("Agent control", blocked["error"])

            self.server._set_sms_thread_mode(phone, "user")
            sent, sent_status = self.server._send_sms({"to": phone, "body": "manual", "sender": "user"})
            self.assertEqual(200, sent_status)
            self.assertEqual("intervention", sent["message"]["type"])

            self.server._set_sms_thread_mode(phone, "agent")
            denied, denied_status = self.server._send_sms({"to": phone, "body": "agent", "sender": "agent", "agentId": "wrong"})
            self.assertEqual(403, denied_status)
            self.assertIn("assigned SMS agent", denied["error"])

            sent, sent_status = self.server._send_sms({"to": phone, "body": "agent", "sender": "agent", "agentId": "sms-agent"})
            self.assertEqual(200, sent_status)
            self.assertEqual("outbound", sent["message"]["type"])
        self.assertEqual(2, len(calls))

    def test_owner_payload_is_roster_backed_and_credentials_are_redacted(self):
        status = self.server._sms_status_payload()
        self.assertTrue(status["enabled"])
        self.assertTrue(status["hasCredentials"])
        self.assertEqual("SMS Agent", status["ownerAgent"]["name"])
        serialized = json.dumps(status)
        self.assertNotIn("secret-test-token", serialized)
        self.assertNotIn("AC_TEST_ONLY", serialized)


if __name__ == "__main__":
    unittest.main()
