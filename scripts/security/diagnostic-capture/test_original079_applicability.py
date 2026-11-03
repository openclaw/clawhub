"""Fixed plugin capture controls; only trusted synthetic tools may execute."""
import copy,hashlib,json,os,shutil,subprocess,sys,tempfile,unittest
from pathlib import Path
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent))
from original038 import tool_capture_requirements,missing_tool_capture_gaps,run
from validation import tool_capture_gaps

CASE='mcpherson-governance-openclaw-0.8.0'

def report():
    return {'schemaVersion':'clawscan-run-v1','profile':'clawhub','target':{'kind':'plugin'},
        'scanners':{'aig':{'status':'skipped','error':'Scanner aig does not support plugin targets.',
            'command':None,'raw':None}}}

class Applicability(unittest.TestCase):
    def test_source_case_and_full_manifest_are_bound_before_setup(self):
        files=json.loads((Path(__file__).parent.parent/'fixtures/judge-original-079.json').read_text())['files']
        for change in ('source','unknown','mixed','hash','skill'):
            with self.subTest(change=change),tempfile.TemporaryDirectory()as name:
                root=Path(name);(root/'harness').mkdir()
                config={'source':'b08e2907eb60b33bf712b07673aff565c13d9ad7',
                    'cases':{CASE:{'path':str(root/'never-materialized'),'files':copy.deepcopy(files)}}}
                if change=='source':config['source']='0'*40
                if change=='unknown':config['cases']={'another-original':config['cases'][CASE]}
                if change=='mixed':config['cases']['sn-ppt-workbench-2026.10.29']=config['cases'][CASE]
                if change=='hash':config['cases'][CASE]['files'][0]['sha256']='0'*64
                if change=='skill':config['cases'][CASE]['files'][0]['path']='SKILL.md'
                (root/'harness/runtime.json').write_text(json.dumps(config))
                with self.assertRaises(ValueError):run(root)
                self.assertEqual(list(root.iterdir()),[root/'harness'])

    def test_exact_plugin_skip_requires_all_other_tool_captures(self):
        policy=tool_capture_requirements(CASE,report())
        self.assertEqual(policy['required'],['skillspector','codex'])
        self.assertEqual(policy['gaps'],[]);self.assertIn('aig',policy['normallySkipped'])
        with tempfile.TemporaryDirectory()as name:
            output=Path(name);(output/'tool-captures').mkdir()
            for tool in policy['required']:(output/'tool-captures'/(tool+'-test')).mkdir()
            self.assertEqual(missing_tool_capture_gaps(output,policy),[])
            skill=tool_capture_requirements('sn-ppt-workbench-2026.10.29',report())
            self.assertEqual(missing_tool_capture_gaps(output,skill),['aig-skill-scan tool capture absent or unreached'])
            for tool in policy['required']:
                (output/'tool-captures'/(tool+'-test')).rmdir()
                self.assertEqual(missing_tool_capture_gaps(output,policy),[tool+' tool capture absent or unreached'])
                (output/'tool-captures'/(tool+'-test')).mkdir()

    def test_missing_malformed_or_different_skips_never_waive_a_capture(self):
        values=[None,{},[]]
        for section,key,value in [('top','schemaVersion','wrong'),('top','profile','wrong'),
            ('target','kind','skill'),('aig','status','error'),('aig','status','unknown'),
            ('aig','status','completed'),('aig','error',None),('aig','error','executable missing'),
            ('aig','command',['unexpected']),('aig','raw',{}),('aig','exitCode',0),
            ('aig','commandStarted',True)]:
            changed=report();target=changed if section=='top'else changed['target']if section=='target'else changed['scanners']['aig']
            target[key]=value;values.append(changed)
        for key in ('schemaVersion','profile','target','scanners'):
            changed=report();changed.pop(key);values.append(changed)
        for value in values:
            with self.subTest(value=value):
                policy=tool_capture_requirements(CASE,value)
                self.assertIn('aig-skill-scan',policy['required'])
                self.assertTrue(policy['gaps']);self.assertEqual(policy['normallySkipped'],{})
        with self.assertRaises(ValueError):tool_capture_requirements('another-original',report())

    def test_actual_proxy_accepts_only_one_bound_fixed_plugin_case(self):
        for change in ('valid','mixed','unknown','context'):
            with self.subTest(change=change),tempfile.TemporaryDirectory()as name:
                root=Path(name).resolve();harness=root/'harness';harness.mkdir();(harness/'bin').mkdir()
                work=root/'work';work.mkdir();output=root/'evidence';output.mkdir();(root/'contexts').mkdir()
                for module in ('capture.py','proxy.py'):shutil.copyfile(Path(__file__).parent/module,harness/module)
                tool=root/'tool.py';marker=root/'tool-invoked'
                tool.write_text('#!'+sys.executable+'\nimport json,sys\nfrom pathlib import Path\n'
                    f'Path({str(marker)!r}).write_text("trusted control only")\n'
                    'Path(sys.argv[-1]).write_text(json.dumps({"findings":["PRESERVED"]}))\nraise SystemExit(1)\n')
                tool.chmod(0o500);original=str(root/'inert-original')
                cases={CASE:{'path':original}}
                if change=='mixed':cases['sn-ppt-workbench-2026.10.29']={'path':original}
                if change=='unknown':cases={'another-original':{'path':original}}
                config={'readyForReview':True,'cases':cases,'tools':{'skillspector':{'path':str(tool),'sha256':hashlib.sha256(tool.read_bytes()).hexdigest()}}}
                (harness/'runtime.json').write_text(json.dumps(config))
                context={'captureRunId':'CREDENTIAL_FREE_CONTROL','mode':'live','original':original if change!='context'else original+'-changed',
                    'work':str(work),'output':str(output),'environment':{'PATH':os.environ['PATH']}}
                context_path=root/'contexts/test.json';context_path.write_text(json.dumps(context));(harness/'bin/skillspector').symlink_to(harness/'proxy.py')
                result=subprocess.run([sys.executable,'-I',str(harness/'bin/skillspector'),'scan','artifact','--format','json','--output',str(work/'skillspector-report-0.json')],
                    cwd=work,env={'PATH':os.environ['PATH'],'CLAWSCAN_CAPTURE_CONTEXT':str(context_path)},capture_output=True,timeout=10)
                if change=='valid':
                    self.assertEqual(result.returncode,1);self.assertTrue(marker.exists())
                    folder=next((output/'tool-captures').iterdir())
                    self.assertEqual(tool_capture_gaps(folder,output,work,config,context_path,context),[])
                else:self.assertEqual(result.returncode,78);self.assertFalse(marker.exists())

if __name__=='__main__':unittest.main()
