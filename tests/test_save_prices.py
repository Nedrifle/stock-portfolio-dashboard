"""Exercise cache saving against local Git repositories, including a push race."""
import os
import pathlib
import subprocess
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'scripts/save_prices.sh'

class CacheSaveTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.remote = self.root / 'remote.git'
        self.run_git(self.root, 'init', '--bare', str(self.remote))
        self.work = self.root / 'work'
        self.run_git(self.root, 'clone', str(self.remote), str(self.work))
        self.run_git(self.work, 'checkout', '-b', 'main')
        self.configure(self.work)
        (self.work / 'site/data').mkdir(parents=True)
        (self.work / 'site/data/quotes.json').write_text('{}')
        (self.work / 'market-symbols.json').write_text('[]')
        self.run_git(self.work, 'add', '.')
        self.run_git(self.work, 'commit', '-m', 'Initial')
        self.run_git(self.work, 'push', '-u', 'origin', 'main')
        self.other = self.root / 'other'
        self.run_git(self.root, 'clone', '-b', 'main', str(self.remote), str(self.other))
        self.configure(self.other)
        (self.work / 'site/data/quotes.json').write_text('{"updated":true}')
        self.output = self.root / 'output'

    def run_git(self, cwd, *args):
        return subprocess.run(['git', *args], cwd=cwd, text=True, capture_output=True, check=True).stdout.strip()

    def configure(self, cwd):
        self.run_git(cwd, 'config', 'user.name', 'Test')
        self.run_git(cwd, 'config', 'user.email', 'test@example.invalid')

    def advance(self):
        (self.other / 'code.txt').write_text('New code')
        self.run_git(self.other, 'add', '.')
        self.run_git(self.other, 'commit', '-m', 'New code')
        self.run_git(self.other, 'push', 'origin', 'main')

    def save(self):
        result = subprocess.run(['bash', str(SCRIPT)], cwd=self.work,
                                env={**os.environ, 'GITHUB_OUTPUT':str(self.output)}, capture_output=True, text=True)
        return result.returncode, self.output.read_text() if self.output.exists() else ''

    def test_normal_save(self):
        self.assertEqual(self.save(), (0, 'stale=false\n'))
        self.assertEqual(self.run_git(self.work, 'rev-parse', 'HEAD'), self.run_git(self.root, '--git-dir', str(self.remote), 'rev-parse', 'main'))

    def test_new_code_before_save(self):
        self.advance()
        expected = self.run_git(self.other, 'rev-parse', 'HEAD')
        self.assertEqual(self.save(), (0, 'stale=true\n'))
        self.assertEqual(expected, self.run_git(self.root, '--git-dir', str(self.remote), 'rev-parse', 'main'))

    def test_new_code_between_fetch_and_push(self):
        (self.other / 'code.txt').write_text('New code')
        self.run_git(self.other, 'add', '.')
        self.run_git(self.other, 'commit', '-m', 'New code')
        hook = self.work / '.git/hooks/pre-push'
        import shlex
        hook.write_text('#!/bin/sh\ngit -C ' + shlex.quote(str(self.other)) + ' push origin main\n')
        hook.chmod(0o755)
        self.assertEqual(self.save(), (0, 'stale=true\n'))
        self.assertEqual(self.run_git(self.other, 'rev-parse', 'HEAD'), self.run_git(self.root, '--git-dir', str(self.remote), 'rev-parse', 'main'))

    def test_real_push_failure_still_fails(self):
        hook = self.remote / 'hooks/pre-receive'
        hook.write_text('#!/bin/sh\nexit 1\n')
        hook.chmod(0o755)
        self.assertEqual(self.save(), (1, ''))
