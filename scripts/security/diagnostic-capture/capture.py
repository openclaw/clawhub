"""Capture trusted subprocesses without changing their arguments, reports or exit status.

Originals and models are never invoked by this module itself. Runtime qualification
and bridge authorization belong to the sealed caller. Snapshot gaps remain gaps.
"""
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import select
import subprocess
import threading
import time


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def open_boundary_directory(path):
    path=Path(path)
    if not path.is_absolute() or '..' in path.parts:raise ValueError('absolute directory boundary required')
    fd=os.open('/',os.O_RDONLY|os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
            os.close(fd);fd=child
        return fd
    except BaseException:
        os.close(fd);raise


def context_boundary_observation(cwd, boundary, identity):
    """Prove the current live boundary while its temporary directories exist.

    The sealed proxy supplies the current context, never a prior-run certificate.
    Directory opens reject symlinks at every component; no context values are saved.
    """
    cwd=Path(cwd);work=Path(boundary['work']);context_path=Path(boundary['contextPath'])
    context=boundary['context']
    if (not all(p.is_absolute() and '..' not in p.parts for p in [cwd,work,context_path])
        or context.get('mode')!='live' or context.get('work')!=str(work)
        or identity.get('runId')!=context.get('captureRunId')
        or identity.get('context')!=str(context_path)):
        raise ValueError('current context boundary differs')
    relative=cwd.relative_to(work)
    def directory_record(fd,path):
        s=os.fstat(fd)
        return {'path':str(path),'device':s.st_dev,'inode':s.st_ino,
                'mode':s.st_mode,'uid':s.st_uid,'gid':s.st_gid}
    fd=open_boundary_directory(work);chain=[]
    try:
        chain.append(directory_record(fd,work));path=work
        for part in relative.parts:
            child=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
            os.close(fd);fd=child;path=path/part
            chain.append(directory_record(fd,path))
    finally:os.close(fd)
    parent=open_boundary_directory(context_path.parent)
    try:
        fd=os.open(context_path.name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
        with os.fdopen(fd,'rb') as stream:
            before=os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode):raise ValueError('context regular file required')
            raw=stream.read();after=os.fstat(stream.fileno())
        current=os.stat(context_path.name,dir_fd=parent,follow_symlinks=False)
        signature=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
        if signature(before)!=signature(after) or signature(after)!=signature(current):
            raise ValueError('context changed while read')
        if json.loads(raw)!=context:raise ValueError('current context bytes differ')
    finally:os.close(parent)
    return {'cwd':str(cwd),'work':str(work),'contextPath':str(context_path),
            'contextSha256':digest(raw),'directories':chain}


def credential_ranges(data, secrets, final=False):
    """Union complete matches and, at finalization, unresolved suffix prefixes."""
    spans = []
    for secret in secrets:
        start = 0
        while True:
            pos = data.find(secret, start)
            if pos < 0:
                break
            spans.append((pos, pos + len(secret)))
            start = pos + 1
        if final:
            for size in range(min(len(data), len(secret) - 1), 0, -1):
                if data.endswith(secret[:size]):
                    spans.append((len(data) - size, len(data)))
                    break
    merged = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged


class StreamCapture:
    """Source integrity is distinct from persisted, conservatively redacted bytes."""
    def __init__(self, path, secrets, forward=None):
        self.output = path.open('xb')
        self.secrets = [s for s in secrets if s]
        self.tail_size = max([len(s) for s in self.secrets] + [1]) - 1
        self.pending = b''
        self.sha = hashlib.sha256()
        self.bytes = 0
        self.persisted_sha = hashlib.sha256()
        self.persisted_bytes = 0
        self.redacted = False
        self.forward = forward

    def accept(self, data):
        self.sha.update(data)
        self.bytes += len(data)
        self.pending += data
        boundary = max(0, len(self.pending) - self.tail_size)
        # A match overlapping the retained suffix must remain whole. Unioning
        # overlaps also prevents one replacement from exposing another marker.
        for start, end in credential_ranges(self.pending, self.secrets):
            if start < boundary < end:
                boundary = start
        self.flush_prefix(boundary)

    def flush_prefix(self, length, final=False):
        data, self.pending = self.pending[:length], self.pending[length:]
        spans = credential_ranges(data, self.secrets, final)
        chunks = []
        offset = 0
        for start, end in spans:
            chunks.extend((data[offset:start], b'[REDACTED_INJECTED_CREDENTIAL]'))
            offset = end
        chunks.append(data[offset:])
        data = b''.join(chunks)
        self.redacted |= bool(spans)
        if self.output.write(data) != len(data):
            raise OSError('short capture write')
        self.output.flush()
        self.persisted_sha.update(data)
        self.persisted_bytes += len(data)
        if self.forward is not None and data:
            self.forward(data)

    def finish(self):
        try:
            # Even normal EOF cannot establish that an incomplete marker suffix
            # is safe to disclose. Never persist or forward that unresolved tail.
            self.flush_prefix(len(self.pending), final=True)
        finally:
            self.output.close()
        return {'sourceSha256': self.sha.hexdigest(), 'sourceBytes': self.bytes,
                'persistedSha256': self.persisted_sha.hexdigest(),
                'persistedBytes': self.persisted_bytes,
                'injectedCredentialRedacted': self.redacted}


class ForwardCapture:
    """Never call a buffered stdio write/flush or hold its shutdown lock.

    The destination must expose a POSIX pipe/socket descriptor. O_NONBLOCK is
    shared with its duplicate; the supervisor restores modes after all readers.
    """
    def __init__(self, destination, stop):
        import stat
        self.fd = None
        self.stop = stop
        if destination is not None:
            fd = destination.fileno()
            mode = os.fstat(fd).st_mode
            if not (stat.S_ISFIFO(mode) or stat.S_ISSOCK(mode)):
                raise ValueError('forwarding requires a pipe or socket')
            self.fd = os.dup(fd)
            try:
                os.set_blocking(self.fd, False)
            except BaseException:
                os.close(self.fd)
                self.fd = None
                raise

    def write(self, data):
        view = memoryview(data)
        while view:
            if self.stop.is_set():
                raise TimeoutError('forward drain interrupted')
            _, ready, _ = select.select([], [self.fd], [], 0.025)
            if not ready:
                continue
            try:
                size = os.write(self.fd, view[:65536])
            except BlockingIOError:
                continue
            if size <= 0:
                raise OSError('short forward write')
            view = view[size:]

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None


def reject_forward_aliases(stdout, stderr):
    """Independent source scrubbers cannot safely feed one merged destination.

    Compare kernel FIFO/socket identity, including dup() and distinct wrappers.
    Downstream merging or concurrent outside writers is not a supported contract.
    Do this before creating evidence, changing descriptor modes or launching a child.
    """
    if stdout is None or stderr is None:
        return
    import stat
    identities = []
    for destination in (stdout, stderr):
        info = os.fstat(destination.fileno())
        if not (stat.S_ISFIFO(info.st_mode) or stat.S_ISSOCK(info.st_mode)):
            raise ValueError('forwarding requires distinct pipes or sockets')
        identities.append((info.st_dev, info.st_ino, stat.S_IFMT(info.st_mode)))
    if identities[0] == identities[1]:
        raise ValueError('aliased forwarding destinations unsupported')


class Snapshots:
    """Preserve exact observed bytes and explicitly retain missing/withheld states."""
    def __init__(self, evidence, named_paths, secrets):
        self.root = evidence / 'snapshots'
        self.root.mkdir()
        self.paths = named_paths
        self.secrets = [s for s in secrets if s]
        self.seen = {}
        self.records = []
        self.lock = threading.Lock()
        self.errors = []

    def take(self, phase):
        with self.lock:
            for label, path in self.paths.items():
                try:
                    # No symlinks, credential directories, or arbitrary recursive HOME read.
                    fd = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
                    with os.fdopen(fd, 'rb') as f:
                        data = f.read()
                except FileNotFoundError:
                    continue
                except OSError as error:
                    self.errors.append({'label': label, 'phase': phase,
                                        'failureClass': type(error).__name__})
                    continue
                sha = digest(data)
                if self.seen.get(label) == sha:
                    continue
                self.seen[label] = sha
                record = {'label': label, 'path': str(path), 'phase': phase, 'sha256': sha,
                          'bytes': len(data), 'observedAtNs': time.time_ns()}
                if credential_ranges(data, self.secrets, final=True):
                    record['withheldInjectedCredential'] = True
                else:
                    target = self.root / (str(len(self.records)).zfill(5) + '.raw')
                    target.write_bytes(data)
                    record['file'] = str(target.relative_to(self.root.parent))
                    record['exactBytesPreserved'] = True
                self.records.append(record)
            save(self.root.parent / 'snapshot-index.json', {
                'observations': self.records, 'readErrors': self.errors,
                'neverObserved': sorted(set(self.paths) - set(self.seen)),
                'limitation': 'Only observed bytes are proved. SIGKILL, missing reports or read races are explicit gaps.'})


def capture(argv, cwd, env, evidence, named_paths=None, secrets=(), timeout=None,
            forward_stdout=None, forward_stderr=None, input_stream=None, new_session=True,
            identity=None, context_boundary=None):
    reject_forward_aliases(forward_stdout, forward_stderr)
    evidence = Path(evidence)
    evidence.mkdir(parents=True, exist_ok=False)
    secrets = tuple(s for s in secrets if s)
    if any(s.decode('ascii', 'ignore') in value for s in secrets for value in argv):
        raise RuntimeError('credential in arguments rejected')
    # Preserve names only. Never serialize environment values.
    save(evidence / 'invocation.json', {'argv': argv, 'cwd': str(cwd),
        'environmentNames': sorted(env), 'environmentValuesRecorded': False,
        'payloadExecutionByHarness': False, 'startedAtNs': time.time_ns(),
        'evidence': str(evidence), 'identity': identity,
        'namedPaths': {label: str(path) for label, path in (named_paths or {}).items()}})
    boundary_before=None
    if context_boundary is not None:
        boundary_before=context_boundary_observation(cwd,context_boundary,identity)
        boundary_started=time.time_ns()
    snapshots = Snapshots(evidence, named_paths or {}, secrets)
    snapshots.take('before')
    stop = threading.Event()
    def monitor():
        while not stop.wait(0.025):
            snapshots.take('during')
    watcher = threading.Thread(target=monitor, daemon=True)
    watcher.start()
    streams = {}
    p = None
    timed_out = False
    failures = []
    drain_stop = threading.Event()
    # Read all original modes before either reader changes a shared descriptor.
    forward_modes = {}
    for destination in (forward_stdout, forward_stderr):
        if destination is not None:
            try:
                fd = destination.fileno()
                forward_modes[fd] = os.get_blocking(fd)
            except (AttributeError, OSError, ValueError):
                pass  # Reader records the explicit unsupported-destination failure.
    def copy(pipe, label, destination):
        recorder = None
        forwarder = None
        forwarding_failed = False
        eof = False
        def forward(data):
            nonlocal forwarding_failed
            if forwarder is None or forwarding_failed:
                return
            try:
                forwarder.write(data)
            except BaseException as error:
                forwarding_failed = True
                failures.append({'stream': label, 'failureClass':
                    'ForwardDrainTimeout' if isinstance(error, TimeoutError) else type(error).__name__})
        try:
            # Setup failure must remain explicit without discarding source bytes.
            if destination is not None:
                try:
                    forwarder = ForwardCapture(destination, drain_stop)
                except BaseException as error:
                    forwarding_failed = True
                    failures.append({'stream': label, 'failureClass': type(error).__name__})
            recorder = StreamCapture(evidence / (label + '.log'), secrets, forward)
            fd = pipe.fileno()
            os.set_blocking(fd, False)
            while True:
                if drain_stop.is_set():
                    failures.append({'stream': label, 'failureClass': 'PipeDrainTimeout'})
                    break
                ready, _, _ = select.select([fd], [], [], 0.025)
                if not ready:
                    continue
                try:
                    data = os.read(fd, 65536)
                except BlockingIOError:
                    continue
                if not data:
                    eof = True
                    break
                recorder.accept(data)
        except BaseException as error:
            failures.append({'stream': label, 'failureClass': type(error).__name__})
        finally:
            try:
                if recorder is not None:
                    streams[label] = dict(recorder.finish(), sourceComplete=eof,
                                          captureTruncated=not eof)
            except BaseException as error:
                failures.append({'stream': label, 'failureClass': type(error).__name__,
                                 'phase': 'finalize'})
            finally:
                if recorder is not None and not recorder.output.closed:
                    recorder.output.close()
                try:
                    pipe.close()
                finally:
                    if forwarder is not None:
                        forwarder.close()

    try:
        p = subprocess.Popen(argv, cwd=cwd, env=env,
                             stdin=subprocess.DEVNULL if input_stream is None else input_stream,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             start_new_session=new_session)
        threads = [threading.Thread(target=copy, args=(p.stdout, 'stdout', forward_stdout), daemon=True),
                   threading.Thread(target=copy, args=(p.stderr, 'stderr', forward_stderr), daemon=True)]
        for thread in threads:
            thread.start()
        try:
            p.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            snapshots.take('before-timeout-termination')
            os.killpg(p.pid, signal.SIGTERM) if new_session else p.terminate()
            try:
                p.wait(timeout=2)
            except subprocess.TimeoutExpired:
                os.killpg(p.pid, signal.SIGKILL) if new_session else p.kill()
                p.wait()
        for thread in threads:
            thread.join(timeout=5)
        if any(thread.is_alive() for thread in threads):
            drain_stop.set()
            for thread in threads:
                thread.join(timeout=0.1)
            if any(thread.is_alive() for thread in threads):
                failures.append({'stream': 'supervisor', 'failureClass': 'UnfinishedPipeDrain'})
        if all(not thread.is_alive() for thread in threads):
            for fd, blocking in forward_modes.items():
                try:
                    os.set_blocking(fd, blocking)
                except OSError as error:
                    failures.append({'stream': 'supervisor', 'phase': 'forward-mode-restore',
                                     'failureClass': type(error).__name__})
        stop.set()
        watcher.join(timeout=2)
        if watcher.is_alive():
            failures.append({'stream': 'supervisor', 'failureClass': 'UnfinishedSnapshotMonitor'})
        snapshots.take('after-command-before-native-cleanup')
        certificate_sha=None
        if context_boundary is not None:
            try:
                boundary_after=context_boundary_observation(cwd,context_boundary,identity)
                if boundary_after!=boundary_before:raise ValueError('context boundary changed during command')
                directory_fd=open_boundary_directory(evidence)
                try:
                    fd=os.open('invocation.json',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=directory_fd)
                    with os.fdopen(fd,'rb')as stream:
                        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):raise ValueError('invocation regular file required')
                        invocation_sha=digest(stream.read())
                    certificate={'schema':'capture-context-certificate-v1','identity':identity,
                        'evidence':str(evidence),'invocationSha256':invocation_sha,
                        'checkedBeforeCommandAtNs':boundary_started,'checkedAfterCommandAtNs':time.time_ns(),
                        **boundary_before}
                    raw=(json.dumps(certificate,indent=2,sort_keys=True)+'\n').encode()
                    fd=os.open('context-certificate.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=directory_fd)
                    with os.fdopen(fd,'wb')as stream:
                        stream.write(raw);stream.flush();os.fsync(stream.fileno())
                    certificate_sha=digest(raw)
                finally:os.close(directory_fd)
            except (OSError,ValueError,TypeError,KeyError) as error:
                failures.append({'stream':'supervisor','phase':'context-certificate',
                                 'failureClass':type(error).__name__})
        result = {'exitCode': p.returncode, 'timedOut': timed_out,
                  'streams': dict(streams), 'captureFailures': list(failures),
                  'rawReportsModified': False, 'finishedAtNs': time.time_ns(),
                  'captureThreadsComplete': all(not t.is_alive() for t in threads)}
        if context_boundary is not None:result['contextCertificateSha256']=certificate_sha
        save(evidence / 'result.json', result)
        return result
    finally:
        stop.set()
        watcher.join(timeout=2)
        if p is not None and p.poll() is None:
            os.killpg(p.pid, signal.SIGKILL) if new_session else p.kill()
            p.wait()
