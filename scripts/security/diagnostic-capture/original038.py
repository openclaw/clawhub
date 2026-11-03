"""One fixed original, normal scanner/judge policy, synchronous retained evidence.

Reuses the existing capture/proxy/validator protocol. Encryption and publication
belong to the caller; capture completeness never asserts scanner coverage.
"""
import hashlib,json,os,sys,uuid
from pathlib import Path
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent))
from capture import capture,credential_ranges
from workspace_capture import WorkspaceCapture
from validation import capture_gaps,tool_capture_gaps


def save(path,value):
    path.write_text(json.dumps(value,indent=2,sort_keys=True)+'\n')


def hashes(case):
    root=Path(case['path']);observed=[]
    # Match the manifest's relative path order, including dist and dist-server.
    for path in sorted(root.rglob('*'),key=lambda path:str(path.relative_to(root))):
        if path.is_symlink():raise ValueError('input symlink')
        if path.is_file():observed.append({'path':str(path.relative_to(root)),
            'size':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        elif not path.is_dir():raise ValueError('input special file')
    if observed!=sorted(case['files'],key=lambda row:row['path']):
        raise ValueError('original file identity differs')
    return observed


def tool_capture_requirements(case_id,report):
    required=['skillspector','aig-skill-scan','codex']
    if case_id=='sn-ppt-workbench-2026.10.29':
        return {'required':required,'normallySkipped':{},'gaps':[]}
    if case_id!='mcpherson-governance-openclaw-0.8.0':
        raise ValueError('unknown fixed original')
    valid=False
    if isinstance(report,dict):
        target=report.get('target');scanners=report.get('scanners')
        aig=scanners.get('aig')if isinstance(scanners,dict)else None
        valid=(report.get('schemaVersion')=='clawscan-run-v1'and report.get('profile')=='clawhub'
            and isinstance(target,dict)and target.get('kind')=='plugin'
            and isinstance(aig,dict)and aig.get('status')=='skipped'
            and aig.get('error')=='Scanner aig does not support plugin targets.'
            and aig.get('command')is None and aig.get('raw')is None
            and aig.get('exitCode')is None and aig.get('commandStarted',False)is False)
    if not valid:
        return {'required':required,'normallySkipped':{},
            'gaps':['fixed079 normal plugin AIG non-applicability not proven']}
    return {'required':['skillspector','codex'],
        'normallySkipped':{'aig':'reviewed scanner does not support plugin targets'},'gaps':[]}


def missing_tool_capture_gaps(output,requirements):
    return [name+' tool capture absent or unreached'for name in requirements['required']
        if not any((output/'tool-captures').glob(name+'-*'))]


def sandbox_arguments(work,output,home,command):
    # Codex uses /tmp for its daemon socket even when TMPDIR points elsewhere.
    return ['/usr/bin/bwrap','--unshare-user','--unshare-pid','--die-with-parent',
        '--ro-bind','/','/','--bind',str(work),str(work),'--bind',str(output),str(output),
        '--bind',str(home),str(home),'--tmpfs','/tmp',
        '--proc','/proc','--dev','/dev','--chdir',str(work),'--',*command]


def sandbox_preflight(root,config,child):
    work=root/'work';output=root/'evidence';home=root/'home'
    tool=config['tools']['codex'];codex=Path(tool['path'])
    if hashlib.sha256(codex.read_bytes()).hexdigest()!=tool['sha256']:
        raise ValueError('preflight Codex tool changed')
    fixture=root/'preflight-readonly.txt';marker=work/'preflight-workspace.txt'
    fixture.write_text('PUBLIC_INERT_READONLY_PROBE\n')
    inner=r"""import os,sys
from pathlib import Path
work,fixture=map(Path,sys.argv[1:])
assert work.read_text()=='PUBLIC_INERT_WORKSPACE_PROBE\n'
assert fixture.read_text()=='PUBLIC_INERT_READONLY_PROBE\n'
for path in (work,fixture,Path('/etc/CLAWSCAN_PREFLIGHT_WRITE'),Path('/tmp/CLAWSCAN_PREFLIGHT_WRITE')):
    try:
        with path.open('ab')as stream:stream.write(b'WRITE_MUST_BE_DENIED')
    except OSError:pass
    else:raise AssertionError('inner sandbox write allowed')
print('INNER_READ_OK_FOUR_WRITES_DENIED')
"""
    outer=r"""import os,subprocess,sys
from pathlib import Path
codex,work,fixture,inner=sys.argv[1:];work=Path(work)
assert not any(os.environ.get(key)for key in ('OPENAI_API_KEY','CODEX_API_KEY','LLM_API_KEY'))
assert not Path('/tmp',f'codex-daemon-{os.getuid()}').exists()
work.write_text('PUBLIC_INERT_WORKSPACE_PROBE\n')
print('OUTER_WORKSPACE_WRITABLE_FRESH_PRIVATE_TMP',flush=True)
result=subprocess.run([codex,'sandbox','--permission-profile','diagnostic-readonly',
    '-c','permissions.diagnostic-readonly.filesystem={"/"="read"}',
    '-c','permissions.diagnostic-readonly.network.enabled=false','-C',str(work.parent),
    '--',sys.executable,'-I','-B','-c',inner,str(work),fixture],check=False)
assert result.returncode==0
assert work.read_text()=='PUBLIC_INERT_WORKSPACE_PROBE\n'
work.write_text('OUTER_WORKSPACE_STILL_WRITABLE\n')
print('PREFLIGHT_PASSED',flush=True)
"""
    command=[sys.executable,'-I','-B','-c',outer,str(codex),str(marker),str(fixture),inner]
    argv=sandbox_arguments(work,output,home,command)
    argv.insert(1,'--unshare-net')
    # Explicit allowlist excludes all provider aliases and capture-proxy context.
    env={key:child[key]for key in ('PATH','HOME','CODEX_HOME','TMPDIR','TMP','TEMP','LANG')}
    evidence=output/'sandbox-preflight'
    try:
        result=capture(argv,work,env,evidence,timeout=60,new_session=False)
        gaps=capture_gaps(evidence,output_root=output,expected={'argv':argv,'cwd':str(work)})
        passed=result['exitCode']==0 and not result['timedOut']and not gaps
        save(output/'sandbox-preflight.json',{'passed':passed,'modelCalls':0,
            'originalExecution':False,'providerCredentialsPresent':False,'captureGaps':gaps})
        if not passed:raise ValueError('credential-free sandbox preflight failed')
    finally:
        marker.unlink(missing_ok=True);fixture.unlink(missing_ok=True)


def run(root):
    config=json.loads((root/'harness/runtime.json').read_text())
    originals={'sn-ppt-workbench-2026.10.29':(26,3862533,'ea3f5eb2634dffda246aacd1798f9d4915b0cd223feeb2cd7de35e9d3856c6c8'),
        'mcpherson-governance-openclaw-0.8.0':(106,762020,'3c28e5bc78b2dc13fa817b7faa3b14a0f1810fd22a7faf1055d2cde7fe3a44c0')}
    if (len(config['cases'])!=1 or next(iter(config['cases']))not in originals
        or config.get('source')!='b08e2907eb60b33bf712b07673aff565c13d9ad7'):
        raise ValueError('fixed original/source scope differs')
    case_id=next(iter(config['cases']));case=config['cases'][case_id]
    count,size,manifest_hash=originals[case_id]
    files=sorted(case['files'],key=lambda row:row['path'])
    if (len(files)!=count or sum(row['size']for row in files)!=size
        or hashlib.sha256(json.dumps(files,sort_keys=True,separators=(',',':')).encode()).hexdigest()
            !=manifest_hash):
        raise ValueError('fixed original manifest differs')
    output=root/'evidence';work=root/'work';home=root/'home'
    # Exclusive reservation: this controller never retries or reuses a namespace.
    (root/'one-case-reservation').open('x').close()
    work.mkdir();home.mkdir();(home/'.codex').mkdir();(root/'contexts').mkdir()
    before=hashes(case);save(output/'original-hashes-before.json',before)
    child={'PATH':config['childPath'],'HOME':str(home),'CODEX_HOME':str(home/'.codex'),
        'TMPDIR':str(work),'TMP':str(work),'TEMP':str(work),'LANG':'C.UTF-8',
        'PYTHONDONTWRITEBYTECODE':'1','PYTHONNOUSERSITE':'1','NO_COLOR':'1',
        'DEFAULT_BASE_URL':'https://api.openai.com/v1','DEFAULT_MODEL':'gpt-6.1-sol',
        'REASONING_EFFORT':'medium','SKILLSPECTOR_PROVIDER':'openai',
        'SKILLSPECTOR_MODEL':'gpt-6.1-sol','SKILLSPECTOR_REASONING_EFFORT':'medium',
        'CLAWSCAN_PROGRESS':'1','CLAWSCAN_CHILD_PROGRESS':'1'}
    context_path=root/('contexts/original079.json'if case_id=='mcpherson-governance-openclaw-0.8.0'else'contexts/original038.json')
    context={'captureRunId':uuid.uuid4().hex,'mode':'live','original':case['path'],
        'work':str(work),'output':str(output),'environment':child}
    save(context_path,context)
    save(output/'capture-context.json',context)
    env={**child,'PATH':str(root/'harness/bin')+':'+child['PATH'],
        'CLAWSCAN_CAPTURE_CONTEXT':str(context_path)}
    sandbox_preflight(root,config,child)
    secrets=tuple({os.environ[name].encode() for name in
        ('OPENAI_API_KEY','CODEX_API_KEY','LLM_API_KEY') if os.environ.get(name)})
    if not secrets:raise ValueError('provider key absent')
    for name in ('OPENAI_API_KEY','CODEX_API_KEY','LLM_API_KEY'):
        if os.environ.get(name):env[name]=os.environ[name]
    native_result=work/'clawscan-result.json'
    native=[config['native'],case['path'],'--profile','clawhub','--output',
        str(native_result),'--sandbox','off']
    argv=sandbox_arguments(work,output,home,native)
    save(output/'bounded-plan.json',{'nativeArgv':native,'outerTimeoutSeconds':900,
        'automaticTopLevelRetries':0,'nativePolicyUnchanged':True,'expectedVerdict':None})
    watcher=WorkspaceCapture(work,output/'workspace-capture',secrets);watcher.start()
    result=None;gaps=[];native_report=None
    try:
        # Parent runWorkerCommand owns this process group and confirms its cleanup.
        result=capture(argv,work,env,output/'native-capture',
            {'clawscan-result.json':native_result},secrets,timeout=900,
            new_session=False,identity={'runId':context['captureRunId'],
                'context':str(context_path),'tool':'native'})
    finally:
        watcher.finish()
        gaps.extend(capture_gaps(output/'workspace-capture',workspace=True,output_root=output))
        try:save(output/'original-hashes-after.json',hashes(case))
        except Exception:gaps.append('original after-scan hash verification failed')
        gaps.extend(capture_gaps(output/'native-capture',output_root=output,
            expected={'argv':argv,'cwd':str(work),'identity':{'runId':context['captureRunId'],
                'context':str(context_path),'tool':'native'}},
            required_paths={'clawscan-result.json':native_result}))
        if native_result.is_symlink() or not native_result.is_file():
            gaps.append('native report missing or invalid file type')
        else:
            raw=native_result.read_bytes()
            if credential_ranges(raw,secrets,final=True):
                save(output/'native-result-withheld.json',{'sourceBytes':len(raw),
                    'sourceSha256':hashlib.sha256(raw).hexdigest(),'withheldInjectedCredential':True})
                gaps.append('native report contains injected credential; bytes withheld')
            else:
                (output/'clawscan-result.json').write_bytes(raw)
                try:native_report=json.loads(raw)
                except (ValueError,UnicodeError):pass
        applicability=tool_capture_requirements(case_id,native_report)
        gaps.extend(applicability['gaps'])
        gaps.extend(missing_tool_capture_gaps(output,applicability))
        for folder in sorted((output/'tool-captures').glob('*')):
            gaps.extend(tool_capture_gaps(folder,output,work,config,context_path,context))
        if result is None:gaps.append('native capture result absent')
        inventory=[]
        for path in sorted(output.rglob('*')):
            if path.is_symlink():gaps.append('capture contains symlink')
            elif path.is_file():inventory.append({'path':str(path.relative_to(output)),
                'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        save(output/'capture-inventory.json',{'files':inventory,'nativeResult':result,
            'captureComplete':not gaps,'captureGaps':gaps,'scannerCoverageClaimed':False,
            'toolApplicability':applicability,
            'acceptanceReviewed':False,'automaticRetryPermitted':False})
    return 0 if not gaps and result is not None and result['exitCode'] in (0,1) else 78


if __name__=='__main__':
    try:raise SystemExit(run(Path(__file__).resolve().parent.parent))
    except Exception as error:
        output=Path(__file__).resolve().parent.parent/'evidence'
        save(output/'controller-error.json',{'failureClass':type(error).__name__,
            'captureComplete':False,'automaticRetryPermitted':False})
        # No exception text or raw scanner output enters the Actions console.
        os.write(2,b'FIXED_ORIGINAL_CAPTURE_FAILED\n');raise SystemExit(78)
