"""Small real subprocess controls: no model, credential lookup or original execution."""
import hashlib,json,os,shutil,subprocess,sys,tempfile,unittest
from pathlib import Path
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent))
from validation import tool_capture_gaps
from original038 import hashes,sandbox_preflight
from unittest.mock import patch
import original038


class OriginalFileIdentity(unittest.TestCase):
    def original(self,root):
        files=[]
        for name,data in [('workbench-runtime/dist-server/index.mjs',b'const marker = 1;\n'),
                          ('workbench-runtime/dist/index.html',b'<!doctype html>\n')]:
            path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
            files.append({'path':name,'size':len(data),'sha256':hashlib.sha256(data).hexdigest()})
        return {'path':str(root),'files':sorted(files,key=lambda row:row['path'])}

    def test_exact_inventory_uses_relative_path_order(self):
        with tempfile.TemporaryDirectory()as name:
            case=self.original(Path(name))
            self.assertEqual(hashes(case),case['files'])

    def test_changed_extra_missing_and_symlink_files_remain_rejected(self):
        for change in ('changed','extra','missing','symlink'):
            with self.subTest(change=change),tempfile.TemporaryDirectory()as name:
                root=Path(name);case=self.original(root)
                path=root/'workbench-runtime/dist-server/index.mjs'
                if change=='changed':path.write_bytes(b'const marker = 2;\n')
                elif change=='extra':(root/'extra.txt').write_bytes(b'')
                elif change=='missing':path.unlink()
                else:path.unlink();path.symlink_to('../dist/index.html')
                with self.assertRaises(ValueError):hashes(case)


class PrivateTemporarySandbox(unittest.TestCase):
    @unittest.skipUnless(sys.platform=='linux'and os.environ.get('CLAWSCAN_TEST_CODEX'),
        'actual pinned Linux Codex is supplied by runtime qualification')
    def test_actual_codex_rejects_absent_readonly_tmp_and_passes_private_tmp(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd())as name:
            root=Path(name).resolve()
            for folder in ('work','home','evidence','empty-tmp'):(root/folder).mkdir()
            (root/'home/.codex').mkdir()
            codex=Path(os.environ['CLAWSCAN_TEST_CODEX'])
            config={'tools':{'codex':{'path':str(codex),
                'sha256':hashlib.sha256(codex.read_bytes()).hexdigest()}}}
            child={'PATH':os.environ['PATH'],'HOME':str(root/'home'),
                'CODEX_HOME':str(root/'home/.codex'),'TMPDIR':str(root/'work'),
                'TMP':str(root/'work'),'TEMP':str(root/'work'),'LANG':'C.UTF-8',
                'OPENAI_API_KEY':'PUBLIC_INERT_CANARY_MUST_NOT_REACH_PREFLIGHT',
                'CODEX_API_KEY':'PUBLIC_INERT_CANARY_MUST_NOT_REACH_PREFLIGHT',
                'LLM_API_KEY':'PUBLIC_INERT_CANARY_MUST_NOT_REACH_PREFLIGHT'}
            actual=original038.sandbox_arguments
            def readonly_tmp(*args):
                argv=actual(*args);at=argv.index('--tmpfs')
                argv[at:at+2]=['--ro-bind',str(root/'empty-tmp'),'/tmp']
                return argv
            with patch.object(original038,'sandbox_arguments',readonly_tmp):
                with self.assertRaisesRegex(ValueError,'preflight failed'):
                    sandbox_preflight(root,config,child)
            before=(root/'evidence/sandbox-preflight/stderr.log').read_text()
            self.assertIn('Read-only file system',before)
            (root/'evidence').rename(root/'failed-evidence');(root/'evidence').mkdir()
            sandbox_preflight(root,config,child)
            self.assertTrue(json.loads((root/'evidence/sandbox-preflight.json').read_text())['passed'])
            after=(root/'evidence/sandbox-preflight/stdout.log').read_text()
            self.assertIn('OUTER_WORKSPACE_WRITABLE_FRESH_PRIVATE_TMP',after)
            self.assertIn('INNER_READ_OK_FOUR_WRITES_DENIED',after)
            self.assertIn('PREFLIGHT_PASSED',after)
            self.assertFalse((root/'preflight-readonly.txt').exists())
            self.assertFalse((root/'work/preflight-workspace.txt').exists())


