import importlib.util
from pathlib import Path
import tempfile
import unittest
import sys


sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("ci_ubuntu_mirror", Path(__file__).with_name("ci-ubuntu-mirror.py"))
mirror = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mirror)

RUNNER_MIRRORS = (
    "http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n"
    "https://archive.ubuntu.com/ubuntu/\tpriority:2\n"
    "https://security.ubuntu.com/ubuntu/\tpriority:3\n"
)
RUNNER_SOURCE = (
    "Types: deb\n"
    "URIs: mirror+file:/etc/apt/apt-mirrors.txt\n"
    "Suites: noble noble-updates noble-backports\n"
    "Components: main restricted universe multiverse\n"
    "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n"
    "\n"
    "Types: deb\n"
    "URIs: mirror+file:/etc/apt/apt-mirrors.txt\n"
    "Suites: noble-security\n"
    "Components: main restricted universe multiverse\n"
    "Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n"
)


class UbuntuMirrorTests(unittest.TestCase):
    def test_deb822_preserves_suites_components_and_signing_key(self):
        source = "Types: deb\nURIs: http://azure.archive.ubuntu.com/ubuntu/\nSuites: noble noble-updates noble-security\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n"
        actual, count = mirror.rewrite_source(source, ".sources")
        self.assertEqual(actual, source.replace("http://azure.archive.ubuntu.com/ubuntu/", mirror.ARCHIVE_URI))
        self.assertEqual(count, 1)
        self.assertEqual(mirror.rewrite_source(actual, ".sources"), (actual, 0))

    def test_continued_and_multiple_uris(self):
        source = "URIs: https://azure.archive.ubuntu.com/ubuntu http://azure.archive.ubuntu.com/ubuntu\n http://azure.archive.ubuntu.com/ubuntu/\nSuites: noble\n\nURIs: https://security.ubuntu.com/ubuntu\nSuites: noble-security\n"
        actual, count = mirror.rewrite_source(source, ".sources")
        self.assertEqual(count, 3)
        self.assertEqual(actual.count(mirror.ARCHIVE_URI), 3)
        self.assertIn("URIs: https://security.ubuntu.com/ubuntu\n", actual)

    def test_deb822_field_value_does_not_require_a_space_after_colon(self):
        source = "Types: deb\nURIs:http://azure.archive.ubuntu.com/ubuntu\nSuites: noble\n"
        actual, count = mirror.rewrite_source(source, ".sources")
        self.assertEqual(count, 1)
        self.assertEqual(actual, source.replace("http://azure.archive.ubuntu.com/ubuntu", mirror.ARCHIVE_URI))

    def test_legacy_list_preserves_options_comments_and_other_sources(self):
        source = "# deb http://azure.archive.ubuntu.com/ubuntu noble main\ndeb [arch=amd64 signed-by=/keys/ubuntu.gpg] http://azure.archive.ubuntu.com/ubuntu noble main\ndeb-src http://azure.archive.ubuntu.com/ubuntu/ noble main\ndeb https://packages.microsoft.com/ubuntu/24.04/prod noble main\n"
        actual, count = mirror.rewrite_source(source, ".list")
        self.assertEqual(count, 2)
        self.assertTrue(actual.startswith(source.splitlines(keepends=True)[0]))
        self.assertIn("[arch=amd64 signed-by=/keys/ubuntu.gpg]", actual)
        self.assertIn("deb https://packages.microsoft.com/ubuntu/24.04/prod noble main\n", actual)

    def test_only_exact_uri_fields_are_changed(self):
        source = "# http://azure.archive.ubuntu.com/ubuntu\nURIs: http://azure.archive.ubuntu.com/ubuntu-extra https://azure.archive.ubuntu.com.example/ubuntu\nX-Example: http://azure.archive.ubuntu.com/ubuntu\nSigned-By: /keys/original.gpg\n"
        self.assertEqual(mirror.rewrite_source(source, ".sources"), (source, 0))

    def test_legacy_inline_comments_and_non_uri_tokens_are_preserved(self):
        comment = " # previous mirror http://azure.archive.ubuntu.com/ubuntu\n"
        current = "deb https://archive.ubuntu.com/ubuntu noble main" + comment
        self.assertEqual(mirror.rewrite_source(current, ".list"), (current, 0))
        old = "deb [arch=amd64 signed-by=/keys/ubuntu.gpg] http://azure.archive.ubuntu.com/ubuntu noble main" + comment
        expected = old.replace("http://azure.archive.ubuntu.com/ubuntu noble", "https://archive.ubuntu.com/ubuntu noble", 1)
        self.assertEqual(mirror.rewrite_source(old, ".list"), (expected, 1))

    def test_line_endings_and_final_newline_are_preserved(self):
        source = "URIs: http://azure.archive.ubuntu.com/ubuntu\r\nSuites: noble"
        actual, count = mirror.rewrite_source(source, ".sources")
        self.assertEqual(count, 1)
        self.assertEqual(actual, "URIs: https://archive.ubuntu.com/ubuntu\r\nSuites: noble")

    def test_deb822_inline_comments_and_disabled_stanzas_are_preserved(self):
        source = "URIs: https://archive.ubuntu.com/ubuntu # http://azure.archive.ubuntu.com/ubuntu\nSuites: noble\n\nURIs: http://azure.archive.ubuntu.com/ubuntu\nEnabled:\n no\nSuites: noble\n"
        self.assertEqual(mirror.rewrite_source(source, ".sources"), (source, 0))

    def test_exact_runner_mirror_list_is_rewritten_once_without_source_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sources.list.d").mkdir()
            source = root / "sources.list.d" / "ubuntu.sources"
            source.write_text(RUNNER_SOURCE)
            mirrors = root / "apt-mirrors.txt"
            self.assertEqual(len(RUNNER_MIRRORS.encode()), 144)
            mirrors.write_text(RUNNER_MIRRORS)
            expected = RUNNER_MIRRORS.replace("http://azure.archive.ubuntu.com/ubuntu/", mirror.ARCHIVE_URI + "/")
            plans = mirror.plan_sources(root)
            self.assertEqual(plans, [(mirrors, expected, 1)])
            self.assertEqual(source.read_text(), RUNNER_SOURCE)
            self.assertEqual(mirrors.read_text(), RUNNER_MIRRORS)
            mirrors.write_bytes(plans[0][1].encode())
            self.assertEqual(mirror.plan_sources(root), [])
            self.assertEqual(source.read_text(), RUNNER_SOURCE)
            self.assertEqual(mirrors.read_text().splitlines()[1:], RUNNER_MIRRORS.splitlines()[1:])

    def test_all_apt_false_values_preserve_direct_and_mirror_sources(self):
        for value in ("no", "FALSE", "without", "Off", "disable", "0", "00", "000", "0x0", "+0", "-0", "-0X00"):
            for ending in ("", "\n\n"):
                with self.subTest(value=value, ending=repr(ending)), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    sources = root / "sources.list.d"
                    sources.mkdir()
                    content = (
                        "Types: deb\n"
                        "URIs: http://azure.archive.ubuntu.com/ubuntu mirror+file:/etc/apt/apt-mirrors.txt\n"
                        f"Enabled: {value}\nSuites: noble\n"
                    ) + ending
                    source = sources / "ubuntu.sources"
                    source.write_text(content)
                    self.assertEqual(mirror.rewrite_source(content, ".sources"), (content, 0))
                    # An inactive mirror list need not exist and must never be followed.
                    self.assertEqual(mirror.plan_sources(root), [])
                    mirrors = root / "apt-mirrors.txt"
                    mirrors.write_text(RUNNER_MIRRORS)
                    self.assertEqual(mirror.plan_sources(root), [])
                    self.assertEqual(mirrors.read_text(), RUNNER_MIRRORS)
                    self.assertEqual(source.read_text(), content)

    def test_enabled_and_unspecified_sources_remain_active(self):
        for value in (None, "yes", "TRUE", "with", "On", "enable", "1", "01", "0x1", "-1", "default"):
            with self.subTest(value=value):
                field = "" if value is None else f"Enabled: {value}\n"
                source = f"URIs: http://azure.archive.ubuntu.com/ubuntu\n{field}Suites: noble\n"
                self.assertEqual(mirror.rewrite_source(source, ".sources"), (source.replace("http://azure.archive.ubuntu.com/ubuntu", mirror.ARCHIVE_URI), 1))

    def test_legacy_source_can_reference_runner_mirrors(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = "deb [arch=amd64 signed-by=/keys/ubuntu.gpg] mirror+file:/etc/apt/apt-mirrors.txt jammy main # retained\n"
            (root / "sources.list").write_text(source)
            mirrors = root / "apt-mirrors.txt"
            mirrors.write_text(RUNNER_MIRRORS)
            self.assertEqual(mirror.plan_sources(root), [(mirrors, RUNNER_MIRRORS.replace("http://azure.archive.ubuntu.com/ubuntu/", mirror.ARCHIVE_URI + "/"), 1)])
            self.assertEqual((root / "sources.list").read_text(), source)

    def test_continued_runner_reference_and_direct_uri_are_both_planned(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sources.list.d").mkdir()
            source = root / "sources.list.d" / "ubuntu.sources"
            content = "URIs:http://azure.archive.ubuntu.com/ubuntu\n mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble\n"
            source.write_text(content)
            mirrors = root / "apt-mirrors.txt"
            mirrors.write_text(RUNNER_MIRRORS)
            self.assertEqual(mirror.plan_sources(root), [
                (source, content.replace("http://azure.archive.ubuntu.com/ubuntu", mirror.ARCHIVE_URI), 1),
                (mirrors, RUNNER_MIRRORS.replace("http://azure.archive.ubuntu.com/ubuntu/", mirror.ARCHIVE_URI + "/"), 1),
            ])

    def test_mirror_metadata_comments_and_line_endings_are_preserved(self):
        content = (
            "# http://azure.archive.ubuntu.com/ubuntu\r\n"
            " \thttps://azure.archive.ubuntu.com/ubuntu/\tpriority:1 arch:amd64 # note http://azure.archive.ubuntu.com/ubuntu\r\n"
            "https://packages.example.test/repo\tpriority:0\r\n"
            "https://archive.ubuntu.com/ubuntu/\tpriority:2\r\n"
            "http://azure.archive.ubuntu.com/ubuntu-extra\tpriority:3\r\n"
            "https://azure.archive.ubuntu.com.example/ubuntu\tpriority:4"
        )
        expected = content.replace("https://azure.archive.ubuntu.com/ubuntu/\tpriority:1", mirror.ARCHIVE_URI + "/\tpriority:1")
        self.assertEqual(mirror.rewrite_mirror_list(content), (expected, 1))
        self.assertEqual(mirror.rewrite_mirror_list(expected), (expected, 0))

    def test_mirror_uri_path_suffix_is_preserved(self):
        content = "http://azure.archive.ubuntu.com/ubuntu\tpriority:1\nhttps://azure.archive.ubuntu.com/ubuntu/\tpriority:2\n"
        expected = f"{mirror.ARCHIVE_URI}\tpriority:1\n{mirror.ARCHIVE_URI}/\tpriority:2\n"
        self.assertEqual(mirror.rewrite_mirror_list(content), (expected, 2))

    def test_unreferenced_mirror_list_and_comment_references_are_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sources.list.d").mkdir()
            (root / "sources.list").write_text("deb https://archive.ubuntu.com/ubuntu noble main # mirror+file:/etc/apt/apt-mirrors.txt\n")
            (root / "sources.list.d" / "ubuntu.sources").write_text(
                "# URIs: mirror+file:/etc/apt/apt-mirrors.txt\n"
                "URIs: https://archive.ubuntu.com/ubuntu # mirror+file:/etc/apt/apt-mirrors.txt\n"
                "X-Example: mirror+file:/etc/apt/apt-mirrors.txt\n"
                "Suites: noble\n\n" + RUNNER_SOURCE.replace("Types: deb\n", "Types: deb\nEnabled: no\n")
            )
            mirrors = root / "apt-mirrors.txt"
            mirrors.write_text(RUNNER_MIRRORS)
            self.assertEqual(mirror.plan_sources(root), [])
            self.assertEqual(mirrors.read_text(), RUNNER_MIRRORS)
            mirrors.unlink()
            self.assertEqual(mirror.plan_sources(root), [])

    def test_arbitrary_mirror_paths_are_not_followed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            outside = root / "outside.txt"
            outside.write_text(RUNNER_MIRRORS)
            (root / "sources.list").write_text(
                f"deb mirror+file:{outside} noble main\n"
                "deb mirror+file:/etc/apt/../outside.txt noble main\n"
                "deb mirror+file:/etc/passwd noble main\n"
                "deb mirror+file:/etc/apt/apt-mirrors.txt?query=1 noble main\n"
            )
            self.assertEqual(mirror.plan_sources(root), [])
            self.assertEqual(outside.read_text(), RUNNER_MIRRORS)

    def test_referenced_mirror_file_must_exist_and_be_regular(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "sources.list"
            content = "deb http://azure.archive.ubuntu.com/ubuntu noble main\ndeb mirror+file:/etc/apt/apt-mirrors.txt noble main\n"
            source.write_text(content)
            mirrors = root / "apt-mirrors.txt"
            with self.assertRaises(ValueError):
                mirror.plan_sources(root)
            mirrors.mkdir()
            with self.assertRaises(ValueError):
                mirror.plan_sources(root)
            self.assertEqual(source.read_text(), content)

    def test_mirror_symlink_and_dangling_symlink_are_rejected_before_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "sources.list"
            content = "deb http://azure.archive.ubuntu.com/ubuntu noble main\ndeb mirror+file:/etc/apt/apt-mirrors.txt noble main\n"
            source.write_text(content)
            target = root / "other.txt"
            target.write_text(RUNNER_MIRRORS)
            (root / "apt-mirrors.txt").symlink_to(target)
            with self.assertRaises(ValueError):
                mirror.plan_sources(root)
            self.assertEqual(source.read_text(), content)
            self.assertEqual(target.read_text(), RUNNER_MIRRORS)
            target.unlink()
            with self.assertRaises(ValueError):
                mirror.plan_sources(root)
            self.assertEqual(source.read_text(), content)

    def test_configuration_directory_symlinks_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "real"
            target.mkdir()
            linked = root / "linked"
            linked.symlink_to(target, target_is_directory=True)
            with self.assertRaises(ValueError):
                mirror.plan_sources(linked)
            (root / "sources.list.d").symlink_to(target, target_is_directory=True)
            with self.assertRaises(ValueError):
                mirror.plan_sources(root)

    def test_planning_is_read_only_and_rejects_symlinks_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sources.list.d").mkdir()
            source = root / "sources.list"
            content = "deb http://azure.archive.ubuntu.com/ubuntu noble main\n"
            source.write_text(content)
            plans = mirror.plan_sources(root)
            self.assertEqual(len(plans), 1)
            self.assertEqual(source.read_text(), content)
            (root / "sources.list.d" / "linked.sources").symlink_to(source)
            with self.assertRaises(ValueError):
                mirror.plan_sources(root)
            self.assertEqual(source.read_text(), content)


if __name__ == "__main__":
    unittest.main()
