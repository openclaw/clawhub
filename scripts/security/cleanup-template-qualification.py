"""Remove only the captured, private Template qualification root after finality.

This is not a general cleanup CLI. The caller creates the root and supplies its
pre-scan identity. No shell, chmod/chown, symlink traversal or cross-device walk.
All output is a bounded enum; exceptions and paths must never reach logs.
"""

import errno
import json
import os
import re
import signal
import stat
import sys

FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
MAX_ENTRIES = 10000
MAX_DEPTH = 64
CODES = {"EACCES", "EPERM", "EBUSY", "ENOTEMPTY", "ENOENT", "EIO", "ENOSPC",
         "EROFS", "EMFILE", "ENFILE", "ELOOP", "EXDEV"}


class Refusal(Exception):
    pass


def deadline(_signal, _frame):
    raise Refusal("limit")


def open_parent(path):
    # Reject even ancestor symlinks rather than resolving arbitrary host paths.
    if not path.startswith("/") or os.path.normpath(path) != path:
        raise Refusal("identity")
    parts = path.split("/")[1:]
    if not re.fullmatch(r"template-qualification-[A-Za-z0-9]{6}", parts[-1]):
        raise Refusal("identity")
    fd = os.open("/", FLAGS)
    try:
        for part in parts[:-1]:
            child = os.open(part, FLAGS, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd, parts[-1]
    except BaseException:
        os.close(fd)
        raise


def cleanup():
    if len(sys.argv) != 5:
        raise Refusal("identity")
    path, device, inode, owner = sys.argv[1:]
    expected = (int(device), int(inode), int(owner))
    # sudo must represent the same non-root owner recorded before scanning.
    # Unprivileged invocation is also safe/useful for the regression tests.
    caller = int(os.environ.get("SUDO_UID", str(os.getuid())))
    if expected[2] == 0 or caller != expected[2]:
        raise Refusal("identity")
    parent, name = open_parent(path)
    try:
        root = os.open(name, FLAGS, dir_fd=parent)
        try:
            info = os.fstat(root)
            if ((info.st_dev, info.st_ino, info.st_uid) != expected
                    or stat.S_IMODE(info.st_mode) != 0o700):
                raise Refusal("identity")
            count = 0

            def remove_entries(fd, depth):
                nonlocal count
                if depth > MAX_DEPTH:
                    raise Refusal("limit")
                with os.scandir(fd) as entries:
                    for entry in entries:
                        count += 1
                        if count > MAX_ENTRIES:
                            raise Refusal("limit")
                        child_info = os.stat(entry.name, dir_fd=fd, follow_symlinks=False)
                        if child_info.st_dev != expected[0]:
                            raise Refusal("EXDEV")
                        if stat.S_ISDIR(child_info.st_mode):
                            child = os.open(entry.name, FLAGS, dir_fd=fd)
                            try:
                                opened = os.fstat(child)
                                if (opened.st_dev, opened.st_ino) != (child_info.st_dev, child_info.st_ino):
                                    raise Refusal("identity")
                                remove_entries(child, depth + 1)
                            finally:
                                os.close(child)
                            os.rmdir(entry.name, dir_fd=fd)
                        else:
                            # Includes symlinks and hardlinks: unlink only, never open.
                            os.unlink(entry.name, dir_fd=fd)

            remove_entries(root, 0)
            current = os.stat(name, dir_fd=parent, follow_symlinks=False)
            if (current.st_dev, current.st_ino) != expected[:2]:
                raise Refusal("identity")
            os.rmdir(name, dir_fd=parent)
        finally:
            os.close(root)
    finally:
        os.close(parent)


if __name__ == "__main__":
    error = None
    try:
        signal.signal(signal.SIGALRM, deadline)
        signal.alarm(10)
        cleanup()
    except Refusal as failure:
        error = str(failure)
    except OSError as failure:
        code = errno.errorcode.get(failure.errno, "other")
        error = code if code in CODES else "other"
    except Exception:
        error = "other"
    finally:
        signal.alarm(0)
    print(json.dumps({"error": error}))
