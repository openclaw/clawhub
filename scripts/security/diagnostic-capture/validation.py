"""Existing anchored capture validators, reused without weakening receipt checks."""
import hashlib,json,os,stat
from pathlib import Path
from proxy import native_arguments,required_reports

def capture_directory(folder,output_root):
    """Open the caller's output root and every descendant without following links.

    Absolute ancestry is opened from /, not from a resolved untrusted pathname.
    Handles keep subsequent reads anchored if an ancestor is renamed/replaced.
    """
    folder=Path(folder).absolute();root=Path(output_root).absolute()
    if '..' in folder.parts or '..' in root.parts:raise ValueError('directory boundary')
    relative=folder.relative_to(root)
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
    try:
        for part in (*root.parts[1:],*relative.parts):
            child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
            os.close(fd);fd=child
        return fd
    except BaseException:
        os.close(fd);raise


def evidence_file(directory_fd,relative):
    if (type(relative) is not str or not relative or Path(relative).is_absolute()
        or '..' in Path(relative).parts or not Path(relative).parts):
        raise ValueError('evidence child boundary')
    fd=os.dup(directory_fd)
    try:
        parts=Path(relative).parts
        for part in parts[:-1]:
            child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
            os.close(fd);fd=child
        result=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
        if not stat.S_ISREG(os.fstat(result).st_mode):
            os.close(result);raise ValueError('evidence regular file required')
        return result
    finally:os.close(fd)


def read_json_at(directory_fd,relative):
    with os.fdopen(evidence_file(directory_fd,relative),'rb') as f:
        return json.load(f)


def persisted_integrity(folder,relative,count,sha,directory_fd=None):
    """Hash actual anchored regular bytes, preserving source/persisted distinction."""
    if (type(count) is not int or count<0 or type(sha) is not str or len(sha)!=64
        or any(c not in '0123456789abcdef' for c in sha)):
        raise ValueError('persisted receipt shape')
    own=directory_fd is None
    if own:directory_fd=capture_directory(folder,Path(folder).parent)
    try:
        with os.fdopen(evidence_file(directory_fd,relative),'rb') as f:
            before=os.fstat(f.fileno());actual=hashlib.file_digest(f,'sha256').hexdigest()
            after=os.fstat(f.fileno())
        with os.fdopen(evidence_file(directory_fd,relative),'rb') as f:current=os.fstat(f.fileno())
        signature=lambda i:(i.st_dev,i.st_ino,i.st_size,i.st_mtime_ns,i.st_ctime_ns)
        if (before.st_size!=count or actual!=sha or signature(before)!=signature(after)
            or signature(after)!=signature(current)):
            raise ValueError('persisted bytes changed or incomplete')
    finally:
        if own:os.close(directory_fd)


def validate_invocation(invocation,folder,expected):
    if (not isinstance(invocation,dict) or invocation.get('evidence')!=str(folder)
        or type(invocation.get('argv')) is not list or not invocation['argv']
        or any(type(a) is not str for a in invocation['argv'])
        or type(invocation.get('cwd')) is not str
        or type(invocation.get('startedAtNs')) is not int or invocation['startedAtNs']<=0
        or type(invocation.get('namedPaths')) is not dict
        or any(type(k) is not str or not k or type(v) is not str or not v
               for k,v in invocation['namedPaths'].items())):
        raise ValueError('invocation shape or destination binding')
    if expected is not None and any(invocation.get(k)!=v for k,v in expected.items()):
        raise ValueError('current invocation/context differs')


def capture_gaps(folder,workspace=False,*,output_root=None,expected=None,required_paths=None):
    """Production callers supply their current output root and expected identity.

    Generic host byte-integrity controls may omit expected; that is not live
    completeness. The live call graph below never omits the current-run contract.
    """
    folder=Path(folder)
    try:fd=capture_directory(folder,output_root if output_root is not None else folder.parent)
    except (OSError,ValueError):return [folder.name+' capture directory boundary invalid']
    try:return _capture_gaps(folder,workspace,fd,expected,required_paths)
    finally:os.close(fd)


