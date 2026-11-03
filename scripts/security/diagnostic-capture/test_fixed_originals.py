"""Sealed skill inputs; only trusted synthetic capture tools may execute."""
import copy,hashlib,json,os,shutil,subprocess,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent))
import fixed_originals
from fixed_originals import load_registry,skill_originals,validate_skill_case,REGISTRY_SHA256
from original038 import run,tool_capture_requirements
from validation import tool_capture_gaps


def config_for(entry,root):
    return {'source':load_registry()['source'],'registrySha256':REGISTRY_SHA256,
        'cases':{entry['id']:{'path':str(root/'inert-original'),'files':copy.deepcopy(entry['files']),
            'identity':copy.deepcopy(entry)}}}


class FixedSkills(unittest.TestCase):
    def test_registry_is_exact_and_rejects_changed_or_added_entries(self):
        registry=load_registry()
        self.assertEqual([row['fixture']for row in registry['originals']],['004','016','017','026','027','074','008','011','036','033','065','073','042','055','039','010','019','005','006','015'])
        self.assertEqual(sum(len(row['files'])for row in registry['originals']),84)
        self.assertEqual(sum(file['size']for row in registry['originals']for file in row['files']),1093507)
        for mutation in ('source','identity','duplicate','unknown'):
            with self.subTest(mutation=mutation),tempfile.TemporaryDirectory()as name:
                root=Path(name);value=copy.deepcopy(registry)
                if mutation=='source':value['source']='0'*40
                elif mutation=='identity':value['originals'][0]['owner']='another-owner'
                elif mutation=='duplicate':value['originals'].append(value['originals'][0])
                else:value['originals'].append({'fixture':'999'})
                (root/'fixed-originals.json').write_text(json.dumps(value))
                with patch.object(fixed_originals,'__file__',str(root/'fixed_originals.py')):
                    with self.assertRaisesRegex(ValueError,'registry identity'):load_registry()

    def test_each_skill_requires_all_three_captures_even_for_plugin_shaped_report(self):
        plugin={'schemaVersion':'clawscan-run-v1','profile':'clawhub','target':{'kind':'plugin'},
            'scanners':{'aig':{'status':'skipped','error':'Scanner aig does not support plugin targets.'}}}
        for case_id in skill_originals():
            for report in (None,{},plugin):
                with self.subTest(case=case_id,report=report):
                    self.assertEqual(tool_capture_requirements(case_id,report),
                        {'required':['skillspector','aig-skill-scan','codex'],'normallySkipped':{},'gaps':[]})

    def test_exact_source_and_custody_are_bound_before_setup(self):
        for entry in load_registry()['originals']:
            for mutation in ('source','seal','package','version','owner','attemptId','fingerprint','versionId',
                'sourceManifestSha256','manifestSha256','file','missing','extra','cross-case','mixed','identity-absent'):
                with self.subTest(case=entry['fixture'],mutation=mutation),tempfile.TemporaryDirectory()as name:
                    root=Path(name);(root/'harness').mkdir();config=config_for(entry,root);case=config['cases'][entry['id']]
                    if mutation=='source':config['source']='0'*40
                    elif mutation=='seal':config['registrySha256']='0'*64
                    elif mutation=='file':case['files'][0]['sha256']='0'*64
                    elif mutation=='missing':case['files'].pop()
                    elif mutation=='extra':case['files'].append({'path':'extra','sha256':'0'*64,'size':0})
                    elif mutation=='cross-case':case['files']=copy.deepcopy(next(row for row in load_registry()['originals']if row['id']!=entry['id'])['files'])
                    elif mutation=='mixed':config['cases']['sn-ppt-workbench-2026.10.29']=copy.deepcopy(case)
                    elif mutation=='identity-absent':case.pop('identity')
                    else:case['identity'][mutation]='changed'
                    (root/'harness/runtime.json').write_text(json.dumps(config))
                    with self.assertRaises(ValueError):run(root)
                    self.assertEqual(list(root.iterdir()),[root/'harness'])

    def test_actual_proxy_checks_each_skill_identity_before_trusted_control(self):
        for entry in load_registry()['originals']:
            for mutation in ('valid','source','seal','identity','manifest','mixed'):
                with self.subTest(case=entry['fixture'],mutation=mutation),tempfile.TemporaryDirectory()as name:
                    root=Path(name).resolve();harness=root/'harness';harness.mkdir();(harness/'bin').mkdir()
                    work=root/'work';work.mkdir();output=root/'evidence';output.mkdir();(root/'contexts').mkdir()
                    for module in ('capture.py','proxy.py','fixed_originals.py','fixed-originals.json'):
                        shutil.copyfile(Path(__file__).parent/module,harness/module)
                    tool=root/'tool.py';marker=root/'tool-invoked'
                    tool.write_text('#!'+sys.executable+'\nimport json,sys\nfrom pathlib import Path\n'
                        f'Path({str(marker)!r}).write_text("trusted control only")\n'
                        'Path(sys.argv[-1]).write_text(json.dumps({"findings":["PRESERVED"]}))\nraise SystemExit(1)\n')
                    tool.chmod(0o500);config=config_for(entry,root);case=config['cases'][entry['id']]
                    config.update({'readyForReview':True,'tools':{'skillspector':{'path':str(tool),'sha256':hashlib.sha256(tool.read_bytes()).hexdigest()}}})
                    if mutation=='source':config['source']='0'*40
                    elif mutation=='seal':config['registrySha256']='0'*64
                    elif mutation=='identity':case['identity']['attemptId']='different-attempt'
                    elif mutation=='manifest':case['files'][0]['sha256']='0'*64
                    elif mutation=='mixed':config['cases']['sn-ppt-workbench-2026.10.29']=copy.deepcopy(case)
                    (harness/'runtime.json').write_text(json.dumps(config))
                    context={'captureRunId':'CREDENTIAL_FREE_CONTROL','mode':'live','original':case['path'],
                        'work':str(work),'output':str(output),'environment':{'PATH':os.environ['PATH']}}
                    context_path=root/'contexts/test.json';context_path.write_text(json.dumps(context))
                    (harness/'bin/skillspector').symlink_to(harness/'proxy.py')
                    result=subprocess.run([sys.executable,'-I',str(harness/'bin/skillspector'),'scan','artifact','--format','json','--output',str(work/'skillspector-report-0.json')],
                        cwd=work,env={'PATH':os.environ['PATH'],'CLAWSCAN_CAPTURE_CONTEXT':str(context_path)},capture_output=True,timeout=10)
                    if mutation=='valid':
                        self.assertEqual(result.returncode,1);self.assertTrue(marker.exists())
                        folder=next((output/'tool-captures').iterdir())
                        self.assertEqual(tool_capture_gaps(folder,output,work,config,context_path,context),[])
                    else:self.assertEqual(result.returncode,78);self.assertFalse(marker.exists())

if __name__=='__main__':unittest.main()
