#!/usr/bin/env python3
"""Only exact production tool invocations, with synchronous capture before return."""
import hashlib,json,os,sys,uuid,signal,stat
from pathlib import Path
sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent))
from capture import capture
from fixed_originals import skill_originals,validate_skill_case
Q = Path(__file__).resolve().parent.parent
def native_arguments(name,cwd,original):
    if name=='codex':
        return ['exec','--cd',str(cwd),'--model','gpt-6.1-sol','--sandbox','read-only',
            '--skip-git-repo-check','--ignore-user-config','-c','approval_policy=never',
            '-c','model_reasoning_effort=high','-c','service_tier="default"',
            '-c','shell_environment_policy.inherit="core"','-c','shell_environment_policy.ignore_default_excludes=false',
            '--output-schema',str(cwd/'schema.json'),'--output-last-message',str(cwd/'codex-result.json'),
            '--ephemeral','--json','-']
    if name=='skillspector':return ['scan','artifact','--format','json','--output',str(cwd/'skillspector-report-0.json')]
    if name=='aig-skill-scan':return ['--repo',original,'--language','en','-o',str(cwd/'aig-skill-scan.sarif.json')]
    raise RuntimeError('unknown tool')

def required_reports(name,cwd):
    filename={'codex':'codex-result.json','skillspector':'skillspector-report-0.json',
              'aig-skill-scan':'aig-skill-scan.sarif.json'}[name]
    paths={filename:cwd/filename}
    if name=='codex':
        for required in ['prompt.md','schema.json','metadata.json','artifact-inspection.json']:
            paths[required]=cwd/required
    return paths

def main():
    if not isinstance(Q,Path)or not Q.is_absolute():raise RuntimeError('unbound fixed-original proxy')
    config=json.loads((Q/'harness/runtime.json').read_text())
    name=Path(sys.argv[0]).name
    if name not in config['tools']:raise RuntimeError('unknown tool')
    context_path=Path(os.environ.get('CLAWSCAN_CAPTURE_CONTEXT','')).resolve()
    if Q/'contexts' not in context_path.parents:raise RuntimeError('context boundary')
    context=json.loads(context_path.read_text())
    cases=config.get('cases',{})
    skills=skill_originals()
    if (len(cases)!=1 or next(iter(cases)) not in
        {'sn-ppt-workbench-2026.10.29','mcpherson-governance-openclaw-0.8.0',*skills}
        or context.get('original')!=next(iter(cases.values())).get('path')):
        raise RuntimeError('Fixed original scope differs')
    case_id=next(iter(cases))
    if case_id in skills:validate_skill_case(config,case_id)
    cwd=Path.cwd().resolve();work=Path(context['work'])
    if cwd!=work and work not in cwd.parents:raise RuntimeError('workspace boundary')
    tool=config['tools'][name];path=Path(tool['path'])
    if hashlib.sha256(path.read_bytes()).hexdigest()!=tool['sha256']:raise RuntimeError('tool changed')
    args=sys.argv[1:];paths={}
    if context['mode']=='qualification':
        allowed=[['--help'],['--version']]
        if name=='codex':allowed.append(['exec','--help'])
        if args not in allowed:raise RuntimeError('qualification permits help/version only')
    elif context['mode']=='live' and config.get('readyForReview'):
        expected=native_arguments(name,cwd,context['original'])
        if args!=expected:raise RuntimeError('native argv differs')
        paths=required_reports(name,cwd)
    else:raise RuntimeError('unqualified mode')
    for p in cwd.rglob('*'):
        if p.is_file() and not p.is_symlink():paths[str(p.relative_to(cwd))]=p
    env=dict(context['environment'])
    # Only these injected process aliases are read; never serialize their values.
    for key in ('OPENAI_API_KEY','CODEX_API_KEY','LLM_API_KEY'):
        if os.environ.get(key):env[key]=os.environ[key]
    secrets=tuple(env[k].encode() for k in ('OPENAI_API_KEY','CODEX_API_KEY','LLM_API_KEY') if env.get(k))
    evidence=Path(context['output'])/'tool-captures'/(name+'-'+uuid.uuid4().hex)
    result=capture([str(path),*args],cwd,env,evidence,paths,secrets,
        input_stream=sys.stdin.buffer,forward_stdout=sys.stdout.buffer,forward_stderr=sys.stderr.buffer,
        new_session=False, identity={'runId':context['captureRunId'],
            'context':str(context_path),'tool':name} if context['mode']=='live' else None,
        context_boundary={'work':str(work),'contextPath':str(context_path),'context':context}
            if context['mode']=='live' else None)
    return result['exitCode']
def finish(code):
    if code>=0:raise SystemExit(code)
    signum=-code
    if signum not in (signal.SIGKILL,signal.SIGSTOP):signal.signal(signum,signal.SIG_DFL)
    os.kill(os.getpid(),signum)
    os._exit(128+signum)
if __name__=='__main__':
    try:code=main()
    except Exception as error:
        try:  # Never wait for a stopped consumer or interpreter stdio flush.
            mode=os.fstat(2).st_mode
            if stat.S_ISFIFO(mode) or stat.S_ISSOCK(mode):
                blocking=os.get_blocking(2)
                try:
                    os.set_blocking(2,False)
                    os.write(2,b'CAPTURE_PROXY_REFUSED\n')
                finally:
                    os.set_blocking(2,blocking)
        except (OSError,ValueError):
            pass  # One best-effort fixed diagnostic; never retry or use stdio.
        os._exit(78)
    finish(code)