def tool_capture_gaps(folder,output,work,config,context_path,context):
    fd=None
    try:
        fd=capture_directory(folder,output)
        invocation=read_json_at(fd,'invocation.json')
        name=folder.name.split('-',1)[0]
        # aig-skill-scan includes hyphens; recognize only the exact known prefixes.
        names=[n for n in ('skillspector','aig-skill-scan','codex') if folder.name.startswith(n+'-')]
        if len(names)!=1:raise ValueError('unknown capture tool')
        name=names[0];cwd=Path(invocation['cwd'])
        # Native cleanup may already have removed cwd. Validate the receipt that
        # the trusted proxy made before returning, rather than reopening cwd.
        certificate=read_json_at(fd,'context-certificate.json')
        result=read_json_at(fd,'result.json')
        if not isinstance(certificate,dict) or not isinstance(result,dict):
            raise ValueError('context certificate or result shape')
        raw_fd=evidence_file(fd,'invocation.json')
        with os.fdopen(raw_fd,'rb')as stream:invocation_sha=hashlib.file_digest(stream,'sha256').hexdigest()
        persisted_integrity(folder,'context-certificate.json',
            os.stat('context-certificate.json',dir_fd=fd,follow_symlinks=False).st_size,
            result.get('contextCertificateSha256'),fd)
        if (not cwd.is_absolute() or '..'in cwd.parts or not Path(work).is_absolute()
            or '..'in Path(work).parts):raise ValueError('workspace path boundary')
        relative=cwd.relative_to(work)
        expected_certificate={'schema':'capture-context-certificate-v1',
            'identity':{'runId':context['captureRunId'],'context':str(context_path),'tool':name},
            'evidence':str(folder),'invocationSha256':invocation_sha,
            'cwd':str(cwd),'work':str(work),'contextPath':str(context_path)}
        if any(certificate.get(k)!=v for k,v in expected_certificate.items()):
            raise ValueError('contemporaneous context differs')
        context_fd=capture_directory(Path(context_path).parent,Path(context_path).parent)
        try:
            with os.fdopen(evidence_file(context_fd,Path(context_path).name),'rb')as stream:context_raw=stream.read()
        finally:os.close(context_fd)
        if (json.loads(context_raw)!=context or context.get('work')!=str(work)
            or context.get('output')!=str(output) or context.get('mode')!='live'
            or hashlib.sha256(context_raw).hexdigest()!=certificate.get('contextSha256')):
            raise ValueError('current context changed')
        chain=certificate.get('directories');paths=[str(work)];path=Path(work)
        for part in relative.parts:path=path/part;paths.append(str(path))
        if type(chain)is not list or len(chain)!=len(paths):raise ValueError('directory certificate shape')
        for record,path in zip(chain,paths):
            if (not isinstance(record,dict) or record.get('path')!=path
                or any(type(record.get(k))is not int or record[k]<0 for k in ['device','inode','mode','uid','gid'])
                or not stat.S_ISDIR(record['mode'])):raise ValueError('directory certificate boundary')
        if (type(certificate.get('checkedBeforeCommandAtNs'))is not int
            or type(certificate.get('checkedAfterCommandAtNs'))is not int
            or not invocation['startedAtNs']<=certificate['checkedBeforeCommandAtNs']
                <=certificate['checkedAfterCommandAtNs']<=result['finishedAtNs']):
            raise ValueError('context certificate time binding')
        expected={'identity':{'runId':context['captureRunId'],'context':str(context_path),'tool':name},
                  'argv':[config['tools'][name]['path'],*native_arguments(name,cwd,context['original'])],
                  'cwd':str(cwd)}
        return _capture_gaps(folder,False,fd,expected,required_reports(name,cwd))
    except (OSError,ValueError,TypeError,KeyError):
        return [folder.name+' tool invocation/context boundary invalid']
    finally:
        if fd is not None:os.close(fd)


