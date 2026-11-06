"""Independent native workspace capture with held descriptors surviving unlink."""
import hashlib,json,os,stat,threading,time
from pathlib import Path
from capture import credential_ranges


class WorkspaceCapture:
    def __init__(self, work, output, secrets=()):
        self.work=Path(work);self.output=Path(output);self.output.mkdir()
        self.secrets=tuple(s for s in secrets if s)
        self.handles={};self.latest={};self.records=[];self.errors=[]
        self.stop_event=threading.Event();self.lock=threading.Lock()
        self.thread=threading.Thread(target=self.monitor,daemon=True)
    def start(self):
        self.take('before');self.thread.start()
    def discover(self):
        for root,dirs,files in os.walk(self.work,followlinks=False):
            dirs[:]=[d for d in dirs if not (Path(root)/d).is_symlink()]
            for name in files:
                path=Path(root)/name
                try:
                    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
                    info=os.fstat(fd)
                    if not stat.S_ISREG(info.st_mode):os.close(fd);continue
                    key=(str(path.relative_to(self.work)),info.st_dev,info.st_ino)
                    if key in self.handles:os.close(fd)
                    else:self.handles[key]=fd
                except FileNotFoundError:pass
                except OSError as error:self.errors.append({'path':str(path),'failureClass':type(error).__name__})
    def take(self,phase):
        with self.lock:
            self.discover()
            for key,fd in self.handles.items():
                try:
                    info=os.fstat(fd)
                    # Read the observed length without disturbing the producer offset.
                    chunks=[];offset=0
                    while offset<info.st_size:
                        chunk=os.pread(fd,min(1048576,info.st_size-offset),offset)
                        if not chunk:break
                        chunks.append(chunk);offset+=len(chunk)
                    data=b''.join(chunks);sha=hashlib.sha256(data).hexdigest()
                    # Preserve the unlink transition once, then deduplicate unchanged bytes.
                    state=(sha,info.st_nlink==0)
                    if self.latest.get(key)==state:continue
                    self.latest[key]=state
                    record={'path':key[0],'device':key[1],'inode':key[2],
                            'phase':phase,'sha256':sha,'bytes':len(data),'observedAtNs':time.time_ns(),
                            'unlinkedAtObservation':info.st_nlink==0}
                    if credential_ranges(data, self.secrets, final=True):
                        record['withheldInjectedCredential']=True
                    else:
                        target=self.output/(str(len(self.records)).zfill(6)+'.raw')
                        target.write_bytes(data);record['file']=target.name;record['exactObservedBytes']=True
                    self.records.append(record)
                except OSError as error:self.errors.append({'path':key[0],'failureClass':type(error).__name__})
    def monitor(self):
        while not self.stop_event.wait(.025):self.take('during')
    def finish(self):
        self.stop_event.set();self.thread.join();self.take('after-processes-stopped')
        for fd in self.handles.values():os.close(fd)
        result={'observations':self.records,'readErrors':self.errors,
                'guarantee':'Exact observed bytes only; held descriptors retain later bytes after unlink.',
                'gaps':'A file created and unlinked before discovery may be absent. Synchronous tool wrappers capture normal completion before native cleanup. Missing capture is a failure, never a retry authorization.'}
        (self.output/'index.json').write_text(json.dumps(result,indent=2)+'\n')
        return result
