# VHS Execution Guide

## Pre-flight Checks

### VHS Installation

```bash
# Check if installed
which vhs

# Check version
vhs --version
```

### Dependencies

VHS requires:
- **ttyd**: Terminal emulator for web
- **ffmpeg**: Video/image encoding

```bash
# Verify dependencies
which ttyd ffmpeg
```

### Installation

```bash
# Go (recommended)
go install github.com/charmbracelet/vhs@latest

# macOS
brew install charmbracelet/tap/vhs

# Arch Linux
yay -S vhs

# Nix
nix-env -iA nixpkgs.vhs
```

### Tape File Validation

Check tape file before execution:

```bash
# Verify file exists
test -f tape-file.tape && echo "Found" || echo "Missing"

# Check for Output directive
rg -q "^Output" tape-file.tape && echo "Has output" || echo "No output directive"
# fallback: grep -q "^Output" tape-file.tape

# Validate syntax (dry run)
vhs validate tape-file.tape
```

## Environment Setup

### Terminal Environment

VHS creates an isolated terminal. Set environment variables in the tape:

```tape
Set Env "HOME" "/home/user"
Set Env "PATH" "/usr/local/bin:/usr/bin:/bin"
Set Env "TERM" "xterm-256color"
```

### Working Directory

VHS runs from the directory containing the tape file. For different directories:

```tape
Hide
Type "cd /path/to/project"
Enter
Sleep 500ms
Show
```

## Running VHS

### Basic Execution

```bash
vhs tape-file.tape
```

### With Options

```bash
# Publish to vhs.charm.sh (public)
vhs tape-file.tape --publish

# Output to specific location
vhs tape-file.tape -o custom-output.gif
```

### Batch Recording

```bash
# Record all tape files
for tape in *.tape; do
  vhs "$tape"
done
```

## Error Handling

### Common Issues

**ttyd not found**
```bash
# Install ttyd
go install github.com/aspect-build/aspect-cli/pkg/ttyd@latest
# Or via package manager
```

**ffmpeg errors**
```bash
# validate ffmpeg is installed with required codecs
ffmpeg -version
```

**Permission denied**
```bash
# Check write permissions for output directory
ls -la "$(dirname output.gif)"
```

**Empty output**
- Verify commands produce visible output
- Increase Sleep times after commands
- Check terminal dimensions fit content

### Debug Mode

```bash
# Verbose output
VHS_DEBUG=1 vhs tape-file.tape
```

## WSL2 Considerations

### Graphics Support

VHS in WSL2 may require:
- WSLg enabled (Windows 11+)
- X server for older Windows 10

### Path Handling

Use Linux-style paths in tape files:
```tape
# Correct
Output /home/user/output.gif

# Avoid Windows paths
# Output C:\Users\...
```

### Performance

WSL2 disk I/O to Windows filesystem is slow. Keep tapes and outputs on Linux filesystem:

```bash
# Good: Linux filesystem
/home/user/recordings/

# Slow: Windows mount
/mnt/c/Users/...
```

### Font Availability

Install fonts in WSL2:
```bash
sudo apt install fonts-jetbrains-mono
fc-cache -fv
```

## Output Verification

After recording:

```bash
# Check file exists and has content
ls -la output.gif

# Verify file type
file output.gif

# Check dimensions (requires ImageMagick)
identify output.gif | head -1
```

## Integration with Documentation

Move outputs to documentation directories:

```bash
# Move to docs
mv output.gif docs/images/

# Update markdown references
# ![Demo](images/output.gif)
```
