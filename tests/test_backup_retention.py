"""Exercise run-backup with real restic and strictly local, synthetic fixtures."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TAG = "backup-set:nz-llc-accountant"


class BackupRetentionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        binary = os.environ.get("RESTIC_TEST_BINARY") or shutil.which("restic")
        if not binary:
            raise RuntimeError("Install restic or set RESTIC_TEST_BINARY to run integration tests")
        cls.binary = str(Path(binary).resolve())

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="accountant-retention-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.repo = self.root / "repository"
        self.bin = self.root / "bin"
        self.bin.mkdir()
        (self.root / "state").mkdir()
        self.log = self.root / "commands.jsonl"
        # No inherited RESTIC/AWS/PG/RCLONE variables, credentials, HOME or .env.
        self.env = {
            "PATH": f"{self.bin}:/usr/bin:/bin",
            "HOME": str(self.root),
            "TZ": "UTC",
            "RESTIC_PASSWORD": "synthetic-test-password",
            "RESTIC_REPOSITORY": str(self.repo),
            "TEST_RESTIC": self.binary,
            "TEST_REPO": str(self.repo),
            "TEST_LOG": str(self.log),
            "TEST_HOST": "container-a",
            "TEST_TIMESTAMP": "2025-01-01T01-00-00",
            "TEST_TIME": "2025-01-01 01:00:00",
        }
        for name in (
            "POSTGRES_HOST", "POSTGRES_PORT", "POSTGRES_USER", "POSTGRES_PASSWORD",
            "APP_DB_NAME", "DAM_DB_NAME", "BACKUP_S3_ENDPOINT", "BACKUP_S3_BUCKET",
            "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "DAM_S3_BUCKET",
        ):
            self.env[name] = "synthetic-unused"
        self.env["APP_DB_NAME"] = "app"
        self.env["DAM_DB_NAME"] = "dam"
        self.write_stub("date", "print(os.environ['TEST_TIMESTAMP'])\n")
        self.write_stub("pg_dump", """
for arg in sys.argv[1:]:
    if arg.startswith('--file='):
        Path(arg[7:]).write_text('synthetic database dump')
""")
        self.write_stub("rclone", "Path(sys.argv[-1], 'fixture.txt').write_text('synthetic media')\n")
        self.write_stub("restic", """
args = sys.argv[1:]
with open(os.environ['TEST_LOG'], 'a') as log:
    log.write(json.dumps(args) + '\\n')
if args[0] == 'backup':
    if os.environ.get('TEST_FAIL_BACKUP'):
        sys.exit(3)
    args += ['--host', os.environ['TEST_HOST'], '--time', os.environ['TEST_TIME']]