class CaptureContract(unittest.TestCase):
    def test_real_proxy_preserves_findings_exit_and_context_while_excluding_canary(self):
        with tempfile.TemporaryDirectory()as name:
            root=Path(name).resolve();harness=root/'harness';harness.mkdir()
            (harness/'bin').mkdir();work=root/'work';work.mkdir();output=root/'evidence';output.mkdir()
            (root/'contexts').mkdir();home=root/'fresh-home';home.mkdir()
            for filename in ('capture.py','proxy.py','workspace_capture.py'):
                shutil.copyfile(Path(__file__).parent/filename,harness/filename)
            tool=root/'synthetic-tool.py'
            tool.write_text('#!'+sys.executable+'\nimport json,os,sys\nfrom pathlib import Path\n'
                'Path(sys.argv[-1]).write_text(json.dumps({"findings":["PRESERVED_FINDING"],"gap":"PRESERVED_GAP"}))\n'
                'print(os.environ["OPENAI_API_KEY"])\nraise SystemExit(1)\n')
            tool.chmod(0o500)
            config={'readyForReview':True,'cases':{'sn-ppt-workbench-2026.10.29':{'path':str(root/'inert-original')}},
                'tools':{'skillspector':{'path':str(tool),'sha256':hashlib.sha256(tool.read_bytes()).hexdigest()}}}
            (harness/'runtime.json').write_text(json.dumps(config))
            context={'captureRunId':'LOCAL_TEST_ONLY','mode':'live','original':str(root/'inert-original'),
                'work':str(work),'output':str(output),'environment':{'PATH':os.environ['PATH'],'HOME':str(home)}}
            context_path=root/'contexts/test.json';context_path.write_text(json.dumps(context))
            (harness/'bin/skillspector').symlink_to(harness/'proxy.py')
            canary='CANARY_PROVIDER_CREDENTIAL_FOR_LOCAL_TEST_ONLY'
            result=subprocess.run([sys.executable,'-I',str(harness/'bin/skillspector'),
                'scan','artifact','--format','json','--output',str(work/'skillspector-report-0.json')],
                cwd=work,env={'PATH':os.environ['PATH'],'CLAWSCAN_CAPTURE_CONTEXT':str(context_path),
                    'OPENAI_API_KEY':canary},capture_output=True,timeout=10)
            self.assertEqual(result.returncode,1)
            self.assertNotIn(canary.encode(),result.stdout+result.stderr)
            self.assertIn(b'[REDACTED_INJECTED_CREDENTIAL]',result.stdout)
            folder=next((output/'tool-captures').iterdir())
            self.assertEqual(tool_capture_gaps(folder,output,work,config,context_path,context),[])
            all_bytes=b''.join(path.read_bytes()for path in output.rglob('*')if path.is_file())
            self.assertNotIn(canary.encode(),all_bytes)
            self.assertIn(b'PRESERVED_FINDING',all_bytes);self.assertIn(b'PRESERVED_GAP',all_bytes)
            self.assertNotIn(b'environmentValuesRecorded": true',all_bytes)
            # The real byte-integrity validator must reject a tampered report snapshot.
            index=json.loads((folder/'snapshot-index.json').read_text())
            snapshot=folder/index['observations'][0]['file'];snapshot.write_bytes(b'TAMPERED')
            self.assertTrue(tool_capture_gaps(folder,output,work,config,context_path,context))


if __name__=='__main__':unittest.main()
