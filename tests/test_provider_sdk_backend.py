import hashlib
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


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SERVER_ROOT = PROJECT_ROOT / "src" / "server"
if str(SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVER_ROOT))

import server  # noqa: E402
from providers.antigravity import AntigravityProvider  # noqa: E402
from providers.builtin import OpenClawOfficeProvider  # noqa: E402
from providers.claude_code import ClaudeCodeProvider  # noqa: E402
from providers.codex import CodexAppServerClient, CodexProvider  # noqa: E402
from providers.hermes import HermesProvider  # noqa: E402
from providers.opencode import OpenCodeProvider  # noqa: E402
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
            self.assertTrue(manifest["settingsSchema"], provider_id)
            self.assertTrue(manifest["creationSchema"].get("fields"), provider_id)
            self.assertTrue(manifest["resourceSchema"], provider_id)
            self.assertTrue(manifest["skillSchema"], provider_id)
            paths = [path for item in manifest["resourceSchema"] for path in item.get("paths", [])]
            self.assertFalse({"*", "**", "**/*"}.intersection(paths), provider_id)
        self.assertTrue(manifests["codex"]["capabilities"]["approvals"])
        self.assertFalse(manifests["opencode"]["capabilities"]["approvals"])

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

    def test_settings_save_dispatch_preserves_existing_secret(self):
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
        self.assertEqual("keep-me", captured["openclaw"]["gatewayToken"])

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