# run-backup constructs an S3 URL; never forward it or any credentials. The
# explicit local repository and clean child env are the test safety boundary.
env = {
    'PATH': '/usr/bin:/bin', 'HOME': os.environ['HOME'], 'TZ': 'UTC',
    'RESTIC_PASSWORD': 'synthetic-test-password',
}
sys.exit(subprocess.run([
    os.environ['TEST_RESTIC'], '--repo', os.environ['TEST_REPO'], '--no-cache', *args,
], env=env).returncode)
""")
        source = (ROOT / "docker/backup/run-backup.sh").read_text()
        # Relocate filesystem constants only; execute the actual production
        # backup/retention/validation code, with synthetic external clients.
        self.assertEqual(source.count('workspace="/tmp/backup-${timestamp}"'), 1)
        self.assertEqual(source.count("/var/lib/backup"), 1)
        source = source.replace(
            'workspace="/tmp/backup-${timestamp}"',
            f'workspace="{self.root}/backup-${{timestamp}}"',
        ).replace("/var/lib/backup", str(self.root / "state"))
        self.script = self.root / "run-backup.sh"
        self.script.write_text(source)
        self.restic("init")

    def write_stub(self, name, body):
        path = self.bin / name
        path.write_text(
            f"#!{sys.executable}\n"
            "import json, os, subprocess, sys\nfrom pathlib import Path\n" + body
        )
        path.chmod(0o755)

    def restic(self, *args):
        # Test-owned repository is always explicit, even if the parent has live env vars.
        result = subprocess.run(
            [self.binary, "--repo", str(self.repo), "--no-cache", *args],
            env={k: self.env[k] for k in ("PATH", "HOME", "TZ", "RESTIC_PASSWORD")},
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout

    def snapshots(self):
        return json.loads(self.restic("snapshots", "--json")) or []

    def seed(self, name, tags):
        source = self.root / name
        source.mkdir()
        (source / "fixture.txt").write_text(f"protected data: {name}")
        args = ["backup", str(source), "--host", "old-container", "--time", "2024-01-01 01:00:00"]
        for tag in tags:
            args.extend(["--tag", tag])
        self.restic(*args)
        return next(s for s in self.snapshots() if s["paths"] == [str(source)])

    def run_backup(self, index, **overrides):
        env = dict(self.env)
        env.update({
            "TEST_HOST": f"container-{index}",
            "TEST_TIMESTAMP": f"2025-01-{index:02}T01-00-00",
            "TEST_TIME": f"2025-01-{index:02} 01:00:00",
        })
        env.update(overrides)
        return subprocess.run(
            ["/bin/bash", str(self.script)], env=env, capture_output=True, text=True,
        )

    def assert_backup_ok(self, index, **overrides):
        result = self.run_backup(index, **overrides)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_default_retention_protects_foreign_and_legacy_snapshots(self):
        protected = [
            self.seed("legacy-backup-2024-01-01", ["daily"]),
            self.seed("foreign-daily", ["daily", "other-project"]),
            self.seed("foreign-set", ["daily", "backup-set:other-deployment"]),
            self.seed("untagged", []),
        ]
        # Extra tags must not create their own retention groups.
        self.seed("old-managed-extra-tag", ["daily", DEFAULT_TAG, "extra"])
        for index in range(1, 5):
            self.assert_backup_ok(index)
            snapshots = self.snapshots()
            managed = [s for s in snapshots if DEFAULT_TAG in s.get("tags", [])]
            self.assertEqual(len(managed), 1)
            self.assertEqual(managed[0]["hostname"], f"container-{index}")
            self.assertIn(f"backup-2025-01-{index:02}", managed[0]["paths"][0])
            self.assertTrue({s["id"] for s in protected} <= {s["id"] for s in snapshots})
        self.restic("check", "--read-data")
        # Verify protected data still restores after real prune operations.
        for snapshot in protected:
            target = self.root / "restored" / snapshot["id"]
            self.restic("restore", snapshot["id"], "--target", str(target))
            source = Path(snapshot["paths"][0])
            restored = target / str(source).lstrip("/") / "fixture.txt"
            self.assertEqual(restored.read_text(), f"protected data: {source.name}")

    def test_custom_count_and_set_across_paths_and_hosts(self):
        protected = self.seed("default-set", [DEFAULT_TAG])
        for index in range(1, 5):
            self.assert_backup_ok(index, RESTIC_KEEP_LAST="2", RESTIC_BACKUP_SET="staging_2.nz")
            managed = [s for s in self.snapshots() if "backup-set:staging_2.nz" in s.get("tags", [])]
            self.assertEqual(len(managed), min(index, 2))
            self.assertEqual(
                {s["hostname"] for s in managed},
                {f"container-{i}" for i in range(max(1, index - 1), index + 1)},
            )
            self.assertIn(protected["id"], {s["id"] for s in self.snapshots()})
        self.restic("check", "--read-data")

    def test_original_grouping_reproduces_retention_bug(self):
        for index in range(1, 4):
            source = self.root / f"old-backup-{index}" / "snapshot"
            source.mkdir(parents=True)
            (source / "fixture").write_text("synthetic")
            self.restic("backup", str(source), "--tag", "daily", "--host", f"host-{index}")
            self.restic("forget", "--keep-last", "1", "--prune")
        self.assertEqual(len(self.snapshots()), 3)

    def test_failed_backup_does_not_apply_retention(self):
        self.assert_backup_ok(1)
        before = self.snapshots()
        self.log.write_text("")
        result = self.run_backup(2, TEST_FAIL_BACKUP="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.snapshots(), before)
        commands = [json.loads(line)[0] for line in self.log.read_text().splitlines()]
        self.assertNotIn("forget", commands)
        self.assertEqual((self.root / "state/last-success.txt").read_text().strip(), "2025-01-01T01-00-00")

    def test_invalid_policy_is_rejected_before_repository_access(self):
        for name, values in {
            "RESTIC_BACKUP_SET": ["", "a,b", "a b", "-option", "a/b", "a\nb"],
            "RESTIC_KEEP_LAST": ["", "0", "-1", "1.5", "all", "1 --prune"],
        }.items():
            for value in values:
                with self.subTest(name=name, value=value):
                    result = self.run_backup(1, **{name: value})
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(name, result.stderr)
                    self.assertFalse(self.log.exists())


if __name__ == "__main__":
    unittest.main()
