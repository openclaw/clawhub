---
name: entry-points
description: Console scripts, GUI scripts, and plugin entry points configuration
parent_skill: python-packaging
estimated_tokens: 180
dependencies: []
---

# Entry Points

Configure console scripts, GUI applications, and plugin systems.

## Console Scripts

```toml
[project.scripts]
my-cli = "my_package.cli:main"
my-other-cmd = "my_package.other:run"
```

```python
# src/my_package/cli.py
import click

@click.command()
@click.option("--name", default="World")
def main(name: str):
    click.echo(f"Hello, {name}!")

if __name__ == "__main__":
    main()
```

## GUI Scripts

```toml
[project.gui-scripts]
my-gui = "my_package.gui:main"
```

GUI scripts are similar to console scripts but on Windows they don't open a console window.

## Plugin Entry Points

```toml
[project.entry-points."myapp.plugins"]
plugin1 = "my_package.plugins:Plugin1"
plugin2 = "my_package.plugins:Plugin2"
```

```python
# src/my_package/plugins.py
class Plugin1:
    def activate(self):
        print("Plugin 1 activated")

class Plugin2:
    def activate(self):
        print("Plugin 2 activated")
```

### Discovering Plugins

```python
# Application code to discover plugins
from importlib.metadata import entry_points

def load_plugins():
    plugins = entry_points(group="myapp.plugins")
    for plugin in plugins:
        plugin_class = plugin.load()
        instance = plugin_class()
        instance.activate()
```

## Best Practices

1. **Keep entry points simple** - Minimal logic in entry point functions
2. **Use click/argparse** - Proper argument parsing for CLI tools
3. **Handle errors gracefully** - Exit codes and error messages
4. **Support --help** - Document all CLI options
5. **Test entry points** - Verify they work when installed
