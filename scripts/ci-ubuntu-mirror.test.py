import importlib.util
from pathlib import Path
import tempfile
import unittest
import sys


sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("ci_ubuntu_mirror", Path(__file__).with_name("ci-ubuntu-mirror.py"))
mirror = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mirror)


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
