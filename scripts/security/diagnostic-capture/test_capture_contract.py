"""Small real subprocess controls: no model, credential lookup or original execution."""
import hashlib,json,os,shutil,subprocess,sys,tempfile,unittest
from pathlib import Path
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent))
from validation import tool_capture_gaps


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
