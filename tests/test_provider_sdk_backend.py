import hashlib
import asyncio
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock
from websockets.asyncio.server import serve


_SERVER_DATA_DIR = tempfile.TemporaryDirectory(prefix="vw-provider-sdk-tests-")
os.environ.setdefault("VW_DATA_DIR", _SERVER_DATA_DIR.name)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SERVER_ROOT = PROJECT_ROOT / "src" / "server"
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

import server  # noqa: E402
from providers.antigravity import AntigravityProvider  # noqa: E402
from providers.builtin import HermesOfficeProvider, OpenClawOfficeProvider  # noqa: E402
from providers.claude_code import ClaudeCodeProvider  # noqa: E402
from providers.codex import CodexAppServerClient, CodexProvider  # noqa: E402
from providers.hermes import HermesProvider  # noqa: E402
from providers.opencode import OpenCodeProvider  # noqa: E402
from providers.path_mapping import (  # noqa: E402
    infer_openclaw_host_home,
    join_host_path,
    map_host_path_to_container,
    normalize_host_path,
)
from providers.registry import ProviderManifest, ProviderRegistry  # noqa: E402


class _ManifestRegistry:
    def __init__(self, manifest):
        self._manifest = manifest

    def manifest(self, _provider_id):
        return self._manifest


class _DiscoveryRegistry:
    def __init__(self, rows):
        self.rows = rows

    def discover_agents(self):
        return [dict(row) for row in self.rows]


class ProviderSdkBackendTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.status = self.root / "status"
        self.status.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def _resource_manifest():
        return ProviderManifest(
            id="test-sdk",
            name="Test SDK",
            capabilities={"resourcesRead": True, "resourcesWrite": True, "skills": True},
            settings_schema={"version": 1, "configKey": "test", "sections": []},
            resource_schema=[
                {"id": "instructions", "label": "Instructions", "paths": ["AGENTS.md"], "readable": True, "writable": True},
                {"id": "docs", "label": "Documents", "paths": ["docs/**/*.md"], "readable": True, "writable": True, "deletable": True},
                {"id": "config", "label": "Managed config", "paths": [".codex/config.toml"], "readable": True, "writable": False},
                {"id": "secrets", "label": "Credentials", "paths": [".env", "auth.json"], "readable": False, "writable": False, "sensitive": True, "managedBy": "Connections"},
                {"id": "skills", "label": "Skills", "paths": [".agents/skills/**/SKILL.md"], "readable": True, "writable": True},
            ],
            skill_schema=[{
                "id": "agent",
                "label": "Project skills",
                "path": ".agents/skills",
                "scope": "agent",
                "runtimeActive": True,
                "writable": True,
                "format": "agentskills",
            }],
        )

    @staticmethod
    def _agent(workspace):
        return {
            "id": "test-agent",
            "statusKey": "test-agent",
            "providerKind": "test-sdk",
            "providerConnectionId": "default",
            "providerAgentId": "native-one",
            "profile": "native-one",
            "workspace": str(workspace),
            "available": True,
            "capabilities": {
                "resourcesRead": True,
                "resourcesWrite": True,
                "skills": True,
                "chat": True,
                "sessions": True,
                "sessionCreate": True,
                "sessionDelete": True,
                "sessionSwitch": True,
                "interrupt": True,
            },
        }

    def test_contract_11_all_six_builtin_manifests(self):
        registry = server._get_provider_registry()
        expected = {"openclaw", "hermes", "codex", "claude-code", "opencode", "antigravity"}
        manifests = {item["id"]: item for item in registry.manifests()}
        self.assertEqual(expected, set(manifests))
        self.assertTrue(registry.conformance()["ok"])
        for provider_id, manifest in manifests.items():
            self.assertEqual("1.1", manifest["contractVersion"], provider_id)
            self.assertTrue(manifest["connectionSchema"].get("transports"), provider_id)
            self.assertTrue(manifest["settingsSchema"], provider_id)
            self.assertTrue(manifest["creationSchema"].get("fields"), provider_id)
            self.assertTrue(manifest["resourceSchema"], provider_id)
            self.assertTrue(manifest["skillSchema"], provider_id)
            paths = [path for item in manifest["resourceSchema"] for path in item.get("paths", [])]
            self.assertFalse({"*", "**", "**/*"}.intersection(paths), provider_id)
        self.assertEqual(["network"], [item["kind"] for item in manifests["openclaw"]["connectionSchema"]["transports"]])
        self.assertEqual({"network", "process"}, {item["kind"] for item in manifests["hermes"]["connectionSchema"]["transports"]})
        for provider_id in {"codex", "claude-code", "opencode", "antigravity"}:
            self.assertEqual(["process"], [item["kind"] for item in manifests[provider_id]["connectionSchema"]["transports"]])
        self.assertTrue(manifests["codex"]["capabilities"]["approvals"])
        self.assertFalse(manifests["opencode"]["capabilities"]["approvals"])
        hermes_fields = server._provider_settings_field_map(
            server._get_provider_registry().manifest("hermes").settings_schema
        )
        self.assertIn("resourceRoot", hermes_fields)
        self.assertIn("resourceAccess", hermes_fields)
        connection_fields = {
            item.get("key") for item in hermes_fields["connections"].get("itemFields") or []
        }
        self.assertIn("resourcePath", connection_fields)
        self.assertIn("resourceAccess", connection_fields)

    def test_endpoint_mode_upgrade_preserves_remote_urls_and_enables_local_auto(self):
        self.assertEqual("custom", server._endpoint_mode("", "https://runtime.example.test"))
        self.assertEqual("auto", server._endpoint_mode("", "http://127.0.0.1:8642"))
        self.assertEqual("auto", server._endpoint_mode("", "http://host.docker.internal:8642"))
        self.assertEqual("host", server._endpoint_mode("host", "https://runtime.example.test"))

    def test_explicit_saved_settings_override_compose_bootstrap_defaults(self):
        config_path = self.root / "vw-config.json"
        config_path.write_text(json.dumps({
            "hermes": {"timeoutSec": 601, "apiUrl": "http://host.docker.internal:8642"},
            "_settingsOverrides": ["hermes.timeoutSec", "hermes.apiUrl"],
        }), encoding="utf-8")
        with mock.patch.object(server, "_resolve_vw_config_path", return_value=str(config_path)), \
             mock.patch.dict(os.environ, {
                 "VW_HERMES_TIMEOUT_SEC": "600",
                 "VW_HERMES_API_URL": "http://127.0.0.1:8642",
             }, clear=False):
            loaded = server._load_vw_config()
        self.assertEqual(601, loaded["hermes"]["timeoutSec"])
        self.assertEqual("http://host.docker.internal:8642", loaded["hermes"]["apiUrl"])

    def test_unedited_settings_continue_to_use_deployment_environment(self):
        config_path = self.root / "vw-config.json"
        config_path.write_text(json.dumps({"hermes": {"timeoutSec": 601}}), encoding="utf-8")
        with mock.patch.object(server, "_resolve_vw_config_path", return_value=str(config_path)), \
             mock.patch.dict(os.environ, {"VW_HERMES_TIMEOUT_SEC": "600"}, clear=False):
            loaded = server._load_vw_config()
        self.assertEqual(600, loaded["hermes"]["timeoutSec"])

    def test_settings_override_path_collection_ignores_internal_keys(self):
        paths = server._collect_settings_override_paths({
            "hermes": {"enabled": False, "connections": []},
            "_settingsOverrides": ["malicious.path"],
        })
        self.assertEqual({"hermes.enabled", "hermes.connections"}, paths)

    def test_custom_endpoint_mode_requires_a_url_in_native_and_sdk_settings(self):
        with self.assertRaises(ValueError):
            server._validate_native_endpoint_settings({"hermes": {"apiEndpointMode": "custom", "apiUrl": ""}})
        result = server._test_provider_settings({
            "providerId": "hermes",
            "values": {"apiEndpointMode": "custom", "apiUrl": ""},
        })
        self.assertFalse(result["ok"])
        self.assertIn("required", result["error"])

    def test_provider_settings_payload_exposes_transport_contract_without_secrets(self):
        payload = server._provider_settings_payload("hermes")
        provider = payload["providers"][0]
        self.assertEqual("hermes", provider["id"])
        self.assertEqual({"network", "process"}, {item["kind"] for item in provider["connectionSchema"]["transports"]})
        self.assertNotIn("apiKey", json.dumps(provider.get("health") or {}))

    def test_openclaw_authenticated_websocket_probe_uses_real_protocol(self):
        async def scenario():
            received = []

            async def handler(websocket):
                await websocket.send(json.dumps({"type": "challenge"}))
                connect = json.loads(await websocket.recv())
                received.append(connect)
                token = ((connect.get("params") or {}).get("auth") or {}).get("token")
                if token != "gateway-test-token":
                    await websocket.send(json.dumps({"id": connect.get("id"), "ok": False, "error": {"message": "Unauthorized"}}))
                    return
                await websocket.send(json.dumps({"id": connect.get("id"), "ok": True, "payload": {}}))
                request = json.loads(await websocket.recv())
                received.append(request)
                await websocket.send(json.dumps({"id": request.get("id"), "ok": True, "payload": {"status": "healthy", "version": "test"}}))

            async with serve(handler, "127.0.0.1", 0) as gateway:
                port = gateway.sockets[0].getsockname()[1]
                result = await server._gateway_rpc_call_at_async(
                    f"ws://127.0.0.1:{port}",
                    "gateway-test-token",
                    "health",
                    timeout=3,
                )
            return result, received

        result, received = asyncio.run(scenario())
        self.assertTrue(result["ok"])
        self.assertEqual("health", received[1]["method"])
        self.assertEqual("gateway-test-token", received[0]["params"]["auth"]["token"])

    def test_openclaw_resolution_falls_back_only_after_unreachable_probe(self):
        calls = []

        def probe(url, _token):
            calls.append(url)
            if "127.0.0.1" in url:
                return {"ok": False, "failureKind": "unreachable", "code": "endpoint_unreachable", "error": "offline"}
            return {"ok": True}

        original_resolver = server.PROVIDER_ENDPOINT_RESOLVER
        server.PROVIDER_ENDPOINT_RESOLVER = server.EndpointResolver(cache_ttl_sec=0)
        try:
            with mock.patch.object(server, "_read_gateway_config", return_value=("ws://127.0.0.1:18789", "token")), \
                 mock.patch.object(server, "_gateway_probe_result", side_effect=probe), \
                 mock.patch.dict(server.VW_CONFIG["openclaw"], {"endpointMode": "auto"}, clear=False):
                resolution, _token = server._resolve_openclaw_gateway_endpoint(force_probe=True)
        finally:
            server.PROVIDER_ENDPOINT_RESOLVER = original_resolver
        self.assertTrue(resolution["ok"])
        self.assertEqual("host", resolution["endpoint"]["location"])
        self.assertEqual(["ws://127.0.0.1:18789", "ws://host.docker.internal:18789"], calls)

    def test_provider_sdk_openclaw_test_uses_unsaved_endpoint_values(self):
        calls = []
        original_resolver = server.PROVIDER_ENDPOINT_RESOLVER
        server.PROVIDER_ENDPOINT_RESOLVER = server.EndpointResolver(cache_ttl_sec=0)
        try:
            with mock.patch.object(server, "_gateway_probe_result", side_effect=lambda url, _token: calls.append(url) or {"ok": True}), \
                 mock.patch.dict(server.VW_CONFIG["openclaw"], {"gatewayToken": "test-token"}, clear=False):
                result = server._test_provider_settings({
                    "providerId": "openclaw",
                    "values": {
                        "endpointMode": "host",
                        "gatewayUrl": "ws://127.0.0.1:18789",
                    },
                })
        finally:
            server.PROVIDER_ENDPOINT_RESOLVER = original_resolver
        self.assertTrue(result["ok"])
        self.assertEqual("host", result["endpointLocation"])
        self.assertEqual(["ws://host.docker.internal:18789"], calls)

    def test_provider_sdk_hermes_test_never_reuses_global_discovery_after_unsaved_failure(self):
        native = mock.Mock()
        native.test.return_value = {"ok": False, "error": "Linux CLI unavailable"}
        discover = mock.Mock(return_value=[{
            "id": "hermes-default",
            "profile": "default",
            "apiAvailable": True,
        }])
        manifest = ProviderManifest(id="hermes", name="Hermes", capabilities={"health": True})
        office = HermesOfficeProvider(native, {
            "config": {"hermes": {"apiKey": "unsaved-wrong-key"}},
            "hermesConnectionTest": lambda _config: {
                "ok": False,
                "code": "endpoint_authentication_failed",
                "error": "Endpoint authentication failed",
                "terminal": True,
            },
            "hermesDiscover": discover,
        }, manifest)

        result = office.test()

        self.assertFalse(result["ok"])
        self.assertEqual("endpoint_authentication_failed", result["code"])
        discover.assert_not_called()

    def test_provider_sdk_hermes_api_run_pins_one_endpoint_and_streams(self):
        progress = []

        class Client:
            base_url = "http://host.docker.internal:8642"

            @staticmethod
            def start_run(message, **kwargs):
                self.assertEqual("hello", message)
                self.assertEqual("session-one", kwargs["session_id"])
                return {"run_id": "run-one"}

            @staticmethod
            def stream_run_events(run_id, timeout_sec=None):
                self.assertEqual("run-one", run_id)
                self.assertGreater(timeout_sec, 0)
                yield {"event": "message.delta", "delta": "Hello"}
                yield {"event": "message.delta", "delta": " world"}
                yield {"event": "run.completed"}

        agent = {
            "id": "hermes-default",
            "statusKey": "hermes-default",
            "profile": "default",
            "providerAgentId": "default",
            "apiAvailable": True,
            "cliAvailable": False,
            "connectionModes": ["api"],
        }
        with mock.patch.object(server, "_hermes_api_client_for_profile", return_value=Client()), \
             mock.patch.object(server, "_get_hermes_session_id", return_value="session-one"), \
             mock.patch.object(server, "_set_hermes_session_id"), \
             mock.patch.object(server, "_remember_hermes_active_run") as remember, \
             mock.patch.object(server, "_clear_hermes_active_run") as clear:
            result = server._provider_hermes_send(agent, "hello", timeout_sec=10, on_progress=progress.append)
        self.assertTrue(result["ok"])
        self.assertEqual("Hello world", result["reply"])
        self.assertEqual("host", result["endpointLocation"])
        self.assertEqual("http://host.docker.internal:8642", remember.call_args.args[0]["apiEndpointUrl"])
        clear.assert_called_once_with("run-one")
        self.assertGreaterEqual(len(progress), 3)

    def test_provider_sdk_hermes_never_falls_back_after_ambiguous_submission(self):
        class Client:
            base_url = "http://host.docker.internal:8642"

            @staticmethod
            def start_run(*_args, **_kwargs):
                raise ConnectionResetError("response lost")

        agent = {
            "id": "hermes-default",
            "profile": "default",
            "apiAvailable": True,
            "cliAvailable": True,
            "connectionModes": ["api", "cli"],
        }
        with mock.patch.object(server, "_hermes_api_client_for_profile", return_value=Client()), \
             mock.patch.object(server, "_handle_hermes_chat") as cli_fallback:
            result = server._provider_hermes_send(agent, "do this")
        self.assertFalse(result["ok"])
        self.assertEqual("run_submission_ambiguous", result["code"])
        cli_fallback.assert_not_called()

    def test_hermes_api_capabilities_are_negotiated_without_filesystem_writes(self):
        features = {"session_resources": True, "skills_api": True, "model_options": True}
        endpoints = {
            "sessions": {"path": "/api/sessions"},
            "session_create": {"path": "/api/sessions"},
            "session_delete": {"path": "/api/sessions/{session_id}"},
            "session_messages": {"path": "/api/sessions/{session_id}/messages"},
            "skills": {"path": "/v1/skills"},
            "models": {"path": "/v1/models"},
        }
        caps = server._hermes_api_capability_overrides(features, endpoints)
        self.assertTrue(caps["sessions"])
        self.assertTrue(caps["sessionCreate"])
        self.assertTrue(caps["sessionDelete"])
        self.assertTrue(caps["sessionSwitch"])
        self.assertTrue(caps["skills"])
        self.assertTrue(caps["models"])
        for name in ("profileEdit", "resourcesRead", "resourcesWrite", "agentCreate", "agentDelete"):
            self.assertFalse(caps[name], name)

    def test_hermes_office_provider_preserves_api_only_capability_overrides(self):
        native = mock.Mock()
        manifest = ProviderManifest(id="hermes", name="Hermes", capabilities={"discover": True, "resourcesRead": True, "resourcesWrite": True, "skills": True})
        row = {
            "id": "hermes-remote", "profile": "remote", "apiAvailable": True,
            "workspace": "", "home": "",
            "capabilityOverrides": {"sessions": True, "skills": True, "resourcesRead": False, "resourcesWrite": False},
        }
        office = HermesOfficeProvider(native, {"hermesDiscover": lambda: [row]}, manifest)
        discovered = office.discover_agents()[0]
        self.assertTrue(discovered["capabilityOverrides"]["sessions"])
        self.assertTrue(discovered["capabilityOverrides"]["skills"])
        self.assertFalse(discovered["capabilityOverrides"]["resourcesRead"])
        self.assertFalse(discovered["capabilityOverrides"]["resourcesWrite"])

    def test_hermes_api_runtime_and_mounted_resources_work_without_local_cli(self):
        profile = self.root / "mounted-hermes"
        (profile / "workspace").mkdir(parents=True)
        (profile / "skills" / "review").mkdir(parents=True)
        (profile / "SOUL.md").write_text("# Mounted soul\n", encoding="utf-8")
        (profile / "IDENTITY.md").write_text("- **Name:** Mounted Hermes\n- **Emoji:** ⚕️\n", encoding="utf-8")
        (profile / ".env").write_text("TOKEN=NEVER_EXPOSE\n", encoding="utf-8")
        (profile / "workspace" / "note.md").write_text("before\n", encoding="utf-8")
        (profile / "skills" / "review" / "SKILL.md").write_text(
            "---\nname: review\ndescription: Review mounted work.\n---\n\n# Review\n",
            encoding="utf-8",
        )
        mounted = HermesProvider.inspect_mounted_profile("default", data_root=str(profile), access="read-write")
        self.assertTrue(mounted["readable"])
        self.assertTrue(mounted["writable"])

        native = HermesProvider(home_path=str(profile), binary=str(self.root / "missing-hermes"), enabled=False)
        row = {
            "id": "hermes-default",
            "profile": "default",
            "providerAgentId": "default",
            "apiAvailable": True,
            "cliAvailable": False,
            "workspace": str(profile),
            "home": str(profile),
            "resourcesReadable": True,
            "resourcesWritable": True,
            "resourceAccess": "read-write",
            "connectionModes": ["api"],
            "capabilityOverrides": {
                "sessions": True,
                "skills": True,
                "resourcesRead": False,
                "resourcesWrite": False,
                "agentCreate": False,
                "agentDelete": False,
            },
        }
        manifest = server._get_provider_registry().manifest("hermes")
        office = HermesOfficeProvider(native, {"hermesDiscover": lambda: [dict(row)]}, manifest)
        registry = ProviderRegistry()
        registry.register(office)
        agent = registry.discover_agents()[0]
        self.assertTrue(agent["capabilities"]["sessions"])
        self.assertTrue(agent["capabilities"]["resourcesRead"])
        self.assertTrue(agent["capabilities"]["resourcesWrite"])
        self.assertTrue(agent["capabilities"]["skills"])
        self.assertTrue(agent["capabilities"]["profileEdit"])
        self.assertFalse(agent["capabilities"]["agentCreate"])
        self.assertFalse(agent["capabilities"]["agentDelete"])

        with mock.patch.object(server, "_get_provider_registry", return_value=registry), \
             mock.patch.object(server, "_agent_record_for", return_value=agent), \
             mock.patch.object(server, "STATUS_DIR", str(self.status)):
            listed = server._handle_provider_resource({"agentId": agent["id"], "action": "list"})
            self.assertTrue(listed["ok"])
            self.assertIn("SOUL.md", {item["path"] for item in listed["files"]})
            self.assertNotIn(".env", {item["path"] for item in listed["files"]})
            opened = server._handle_provider_resource({"agentId": agent["id"], "action": "read", "path": "workspace/note.md"})
            self.assertEqual("before\n", opened["file"]["content"])
            saved = server._handle_provider_resource({
                "agentId": agent["id"],
                "action": "save",
                "path": "workspace/note.md",
                "content": "after\n",
                "expectedSha256": opened["file"]["sha256"],
            })
            self.assertTrue(saved["ok"])
            ok, skills, status = server.handle_agent_skills_list(agent["id"])
            self.assertTrue(ok)
            self.assertEqual(200, status)
            self.assertEqual(["review"], [item["name"] for item in skills["skills"]])

        updated = office.update_profile("default", {"name": "Updated Hermes", "emoji": "🧪"})
        self.assertTrue(updated["ok"])
        self.assertIn("Updated Hermes", (profile / "IDENTITY.md").read_text(encoding="utf-8"))

        read_only_row = {**row, "resourcesWritable": False, "resourceAccess": "read-only"}
        read_only_office = HermesOfficeProvider(native, {"hermesDiscover": lambda: [dict(read_only_row)]}, manifest)
        read_only_registry = ProviderRegistry()
        read_only_registry.register(read_only_office)
        read_only_agent = read_only_registry.discover_agents()[0]
        with mock.patch.object(server, "_get_provider_registry", return_value=read_only_registry), \
             mock.patch.object(server, "_agent_record_for", return_value=read_only_agent):
            ok, skills, status = server.handle_agent_skills_list(read_only_agent["id"])
            self.assertTrue(ok)
            self.assertEqual(200, status)
            self.assertFalse(skills["editable"])
            self.assertEqual(["review"], [item["name"] for item in skills["skills"]])
            ok, rejected, status = server.handle_agent_skill_save(
                read_only_agent["id"],
                {"name": "review", "content": (profile / "skills" / "review" / "SKILL.md").read_text(encoding="utf-8")},
            )
            self.assertFalse(ok)
            self.assertEqual(400, status)
            self.assertEqual("unsupported_provider", rejected["error"]["code"])

    def test_mounted_hermes_skills_support_official_category_layout(self):
        profile = self.root / "official-hermes-layout"
        skill_file = profile / "skills" / "software-development" / "review" / "SKILL.md"
        skill_file.parent.mkdir(parents=True)
        skill_file.write_text(
            "---\nname: review\ndescription: Review mounted work.\n---\n\n# Review\n",
            encoding="utf-8",
        )
        agent = {
            "id": "hermes-default",
            "statusKey": "hermes-default",
            "providerKind": "hermes",
            "providerAgentId": "default",
            "profile": "default",
            "workspace": str(profile),
            "home": str(profile),
            "apiAvailable": True,
            "capabilities": {"skills": True, "resourcesRead": True, "resourcesWrite": True},
        }
        with mock.patch.object(server, "_agent_record_for", return_value=agent), \
             mock.patch.object(server, "STATUS_DIR", str(self.status)):
            ok, listed, status = server.handle_agent_skills_list(agent["id"])
            self.assertTrue(ok)
            self.assertEqual(200, status)
            self.assertEqual(["software-development/review"], [item["name"] for item in listed["skills"]])
            self.assertEqual("software-development", listed["skills"][0]["category"])
            self.assertIn("# Review", listed["skills"][0]["content"])
            ok, saved, status = server.handle_agent_skill_save(agent["id"], {
                "name": "software-development/review",
                "content": "---\nname: review\ndescription: Updated mounted skill.\n---\n\n# Updated\n",
                "expectedSha256": listed["skills"][0]["sha256"],
            })
            self.assertTrue(ok)
            self.assertEqual(200, status)
            self.assertTrue(saved["ok"])
        self.assertIn("# Updated", skill_file.read_text(encoding="utf-8"))
        escaped, escaped_name = server._skill_file_for(str(profile / "skills"), "../outside")
        self.assertIsNone(escaped)
        self.assertEqual("", escaped_name)

    def test_hermes_mounted_profile_policy_and_path_safety(self):
        data_root = self.root / "hermes-data"
        named = data_root / "profiles" / "coder"
        named.mkdir(parents=True)
        default_mount = HermesProvider.inspect_mounted_profile("default", data_root=str(data_root))
        named_mount = HermesProvider.inspect_mounted_profile("coder", data_root=str(data_root))
        self.assertEqual(str(data_root), default_mount["path"])
        self.assertEqual(str(named), named_mount["path"])
        self.assertTrue(named_mount["writable"])

        read_only = HermesProvider.inspect_mounted_profile("coder", data_root=str(data_root), access="read-only")
        self.assertTrue(read_only["readable"])
        self.assertFalse(read_only["writable"])
        self.assertEqual("read-only", read_only["access"])
        disabled = HermesProvider.inspect_mounted_profile("coder", data_root=str(data_root), access="disabled")
        self.assertFalse(disabled["available"])
        escaped = HermesProvider.inspect_mounted_profile("..", data_root=str(data_root))
        self.assertFalse(escaped["available"])
        windows = HermesProvider.inspect_mounted_profile("default", data_root=r"C:\\Users\\Example\\.hermes")
        self.assertFalse(windows["available"])
        explicit = HermesProvider.inspect_mounted_profile("connection-id", profile_path=str(named))
        self.assertEqual(str(named), explicit["path"])
        outside = self.root / "outside-hermes-profile"
        outside.mkdir()
        os.symlink(outside, data_root / "profiles" / "escape")
        symlink_escape = HermesProvider.inspect_mounted_profile("escape", data_root=str(data_root))
        self.assertFalse(symlink_escape["available"])

        statvfs = mock.Mock(f_flag=getattr(os, "ST_RDONLY", 1))
        with mock.patch("providers.hermes.os.statvfs", return_value=statvfs):
            filesystem_read_only = HermesProvider.inspect_mounted_profile("coder", data_root=str(data_root), access="read-write")
        self.assertTrue(filesystem_read_only["readable"])
        self.assertFalse(filesystem_read_only["writable"])
        self.assertEqual("read-only", filesystem_read_only["access"])
        self.assertEqual("read-write", filesystem_read_only["requestedAccess"])

    def test_hermes_api_only_sessions_and_skills_use_rest_surface(self):
        calls = []

        class Client:
            @staticmethod
            def list_sessions(limit=40):
                calls.append(("list", limit))
                return {"data": [{"id": "remote-one", "title": "Remote", "preview": "hello", "last_active": 123, "message_count": 2}]}

            @staticmethod
            def create_session(**kwargs):
                calls.append(("create", kwargs))
                return {"session": {"id": "remote-two", "title": kwargs.get("title") or ""}}

            @staticmethod
            def session_messages(session_id, **kwargs):
                calls.append(("messages", session_id, kwargs))
                return {"data": [
                    {"id": "m1", "session_id": session_id, "role": "user", "content": "Question", "timestamp": 1},
                    {"id": "m2", "session_id": session_id, "role": "assistant", "content": [{"type": "text", "text": "Answer"}], "timestamp": 2},
                ]}

            @staticmethod
            def delete_session(session_id):
                calls.append(("delete", session_id))
                return {"deleted": True, "id": session_id}

            @staticmethod
            def skills():
                calls.append(("skills",))
                return {"data": [{"name": "research", "description": "Research sources", "category": "work"}]}

        agent = {
            "id": "hermes-remote", "statusKey": "hermes-remote", "providerKind": "hermes",
            "providerConnectionId": "remote", "providerAgentId": "remote", "profile": "remote",
            "apiAvailable": True, "cliAvailable": False, "workspace": "", "home": "",
            "capabilities": {
                "sessions": True, "sessionCreate": True, "sessionDelete": True,
                "sessionSwitch": True, "skills": True, "resourcesRead": False,
                "resourcesWrite": False,
            },
        }
        agent_ref = {"agentId": "hermes-remote", "providerKind": "hermes", "profile": "remote", "name": "Remote Hermes"}
        with mock.patch.object(server, "_chat_sessions_agent", return_value=agent_ref), \
             mock.patch.object(server, "_agent_record_for", return_value=agent), \
             mock.patch.object(server, "_hermes_api_client_for_agent", return_value=Client()), \
             mock.patch.object(server, "_live_agent_virtual_session_row", return_value=None), \
             mock.patch.object(server, "_get_hermes_session_id", return_value="remote-one"), \
             mock.patch.object(server, "_save_hermes_state"):
            listed, status = server.handle_chat_sessions_list("hermes-remote")
            self.assertEqual(200, status)
            self.assertEqual("api", listed["providerPath"])
            self.assertEqual("remote-one", listed["sessions"][0]["id"])

            created, status = server.handle_chat_session_create("hermes-remote", {"title": "New remote chat"})
            self.assertEqual(200, status)
            self.assertEqual("remote-two", created["sessionId"])

            switched, status = server.handle_chat_session_switch("hermes-remote", "remote-one")
            self.assertEqual(200, status)
            self.assertEqual(["Question", "Answer"], [item["text"] for item in switched["messages"]])

            deleted, status = server.handle_chat_session_delete("hermes-remote", "remote-one")
            self.assertEqual(200, status)
            self.assertTrue(deleted["deleted"])

            ok, skills, status = server.handle_agent_skills_list("hermes-remote")
            self.assertTrue(ok)
            self.assertEqual(200, status)
            self.assertFalse(skills["editable"])
            self.assertEqual("research", skills["skills"][0]["name"])

        self.assertEqual(["list", "create", "messages", "delete", "skills"], [call[0] for call in calls])

    def test_stable_identity_dedup_includes_connection(self):
        class Provider:
            manifest = ProviderManifest(
                id="multi",
                name="Multi",
                capabilities={"discover": True},
                settings_schema={"version": 1, "configKey": "multi", "sections": [{"fields": []}]},
            )

            @staticmethod
            def discover_agents():
                return [
                    {"id": "one", "providerAgentId": "main", "providerConnectionId": "east"},
                    {"id": "duplicate", "providerAgentId": "main", "providerConnectionId": "east"},
                    {"id": "two", "providerAgentId": "main", "providerConnectionId": "west"},
                ]

        registry = ProviderRegistry()
        registry.register(Provider())
        rows = registry.discover_agents()
        self.assertEqual(2, len(rows))
        self.assertEqual({("east", "main"), ("west", "main")}, {(row["providerConnectionId"], row["providerAgentId"]) for row in rows})

    def test_extension_discovery_supports_virtual_world_prefix(self):
        extension_dir = self.root / "extensions"
        extension_dir.mkdir()
        (extension_dir / "vw_provider_example.py").write_text(
            "from providers.registry import ProviderManifest\n"
            "class P:\n"
            "  manifest=ProviderManifest(id='extension-test',name='Extension Test',capabilities={'health':True},settings_schema={'version':1,'configKey':'extension-test','sections':[{'fields':[]}]})\n"
            "  def test(self): return {'ok':True}\n"
            "def build_provider(context): return P()\n",
            encoding="utf-8",
        )
        registry = ProviderRegistry()
        registry.load_extensions([str(extension_dir)])
        self.assertIsNotNone(registry.get("extension-test"))
        self.assertEqual([], registry.conformance()["loadErrors"])

    def test_settings_redaction_secret_preservation_and_validation(self):
        redacted = server._redact_provider_secrets({"token": "TOP_SECRET", "nested": {"apiKey": "KEY"}})
        encoded = json.dumps(redacted)
        self.assertNotIn("TOP_SECRET", encoded)
        self.assertNotIn("KEY", encoded)
        self.assertTrue(redacted["tokenConfigured"])
        with mock.patch.object(server, "VW_CONFIG", {
            **server.VW_CONFIG,
            "openclaw": {**server.VW_CONFIG["openclaw"], "gatewayToken": "existing-token"},
            "hermes": {**server.VW_CONFIG["hermes"], "connections": [{"id": "one", "name": "One", "apiUrl": "http://127.0.0.1:1", "apiKey": "existing-key", "emoji": "⚕️", "role": "Hermes", "enabled": True}]},
        }):
            _manifest, _key, clean = server._validated_provider_settings("openclaw", {"gatewayToken": ""})
            self.assertEqual("existing-token", clean["gatewayToken"])
            hermes_field = server._provider_settings_field_map(server._get_provider_registry().manifest("hermes").settings_schema)["connections"]
            connections = server._validate_provider_setting(
                hermes_field,
                [{"id": "one", "name": "One", "apiUrl": "http://127.0.0.1:1", "apiKey": "", "emoji": "⚕️", "role": "Hermes", "enabled": True}],
                server.VW_CONFIG["hermes"]["connections"],
                "connections",
            )
            self.assertEqual("existing-key", connections[0]["apiKey"])
        with self.assertRaises(ValueError):
            server._validate_provider_setting({"type": "url"}, "file:///etc/passwd", None, "url")

    def test_public_health_omits_provider_account_and_runtime_internals(self):
        health = server._public_provider_health({
            "ok": True,
            "installed": True,
            "version": "1.2.3",
            "accounts": {"personal-account": {"token": "secret"}},
            "channels": {"private-channel": {"configured": True}},
            "agents": [{"agentId": "private-agent"}],
            "binary": "/private/provider/bin",
        })
        encoded = json.dumps(health)
        self.assertTrue(health["ok"])
        self.assertEqual("1.2.3", health["version"])
        self.assertNotIn("personal-account", encoded)
        self.assertNotIn("private-agent", encoded)
        self.assertNotIn("/private/provider", encoded)

    def test_hermes_long_profile_identity_is_not_merged_with_model_column(self):
        home = self.root / "hermes-long-profile"
        long_profile = "vw-sdk-e2e-long-provider-profile"
        (home / "profiles" / long_profile).mkdir(parents=True)
        output = (
            " Profile          Model                        Gateway      Alias        Distribution\n"
            " ───────────────    ───────────────────────────    ───────────    ───────────    ────────────────────\n"
            " ◆default         gpt-5.6-sol                  stopped      —            —\n"
            f"  {long_profile} gpt-5.6-sol                  stopped      —            —\n"
        )
        provider = HermesProvider(home_path=str(home), binary="/bin/true", enabled=True)
        completed = mock.Mock(returncode=0, stdout=output, stderr="")
        with mock.patch("providers.hermes.subprocess.run", return_value=completed):
            profiles = provider._list_profiles()
        row = next(item for item in profiles if item["profile"] == long_profile)
        self.assertEqual("gpt-5.6-sol", row["model"])
        self.assertNotIn("gpt-5.6-sol", row["profile"])

    def test_windows_openclaw_paths_map_to_linux_mount(self):
        container_root = self.root / "openclaw"
        (container_root / "workspace").mkdir(parents=True)
        (container_root / "workspace-andy").mkdir()
        self.assertEqual(r"C:\Users\ExampleUser\.openclaw", normalize_host_path(r"C:\Users\ExampleUser\.openclaw\."))
        self.assertEqual(r"C:\Users\ExampleUser\.openclaw\workspace\uploads", join_host_path(r"C:\Users\ExampleUser\.openclaw", "workspace", "uploads"))
        self.assertEqual(
            str(container_root / "workspace"),
            map_host_path_to_container(
                r"C:\Users\ExampleUser\.openclaw\workspace",
                host_root=r"C:\Users\ExampleUser\.openclaw",
                container_root=str(container_root),
            ),
        )
        self.assertEqual(
            str(container_root / "workspace-andy"),
            map_host_path_to_container(
                r"C:\.openclaw\workspace-andy",
                host_root=r"C:\Users\ExampleUser\.openclaw",
                container_root=str(container_root),
            ),
        )
        self.assertEqual(
            r"C:\Users\ExampleUser\.openclaw",
            infer_openclaw_host_home([{"id": "main", "workspace": r"C:\Users\ExampleUser\.openclaw\workspace"}]),
        )
        self.assertNotIn("C:\\", map_host_path_to_container(
            r"C:\Users\ExampleUser\.openclaw\workspace",
            host_root=r"C:\Users\ExampleUser\.openclaw",
            container_root=str(container_root),
        ))

    def test_openclaw_provider_reads_windows_workspace_identities_from_mount(self):
        container_root = self.root / "mounted-openclaw"
        main_workspace = container_root / "workspace"
        andy_workspace = container_root / "workspace-andy"
        main_workspace.mkdir(parents=True)
        andy_workspace.mkdir()
        (main_workspace / "IDENTITY.md").write_text("- **Name:** News\n- **Emoji:** 📰\n", encoding="utf-8")
        (andy_workspace / "IDENTITY.md").write_text("- **Name:** Andy\n- **Emoji:** 🛠️\n", encoding="utf-8")
        (container_root / "openclaw.json").write_text(json.dumps({
            "agents": {"list": [
                {"id": "main", "workspace": r"C:\Users\ExampleUser\.openclaw\workspace"},
                {"id": "andy", "workspace": r"C:\.openclaw\workspace-andy"},
            ]},
        }), encoding="utf-8")
        provider = OpenClawOfficeProvider({
            "workspaceBase": str(container_root),
            "gatewayWorkspaceBase": r"C:\Users\ExampleUser\.openclaw",
        })
        rows = {row["id"]: row for row in provider.discover_agents()}
        self.assertEqual("News", rows["main"]["name"])
        self.assertEqual("Andy", rows["andy"]["name"])
        self.assertEqual(str(main_workspace), rows["main"]["workspace"])
        self.assertEqual(str(andy_workspace), rows["andy"]["workspace"])

    def test_hermes_rejects_invalid_windows_and_directory_binary_mounts(self):
        home = self.root / "hermes-invalid-bin"
        home.mkdir()
        binary_directory = self.root / "hermes-directory"
        binary_directory.mkdir()
        directory_provider = HermesProvider(home_path=str(home), binary=str(binary_directory), enabled=True)
        self.assertFalse(directory_provider.is_available())
        self.assertIn("not a file", directory_provider.test()["error"])
        self.assertEqual([], directory_provider.discover_agents())

        windows_binary = self.root / "hermes.exe"
        windows_binary.write_bytes(b"MZ\x00\x00")
        windows_binary.chmod(0o755)
        windows_provider = HermesProvider(home_path=str(home), binary=str(windows_binary), enabled=True)
        self.assertFalse(windows_provider.is_available())
        self.assertIn("Windows Hermes", windows_provider.test()["error"])

    def test_gateway_info_proxy_hides_operator_credentials_and_rpc_is_whitelisted(self):
        with mock.patch.object(server, "_read_gateway_config", return_value=("ws://host.docker.internal:18789", "operator-secret")), \
             mock.patch.object(server, "OPENCLAW_BROWSER_TRANSPORT", "proxy"):
            payload = server._gateway_info_payload()
        self.assertEqual("proxy", payload["transport"])
        self.assertEqual("", payload["gatewayUrl"])
        self.assertNotIn("token", payload)
        self.assertTrue(payload["tokenConfigured"])

        with mock.patch.object(server, "_gateway_rpc_call", return_value={"ok": True, "payload": {"messages": []}}) as gateway_call:
            result = server._handle_openclaw_proxy_rpc({"method": "chat.history", "params": {"sessionKey": "agent:main:main", "limit": 9000}})
        self.assertTrue(result["ok"])
        self.assertEqual(1000, gateway_call.call_args.args[1]["limit"])
        self.assertTrue(gateway_call.call_args.kwargs["preserve_envelope"])
        denied = server._handle_openclaw_proxy_rpc({"method": "agents.delete", "params": {"agentId": "main"}})
        self.assertFalse(denied["ok"])
        self.assertEqual(403, denied["_status"])
        with mock.patch.object(server, "_gateway_rpc_call", return_value={
            "ok": False,
            "error": {"message": "Unknown session", "code": "not_found"},
            "_gatewayResponse": True,
        }):
            gateway_error = server._handle_openclaw_proxy_rpc({"method": "sessions.describe", "params": {"key": "missing"}})
        self.assertFalse(gateway_error["ok"])
        self.assertNotIn("_status", gateway_error)
        self.assertNotIn("_gatewayResponse", gateway_error)

        with mock.patch.object(server, "_read_gateway_config", return_value=("ws://127.0.0.1:18789", "legacy-secret")), \
             mock.patch.object(server, "OPENCLAW_BROWSER_TRANSPORT", "direct"):
            direct = server._gateway_info_payload()
        self.assertEqual("legacy-secret", direct["token"])
        self.assertEqual("ws://127.0.0.1:18789", direct["gatewayUrl"])

    def test_hermes_host_api_is_discovered_without_linux_cli(self):
        class ApiClient:
            def __init__(self, base_url=None, api_key=None, timeout_sec=None):
                self.base_url = base_url

            @staticmethod
            def health():
                return {"status": "healthy"}

            @staticmethod
            def capabilities():
                return {"model": "hermes-model", "features": {"run_submission": True, "run_events_sse": True}}

        provider = mock.Mock()
        provider.discover_agents.return_value = []
        config = {
            **server.VW_CONFIG,
            "hermes": {
                **server.VW_CONFIG["hermes"],
                "localProfilesEnabled": False,
                "resourceRoot": str(self.root / "unmounted-hermes"),
                "resourceAccess": "disabled",
                "apiUrl": "http://host.docker.internal:8642",
                "apiKey": "server-only-key",
                "connections": [],
            },
        }
        with mock.patch.object(server, "VW_CONFIG", config), \
             mock.patch.object(server, "HERMES_ENABLED", True), \
             mock.patch.object(server, "_hermes_provider", return_value=provider), \
             mock.patch.object(server, "HermesApiClient", ApiClient):
            rows = server._discover_hermes_agents()
        self.assertEqual(1, len(rows))
        self.assertEqual("hermes-default", rows[0]["id"])
        self.assertTrue(rows[0]["apiAvailable"])
        self.assertFalse(rows[0]["cliAvailable"])
        self.assertEqual(["api"], rows[0]["connectionModes"])
        self.assertEqual("", rows[0]["workspace"])

        connection_config = {
            **config,
            "hermes": {
                **config["hermes"],
                "connections": [{
                    "id": "windows",
                    "apiUrl": "http://host.docker.internal:8643",
                    "apiKey": "connection-key",
                    "enabled": True,
                }],
            },
        }
        with mock.patch.object(server, "VW_CONFIG", connection_config):
            api_config = server._hermes_profile_api_config("windows")
        self.assertEqual("http://host.docker.internal:8643", api_config["url"])
        self.assertEqual("connection-key", api_config["key"])
        self.assertFalse(api_config["autoStart"])

        native = mock.Mock()
        native.test.return_value = {"ok": False, "error": "Linux CLI unavailable", "agents": []}
        manifest = ProviderManifest(id="hermes", name="Hermes", capabilities={"health": True})
        office = HermesOfficeProvider(native, {"hermesDiscover": lambda: rows}, manifest)
        health = office.test()
        self.assertTrue(health["ok"])
        self.assertEqual("api", health["transport"])

    def test_hermes_api_discovery_maps_default_named_and_explicit_profile_mounts(self):
        data_root = self.root / "hermes-api-data"
        explicit = self.root / "external-profile"
        (data_root / "profiles" / "coder").mkdir(parents=True)
        explicit.mkdir()
        config = {
            **server.VW_CONFIG,
            "hermes": {
                **server.VW_CONFIG["hermes"],
                "enabled": True,
                "localProfilesEnabled": False,
                "resourceRoot": str(data_root),
                "resourceAccess": "read-write",
                "preferApi": True,
                "connections": [
                    {"id": "coder", "name": "Coder", "apiUrl": "http://hermes:8643", "apiKey": "key", "enabled": True, "resourceAccess": "inherit"},
                    {"id": "alias", "name": "Alias", "apiUrl": "http://hermes:8644", "apiKey": "key", "enabled": True, "resourcePath": str(explicit), "resourceAccess": "read-only"},
                ],
            },
        }
        resolution = {
            "ok": True,
            "endpoint": {"url": "http://hermes:8642", "location": "custom"},
            "probe": {
                "model": "hermes-model",
                "features": {"run_submission": True, "run_events_sse": True, "skills_api": True},
                "endpoints": {"skills": {"path": "/v1/skills"}},
            },
        }
        with mock.patch.object(server, "VW_CONFIG", config), \
             mock.patch.object(server, "HERMES_ENABLED", True), \
             mock.patch.object(server, "_resolve_hermes_api_endpoint", return_value=(resolution, {})):
            rows = {row["profile"]: row for row in server._discover_hermes_agents()}
        self.assertEqual(str(data_root), rows["default"]["workspace"])
        self.assertEqual(str(data_root / "profiles" / "coder"), rows["coder"]["workspace"])
        self.assertTrue(rows["coder"]["resourcesWritable"])
        self.assertEqual(str(explicit), rows["alias"]["workspace"])
        self.assertTrue(rows["alias"]["resourcesReadable"])
        self.assertFalse(rows["alias"]["resourcesWritable"])

    def test_settings_save_dispatch_preserves_existing_secret_without_rewriting_it(self):
        config = {
            **server.VW_CONFIG,
            "openclaw": {**server.VW_CONFIG["openclaw"], "gatewayToken": "keep-me"},
        }
        captured = {}

        def save_update(patch):
            captured.update(patch)
            return {"ok": True}, 200

        with mock.patch.object(server, "VW_CONFIG", config), \
             mock.patch.object(server, "_save_vw_config_update", side_effect=save_update), \
             mock.patch.object(server, "_refresh_agent_roster_after_create"):
            result = server._save_provider_settings({"providerId": "openclaw", "values": {"gatewayToken": ""}})
        self.assertTrue(result["ok"])
        self.assertNotIn("gatewayToken", captured["openclaw"])

    def test_blank_native_secret_preserves_environment_backed_value(self):
        existing = {"openclaw": {"gatewayToken": ""}}
        incoming = {"openclaw": {"gatewayToken": ""}}
        config = {**server.VW_CONFIG, "openclaw": {**server.VW_CONFIG["openclaw"], "gatewayToken": "environment-secret"}}
        with mock.patch.object(server, "VW_CONFIG", config):
            server._preserve_secret_updates(existing, incoming)
        self.assertNotIn("gatewayToken", incoming["openclaw"])

    def test_discovery_cache_retains_offline_and_forget_is_non_destructive(self):
        cache = self.status / "provider-discovery-cache.json"
        live = {
            "id": "test-agent",
            "statusKey": "test-agent",
            "providerKind": "test-sdk",
            "providerConnectionId": "east",
            "providerAgentId": "native-one",
            "profile": "native-one",
            "name": "Native One",
            "workspace": str(self.root / "native-workspace"),
            "capabilities": {"chat": True},
        }
        native_marker = Path(live["workspace"]) / "native.txt"
        native_marker.parent.mkdir()
        native_marker.write_text("keep", encoding="utf-8")
        with mock.patch.object(server, "_PROVIDER_DISCOVERY_CACHE_FILE", str(cache)), \
             mock.patch.object(server, "_get_provider_registry", return_value=_DiscoveryRegistry([live])):
            first = server._discover_provider_roster()
        self.assertTrue(first[0]["available"])
        with mock.patch.object(server, "_PROVIDER_DISCOVERY_CACHE_FILE", str(cache)), \
             mock.patch.object(server, "_get_provider_registry", return_value=_DiscoveryRegistry([])):
            second = server._discover_provider_roster()
            self.assertFalse(second[0]["available"])
            server._forget_provider_agent("test-sdk", "east", "native-one")
            self.assertEqual([], server._load_provider_discovery_cache())
        self.assertEqual("keep", native_marker.read_text(encoding="utf-8"))

    def test_native_delete_cleanup_removes_world_state_and_backups_only_for_target(self):
        meta_file = self.root / "world-meta.json"
        backup_file = self.root / "world-meta.json.bak"
        target = "opencode:sdk-delete-target"
        keep = "opencode:keep-agent"
        meta_file.write_text(json.dumps({
            "agentProfiles": {target: {"residentProfile": {}}, keep: {"residentProfile": {}}},
            "agentLife": {"liveModeLoop": {"agents": {target: {"enabled": True}, keep: {"enabled": True}}}},
            "agentRelationships": {
                f"{target}::{keep}": {"agentId": target, "otherAgentId": keep},
                "one::two": {"agentId": "one", "otherAgentId": "two"},
            },
        }), encoding="utf-8")
        target_backup = self.status / "provider-resource-backups" / "opencode-sdk-delete-target"
        keep_backup = self.status / "provider-resource-backups" / "opencode-keep-agent"
        target_backup.mkdir(parents=True)
        keep_backup.mkdir(parents=True)
        (target_backup / "revision.md").write_text("remove", encoding="utf-8")
        (keep_backup / "revision.md").write_text("keep", encoding="utf-8")
        agent = {
            "id": target,
            "statusKey": target,
            "providerKind": "opencode",
            "providerAgentId": "sdk-delete-target",
        }

        with mock.patch.object(server, "META_FILE", str(meta_file)), \
             mock.patch.object(server, "META_BACKUP_FILE", str(backup_file)), \
             mock.patch.object(server, "STATUS_DIR", str(self.status)), \
             mock.patch.object(server, "_WORLD_META_FAST_CACHE", {"sig": None, "data": None, "digest": None}):
            cleaned = server._cleanup_deleted_provider_agent_state(agent, requested_agent_id=target)

        saved = json.loads(meta_file.read_text(encoding="utf-8"))
        self.assertNotIn(target, saved["agentProfiles"])
        self.assertIn(keep, saved["agentProfiles"])
        self.assertNotIn(target, saved["agentLife"]["liveModeLoop"]["agents"])
        self.assertIn(keep, saved["agentLife"]["liveModeLoop"]["agents"])
        self.assertNotIn(f"{target}::{keep}", saved["agentRelationships"])
        self.assertIn("one::two", saved["agentRelationships"])
        self.assertFalse(target_backup.exists())
        self.assertTrue(keep_backup.exists())
        self.assertEqual([target], cleaned["residentProfilesRemoved"])
        self.assertEqual([], cleaned["errors"])

    def test_resources_preview_sha_backup_restore_and_security(self):
        workspace = self.root / "workspace"
        (workspace / "docs").mkdir(parents=True)
        (workspace / ".codex").mkdir()
        (workspace / "AGENTS.md").write_text("one\n", encoding="utf-8")
        (workspace / "docs" / "note.md").write_text("safe\n", encoding="utf-8")
        (workspace / ".codex" / "config.toml").write_text("managed=true\n", encoding="utf-8")
        (workspace / ".env").write_text("TOKEN=TOP_SECRET\n", encoding="utf-8")
        agent = self._agent(workspace)
        registry = _ManifestRegistry(self._resource_manifest())
        with mock.patch.object(server, "_get_provider_registry", return_value=registry), \
             mock.patch.object(server, "STATUS_DIR", str(self.status)):
            opened = server._read_provider_resource(agent, "AGENTS.md")
            self.assertTrue(opened["ok"])
            original_sha = opened["file"]["sha256"]
            preview = server._preview_provider_resource(agent, "AGENTS.md", "two\n")
            self.assertIn("+two", preview["diff"])
            stale = server._save_provider_resource(agent, "AGENTS.md", "two\n", expected_sha="stale")
            self.assertEqual(409, stale["_status"])
            saved = server._save_provider_resource(agent, "AGENTS.md", "two\n", expected_sha=original_sha)
            self.assertTrue(saved["backupId"])
            revisions = server._provider_resource_revisions(agent, "AGENTS.md")
            self.assertEqual(1, len(revisions["revisions"]))
            restored = server._restore_provider_resource(agent, "AGENTS.md", saved["backupId"], expected_sha=saved["sha256"])
            self.assertTrue(restored["ok"])
            self.assertEqual("one\n", (workspace / "AGENTS.md").read_text(encoding="utf-8"))
            hidden = server._read_provider_resource(agent, ".env")
            self.assertFalse(hidden["ok"])
            self.assertNotIn("TOP_SECRET", json.dumps(hidden))
            read_only = server._save_provider_resource(agent, ".codex/config.toml", "changed=true\n")
            self.assertFalse(read_only["ok"])
            self.assertFalse(server._read_provider_resource(agent, "../outside.md")["ok"])
            self.assertFalse(server._read_provider_resource(agent, "/etc/passwd")["ok"])
            outside = self.root / "outside"
            outside.mkdir()
            os.symlink(outside, workspace / "docs" / "escape")
            escaped = server._save_provider_resource(agent, "docs/escape/stolen.md", "no", create=True)
            self.assertFalse(escaped["ok"])

    def test_resources_are_safe_under_300_concurrent_reads(self):
        workspace = self.root / "concurrent"
        workspace.mkdir()
        content = "stable\n"
        (workspace / "AGENTS.md").write_text(content, encoding="utf-8")
        agent = self._agent(workspace)
        registry = _ManifestRegistry(self._resource_manifest())
        with mock.patch.object(server, "_get_provider_registry", return_value=registry):
            with ThreadPoolExecutor(max_workers=24) as pool:
                rows = list(pool.map(lambda _index: server._read_provider_resource(agent, "AGENTS.md"), range(300)))
        self.assertTrue(all(row.get("ok") for row in rows))
        expected = hashlib.sha256(content.encode("utf-8")).hexdigest()
        self.assertEqual({expected}, {row["file"]["sha256"] for row in rows})

    def test_agentskills_validation_confinement_backups_and_restore(self):
        workspace = self.root / "skills-workspace"
        (workspace / ".agents" / "skills").mkdir(parents=True)
        agent = self._agent(workspace)
        registry = _ManifestRegistry(self._resource_manifest())
        valid = "---\nname: review\ndescription: Review changes safely.\n---\n\n# Review\n"
        updated = valid + "\nUpdated\n"
        with mock.patch.object(server, "_get_provider_registry", return_value=registry), \
             mock.patch.object(server, "_agent_record_for", return_value=agent), \
             mock.patch.object(server, "STATUS_DIR", str(self.status)):
            ok, rejected, status = server.handle_agent_skill_save("test-agent", {"name": "bad", "content": "# no frontmatter\n"})
            self.assertFalse(ok)
            self.assertEqual(400, status)
            ok, created, _status = server.handle_agent_skill_save("test-agent", {"name": "review", "content": valid})
            self.assertTrue(ok)
            ok, changed, _status = server.handle_agent_skill_save("test-agent", {"name": "review", "content": updated})
            self.assertTrue(ok)
            self.assertTrue(changed["backupId"])
            ok, conflict, conflict_status = server.handle_agent_skill_save("test-agent", {"name": "review", "content": updated + "stale\n", "expectedSha256": "stale"})
            self.assertFalse(ok)
            self.assertEqual(409, conflict_status)
            self.assertEqual("sha_conflict", conflict["error"]["code"])
            ok, revisions, _status = server.handle_agent_skill_revisions("test-agent", "review")
            self.assertTrue(ok)
            self.assertEqual(1, len(revisions["revisions"]))
            current_sha = hashlib.sha256(updated.encode("utf-8")).hexdigest()
            ok, restored, _status = server.handle_agent_skill_restore("test-agent", {"name": "review", "backupId": changed["backupId"], "expectedSha256": current_sha})
            self.assertTrue(ok)
            self.assertEqual(valid, (workspace / ".agents" / "skills" / "review" / "SKILL.md").read_text(encoding="utf-8"))
            outside = self.root / "outside-skills"
            outside.mkdir()
            os.symlink(outside, workspace / ".agents" / "skills" / "escape")
            ok, escaped, _status = server.handle_agent_skill_save("test-agent", {"name": "escape", "content": valid.replace("name: review", "name: escape")})
            self.assertFalse(ok)
            self.assertFalse(any(outside.iterdir()))
            ok, deleted, _status = server.handle_agent_skill_delete("test-agent", "review")
            self.assertTrue(ok)
            self.assertTrue(deleted["backupId"])

    def test_manifest_creation_fields_map_to_native_signature_without_ui_provider_branches(self):
        captured = {}

        class Provider:
            @staticmethod
            def create_agent(name, role, emoji, profile=None, prompt=None, model=None, creation_mode="standard", custom_directory=None):
                captured.update(locals())
                return {"ok": True, "agentId": "sdk-native", "profile": profile, "name": name}

        manifest = ProviderManifest(
            id="test-sdk",
            name="Test SDK",
            provider_type="harness",
            capabilities={"agentCreate": True},
            creation_schema={"fields": [
                {"id": "name", "label": "Name", "type": "text", "required": True},
                {"id": "id", "label": "Native ID", "type": "slug"},
                {"id": "role", "label": "Role", "type": "text", "required": True},
                {"id": "emoji", "label": "Emoji", "type": "emoji"},
                {"id": "instructions", "label": "Instructions", "type": "textarea"},
                {"id": "model", "label": "Model", "type": "model"},
                {"id": "creationMode", "label": "Workspace", "type": "select", "default": "standard", "options": [{"value": "standard"}, {"value": "custom"}]},
                {"id": "customDirectory", "label": "Directory", "type": "path", "required": True, "showWhen": {"creationMode": "custom"}},
            ]},
            settings_schema={"version": 1, "configKey": "test-sdk", "sections": []},
        )

        class Registry:
            provider = Provider()

            def get(self, _provider_id):
                return self.provider

            def manifest(self, _provider_id):
                return manifest

            def invoke(self, _provider_id, operation, **kwargs):
                return getattr(self.provider, operation)(**kwargs)

        with mock.patch.object(server, "_get_provider_registry", return_value=Registry()), \
             mock.patch.object(server, "_refresh_provider_discovery"), \
             mock.patch.object(server, "_refresh_agent_roster_after_create"), \
             mock.patch.object(server, "_ensure_resident_profile_for_agent"):
            result = server._handle_agent_create({
                "platform": "test-sdk",
                "name": "SDK Agent",
                "id": "sdk-native",
                "role": "Tester",
                "emoji": "🧪",
                "instructions": "Follow the contract",
                "model": "native-model",
                "creationMode": "custom",
                "customDirectory": str(self.root),
                "accountSpecificIgnored": "must-not-forward",
            })
        self.assertTrue(result["ok"])
        self.assertEqual("sdk-native", captured["profile"])
        self.assertEqual("Follow the contract", captured["prompt"])
        self.assertEqual("custom", captured["creation_mode"])
        self.assertEqual(str(self.root), captured["custom_directory"])
        self.assertEqual(manifest.capabilities, result["capabilities"])

    def test_native_lifecycle_profile_sync_for_five_cli_adapters(self):
        binary = "/bin/true"
        cases = []
        hermes_home = self.root / "hermes"
        hermes_home.mkdir()
        cases.append(HermesProvider(home_path=str(hermes_home), binary=binary, enabled=True))
        codex_home = self.root / "codex-home"
        codex_home.mkdir()
        cases.append(CodexProvider(home_path=str(codex_home), binary=binary, workspace_root=str(self.root / "codex-agents"), main_workspace=str(self.root / "codex-main"), register_native_agents=True))
        claude_home = self.root / "claude-home"
        claude_home.mkdir()
        cases.append(ClaudeCodeProvider(home_path=str(claude_home), binary=binary, workspace_root=str(self.root / "claude-agents"), main_workspace=str(self.root / "claude-main"), register_native_agents=True))
        opencode_home = self.root / "opencode-home"
        opencode_home.mkdir()
        cases.append(OpenCodeProvider(home_path=str(opencode_home), binary=binary, workspace_root=str(self.root / "opencode-agents"), main_workspace=str(self.root / "opencode-main"), register_agents=True))
        antigravity_home = self.root / "antigravity-home"
        antigravity_home.mkdir()
        cases.append(AntigravityProvider(home_path=str(antigravity_home), binary=binary, workspace_root=str(self.root / "antigravity-agents")))
        for index, provider in enumerate(cases):
            profile = f"sdk-{index}"
            created = provider.create_agent(name=f"SDK {index}", role="Test Agent", emoji="🧪", profile=profile, prompt="Initial instructions")
            self.assertTrue(created.get("ok"), (provider.__class__.__name__, created))
            updated = provider.update_profile(profile, {"name": f"Updated {index}", "instructions": "Updated instructions"})
            self.assertTrue(updated.get("ok"), (provider.__class__.__name__, updated))
            deleted = provider.delete_agent(profile)
            self.assertTrue(deleted.get("ok"), (provider.__class__.__name__, deleted))

    def test_codex_and_claude_refuse_unowned_workspace_deletion(self):
        binary = "/bin/true"
        for provider_class, prefix in ((CodexProvider, "codex"), (ClaudeCodeProvider, "claude")):
            home = self.root / f"{prefix}-safe-home"
            workspace_root = self.root / f"{prefix}-safe-workspaces"
            home.mkdir()
            unowned = workspace_root / "unowned"
            unowned.mkdir(parents=True)
            marker = unowned / "keep.txt"
            marker.write_text("keep", encoding="utf-8")
            provider = provider_class(
                home_path=str(home),
                binary=binary,
                workspace_root=str(workspace_root),
                main_workspace=str(self.root / f"{prefix}-safe-main"),
            )
            result = provider.delete_agent("unowned")
            self.assertFalse(result.get("ok"), (provider_class.__name__, result))
            self.assertEqual("keep", marker.read_text(encoding="utf-8"))

    def test_openclaw_lifecycle_uses_callbacks_and_native_workspace(self):
        home = self.root / "openclaw"
        workspace = home / "workspace-test"
        workspace.mkdir(parents=True)
        (workspace / "IDENTITY.md").write_text("# IDENTITY.md\n\n- **Name:** Test\n- **Role:** Agent\n- **Emoji:** 🤖\n", encoding="utf-8")
        (workspace / "AGENTS.md").write_text("Initial", encoding="utf-8")
        (home / "openclaw.json").write_text(json.dumps({"agents": {"list": [{"id": "test", "workspace": str(workspace)}]}}), encoding="utf-8")
        calls = []
        provider = OpenClawOfficeProvider({
            "workspaceBase": str(home),
            "openclawCreate": lambda body: calls.append(("create", body)) or {"ok": True, "agentId": "new"},
            "openclawDelete": lambda profile: calls.append(("delete", profile)) or {"ok": True, "deleted": True},
        })
        self.assertEqual("test", provider.discover_agents()[0]["providerAgentId"])
        self.assertTrue(provider.create_agent(name="New")["ok"])
        self.assertTrue(provider.update_profile("test", {"name": "Updated", "instructions": "New instructions"})["ok"])
        self.assertIn("Updated", (workspace / "IDENTITY.md").read_text(encoding="utf-8"))
        self.assertTrue(provider.delete_agent("test")["ok"])
        self.assertEqual(["create", "delete"], [item[0] for item in calls])

    def test_generic_run_progress_history_interrupt_and_auth_block(self):
        workspace = self.root / "run-workspace"
        workspace.mkdir()
        agent = self._agent(workspace)

        class FakeRegistry:
            def __init__(self, auth_ok=True):
                self.auth_ok = auth_ok

            def invoke(self, _kind, operation, *args, **kwargs):
                if operation == "test":
                    return {"ok": self.auth_ok, "installed": True, "authOk": self.auth_ok, "error": "Native login required" if not self.auth_ok else ""}
                if operation == "send_chat_message":
                    kwargs["on_progress"]({"reply": "hel", "tools": [{"id": "tool-1", "name": "read", "status": "running"}]})
                    return {"ok": True, "reply": "hello", "sessionId": "session-one", "tools": [{"id": "tool-1", "name": "read", "status": "done"}]}
                if operation == "interrupt":
                    return {"ok": True, "interrupted": True}
                return {"ok": False, "error": operation}

        with mock.patch.object(server, "_agent_record_for", return_value=agent), \
             mock.patch.object(server, "_get_provider_registry", return_value=FakeRegistry()), \
             mock.patch.object(server, "STATUS_DIR", str(self.status)):
            started = server._handle_provider_run_start({"agentId": "test-agent", "message": "hi"})
            self.assertTrue(started["ok"])
            meta = server._PROVIDER_RUNS[started["runId"]]
            deadline = time.time() + 3
            while not meta.get("done") and time.time() < deadline:
                time.sleep(0.01)
            self.assertTrue(meta.get("done"))
            self.assertEqual(["run.started", "turn.progress", "run.completed"], [event["event"] for event in meta["events"]])
            history = server._load_provider_history("test-sdk", "native-one")
            self.assertEqual(["user", "assistant"], [item["role"] for item in history])
            self.assertEqual("hello", history[-1]["text"])
            self.assertTrue(server._handle_provider_interrupt({"agentId": "test-agent"})["ok"])
        with mock.patch.object(server, "_agent_record_for", return_value=agent), \
             mock.patch.object(server, "_get_provider_registry", return_value=FakeRegistry(auth_ok=False)), \
             mock.patch.object(server, "STATUS_DIR", str(self.status)):
            blocked = server._handle_provider_run_start({"agentId": "test-agent", "message": "hi"})
            self.assertEqual("native_login_required", blocked["code"])

    def test_generic_run_rejects_unsupported_and_unmanaged_attachments(self):
        workspace = self.root / "attachment-workspace"
        workspace.mkdir()
        agent = self._agent(workspace)
        agent["capabilities"]["attachments"] = False
        with mock.patch.object(server, "_agent_record_for", return_value=agent):
            unsupported = server._handle_provider_run_start({
                "agentId": "test-agent",
                "message": "hi",
                "attachments": [{"path": "/etc/passwd"}],
            })
        self.assertEqual(405, unsupported["_status"])
        agent["capabilities"]["attachments"] = True
        with mock.patch.object(server, "_agent_record_for", return_value=agent), \
             mock.patch.object(server, "UPLOADS_DIR", str(self.root / "uploads")), \
             mock.patch.object(server, "UPLOADS_HOST_DIR", str(self.root / "host-uploads")), \
             mock.patch.object(server, "STATUS_DIR", str(self.status)):
            unmanaged = server._handle_provider_run_start({
                "agentId": "test-agent",
                "message": "hi",
                "attachments": [{"path": "/etc/passwd"}],
            })
        self.assertEqual(400, unmanaged["_status"])

    def test_generic_session_capability_dispatch(self):
        workspace = self.root / "session-workspace"
        workspace.mkdir()
        agent = self._agent(workspace)

        class Provider:
            @staticmethod
            def export_session(_profile, session_id):
                return {"ok": True, "session": {"id": session_id, "messages": []}}

        class Registry:
            provider = Provider()

            def get(self, _kind):
                return self.provider

            def invoke(self, _kind, operation, *_args, **_kwargs):
                if operation == "list_sessions":
                    return {"ok": True, "sessions": [{"id": "session-one", "title": "One", "updated": 123}]}
                if operation == "export_session":
                    return {"ok": True, "session": {"id": "session-one", "messages": []}}
                if operation == "delete_session":
                    return {"ok": True, "deleted": True}
                return {"ok": False, "error": operation}

        agent_ref = {"agentId": "test-agent", "providerKind": "test-sdk", "profile": "native-one", "name": "Test"}
        registry = Registry()
        with mock.patch.object(server, "_chat_sessions_agent", return_value=agent_ref), \
             mock.patch.object(server, "_agent_record_for", return_value=agent), \
             mock.patch.object(server, "_get_provider_registry", return_value=registry), \
             mock.patch.object(server, "STATUS_DIR", str(self.status)):
            listed, status = server.handle_chat_sessions_list("test-agent")
            self.assertEqual(200, status)
            self.assertEqual("session-one", listed["sessions"][0]["id"])
            created, status = server.handle_chat_session_create("test-agent")
            self.assertEqual(200, status)
            self.assertTrue(created["ok"])
            switched, status = server.handle_chat_session_switch("test-agent", "session-one")
            self.assertEqual(200, status)
            self.assertTrue(switched["ok"])
            deleted, status = server.handle_chat_session_delete("test-agent", "session-one")
            self.assertEqual(200, status)
            self.assertTrue(deleted["deleted"])

    def test_codex_native_approval_wait_and_response(self):
        client = CodexAppServerClient.__new__(CodexAppServerClient)
        client.profile = "test"
        client.thread_id = "thread-one"
        client.turn_id = "turn-one"
        client.timeout_sec = 2
        client._closed = False
        client._approval_lock = threading.Condition()
        client._pending_approvals = {}
        client.approval_callback = None
        client.poll = lambda: None
        request = {
            "id": 17,
            "method": "item/commandExecution/requestApproval",
            "params": {"threadId": "thread-one", "turnId": "turn-one", "itemId": "item-one", "command": ["printf", "safe"]},
        }
        approval = client.approval_from_request(request)
        result = {}

        def waiter():
            result.update(client._wait_for_approval_response(approval, request["method"], request["params"]))

        thread = threading.Thread(target=waiter)
        thread.start()
        deadline = time.time() + 1
        while client.pending_approval()["pending_count"] != 1 and time.time() < deadline:
            time.sleep(0.005)
        pending = client.pending_approval()
        self.assertEqual(approval["approval_id"], pending["pending"]["approval_id"])
        responded = client.respond_approval(approval["approval_id"], "approve")
        self.assertTrue(responded["ok"])
        thread.join(timeout=1)
        self.assertFalse(thread.is_alive())
        self.assertEqual({"decision": "accept"}, result)
        self.assertEqual(0, client.pending_approval()["pending_count"])

    def test_generic_approval_capability_dispatch(self):
        workspace = self.root / "approval-workspace"
        workspace.mkdir()
        agent = self._agent(workspace)
        agent["capabilities"]["approvals"] = True
        calls = []

        class Registry:
            @staticmethod
            def invoke(_kind, operation, *args):
                calls.append((operation, args))
                if operation == "pending_approval":
                    return {"ok": True, "pending": {"id": "approval-one", "status": "pending"}, "pending_count": 1}
                if operation == "respond_approval":
                    return {"ok": True, "approval": {"id": args[1], "status": "approved"}}
                return {"ok": False, "error": operation}

        with mock.patch.object(server, "_agent_record_for", return_value=agent), \
             mock.patch.object(server, "_get_provider_registry", return_value=Registry()):
            pending = server._handle_provider_approval_pending("test-agent")
            self.assertTrue(pending["ok"])
            self.assertEqual("test-agent", pending["pending"]["agentId"])
            responded = server._handle_provider_approval_respond({"agentId": "test-agent", "approvalId": "approval-one", "choice": "approve"})
            self.assertTrue(responded["ok"])
        self.assertEqual(["pending_approval", "respond_approval"], [item[0] for item in calls])

        agent["capabilities"]["approvals"] = False
        with mock.patch.object(server, "_agent_record_for", return_value=agent):
            unsupported = server._handle_provider_approval_pending("test-agent")
        self.assertEqual(405, unsupported["_status"])


if __name__ == "__main__":
    unittest.main()