def _capture_gaps(folder,workspace,directory_fd,expected,required_paths):
    """Missing, malformed or explicitly incomplete evidence cannot pass capture."""
    gaps=[]
    label=folder.name
    invocation=None;snapshot={}
    try:
        snapshot=read_json_at(directory_fd,'index.json' if workspace else 'snapshot-index.json')
        invocation=None
        if not workspace:
            invocation=read_json_at(directory_fd,'invocation.json')
            validate_invocation(invocation,folder,expected)
            named=invocation['namedPaths']
            required={**named, **(required_paths or {})}
            if any(named.get(k)!=str(v) for k,v in required.items()):
                raise ValueError('required named path binding')
        else:required={}
        fields=['observations','readErrors']+([] if workspace else ['neverObserved'])
        if not isinstance(snapshot,dict) or any(type(snapshot.get(k)) is not list for k in fields):
            raise ValueError('index shape')
        if snapshot['readErrors'] or (not workspace and snapshot['neverObserved']):
            gaps.append(label+' raw capture gaps; inspect index')
        observed=set()
        for record in snapshot['observations']:
            if (not isinstance(record,dict) or type(record.get('bytes')) is not int or record['bytes']<0
                or type(record.get('sha256')) is not str or len(record['sha256'])!=64
                or any(c not in '0123456789abcdef' for c in record['sha256'])
                or type(record.get('withheldInjectedCredential',False)) is not bool):
                raise ValueError('observation shape')
            if (type(record.get('phase')) is not str or not record['phase']
                or type(record.get('observedAtNs')) is not int or record['observedAtNs']<=0):
                raise ValueError('observation provenance')
            if not workspace:
                name=record.get('label')
                if (type(name) is not str or name not in named or record.get('path')!=named[name]
                    or record['phase'] not in ('before','during','before-timeout-termination',
                                              'after-command-before-native-cleanup')
                    or record['observedAtNs']<invocation['startedAtNs']):
                    raise ValueError('named observation provenance')
                observed.add(name)
            if record.get('withheldInjectedCredential'):
                gaps.append(label+' injected credential bytes withheld')
            else:
                if record.get('exactObservedBytes' if workspace else 'exactBytesPreserved') is not True:
                    raise ValueError('observation byte provenance')
                persisted_integrity(folder,record.get('file'),record['bytes'],record['sha256'],directory_fd)
        for name in required:
            if name not in observed:gaps.append(label+' required observation absent: '+name)
    except (OSError,ValueError,TypeError,KeyError,AttributeError):
        gaps.append(label+' snapshot index missing or malformed')
    if workspace:return gaps
    try:
        result=read_json_at(directory_fd,'result.json')
        if (type(result.get('finishedAtNs')) is not int or invocation is None
            or result['finishedAtNs']<invocation['startedAtNs']):
            raise ValueError('receipt time binding')
        if any(r['observedAtNs']>result['finishedAtNs'] for r in snapshot['observations']):
            raise ValueError('observation time binding')
        if (not isinstance(result,dict) or type(result.get('exitCode')) is not int
            or type(result.get('timedOut')) is not bool or type(result.get('captureFailures')) is not list
            or type(result.get('captureThreadsComplete')) is not bool or type(result.get('streams')) is not dict):
            raise ValueError('result shape')
        for name in ['stdout','stderr']:
            stream=result['streams'].get(name)
            if (not isinstance(stream,dict) or type(stream.get('sourceBytes')) is not int or stream['sourceBytes']<0
                or type(stream.get('sourceSha256')) is not str or len(stream['sourceSha256'])!=64
                or any(c not in '0123456789abcdef' for c in stream['sourceSha256'])
                or type(stream.get('injectedCredentialRedacted')) is not bool
                or type(stream.get('sourceComplete')) is not bool
                or type(stream.get('captureTruncated')) is not bool):
                raise ValueError('stream result shape')
            persisted_integrity(folder,name+'.log',stream.get('persistedBytes'),stream.get('persistedSha256'),directory_fd)
            if not stream['injectedCredentialRedacted'] and (stream['sourceBytes']!=stream['persistedBytes']
                or stream['sourceSha256']!=stream['persistedSha256']):
                raise ValueError('unredacted source mismatch')
            if not stream['sourceComplete'] or stream['captureTruncated']:
                gaps.append(label+' stream source truncated')
        if result['timedOut'] or result['captureFailures'] or not result['captureThreadsComplete']:
            gaps.append(label+' stream capture incomplete or timed out')
    except (OSError,ValueError,TypeError,KeyError,AttributeError):
        gaps.append(label+' result missing or malformed')
    return gaps

