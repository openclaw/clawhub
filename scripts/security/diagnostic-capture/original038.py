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
    for path in sorted(root.rglob('*')):
        if path.is_symlink():raise ValueError('input symlink')
        if path.is_file():observed.append({'path':str(path.relative_to(root)),
            'size':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        elif not path.is_dir():raise ValueError('input special file')
    if observed!=sorted(case['files'],key=lambda row:row['path']):
        raise ValueError('original file identity differs')
    return observed


def run(root):
    config=json.loads((root/'harness/runtime.json').read_text())
    if set(config['cases'])!={'sn-ppt-workbench-2026.10.29'} or config.get('source')!='b08e2907eb60b33bf712b07673aff565c13d9ad7':
        raise ValueError('fixed original/source scope differs')
    case=config['cases']['sn-ppt-workbench-2026.10.29']
    files=sorted(case['files'],key=lambda row:row['path'])
    if (len(files)!=26 or sum(row['size']for row in files)!=3862533
        or hashlib.sha256(json.dumps(files,sort_keys=True,separators=(',',':')).encode()).hexdigest()
            !='ea3f5eb2634dffda246aacd1798f9d4915b0cd223feeb2cd7de35e9d3856c6c8'):
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
    context_path=root/'contexts/original038.json'
    context={'captureRunId':uuid.uuid4().hex,'mode':'live','original':case['path'],
        'work':str(work),'output':str(output),'environment':child}
    save(context_path,context)
    save(output/'capture-context.json',context)
    env={**child,'PATH':str(root/'harness/bin')+':'+child['PATH'],
        'CLAWSCAN_CAPTURE_CONTEXT':str(context_path)}
    secrets=tuple({os.environ[name].encode() for name in
        ('OPENAI_API_KEY','CODEX_API_KEY','LLM_API_KEY') if os.environ.get(name)})
    if not secrets:raise ValueError('provider key absent')
    for name in ('OPENAI_API_KEY','CODEX_API_KEY','LLM_API_KEY'):
        if os.environ.get(name):env[name]=os.environ[name]
    native_result=work/'clawscan-result.json'
    native=[config['native'],case['path'],'--profile','clawhub','--output',
        str(native_result),'--sandbox','off']
    argv=['/usr/bin/bwrap','--unshare-user','--unshare-pid','--die-with-parent',
        '--ro-bind','/','/','--bind',str(work),str(work),'--bind',str(output),str(output),
        '--bind',str(home),str(home),'--proc','/proc','--dev','/dev','--chdir',str(work),'--',*native]
    save(output/'bounded-plan.json',{'nativeArgv':native,'outerTimeoutSeconds':900,
        'automaticTopLevelRetries':0,'nativePolicyUnchanged':True,'expectedVerdict':None})
    watcher=WorkspaceCapture(work,output/'workspace-capture',secrets);watcher.start()
    result=None;gaps=[]
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
            else:(output/'clawscan-result.json').write_bytes(raw)
        for name in ('skillspector','aig-skill-scan','codex'):
            if not any((output/'tool-captures').glob(name+'-*')):
                gaps.append(name+' tool capture absent or unreached')
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
