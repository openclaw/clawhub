type Color = (value: string) => string;

function wrap(start: string, end = "\x1b[0m"): Color {
  return (value) => `${start}${value}${end}`;
}

const ansi = {
  reset: "\x1b[0m",
  bold: wrap("\x1b[1m"),
  dim: wrap("\x1b[2m"),
  cyan: wrap("\x1b[36m"),
  green: wrap("\x1b[32m"),
  yellow: wrap("\x1b[33m"),
};

function isColorEnabled() {
  if (!process.stdout.isTTY) return false;
  if (process.env.NO_COLOR) return false;
  return true;
}

export function styleTitle(value: string) {
  if (!isColorEnabled()) return value;
  return `${ansi.bold(ansi.cyan(value))}${ansi.reset}`;
}

export function configureCommanderHelp(program: {
  configureHelp: (config: {
    sectionTitle?: (title: string) => string;
    optionTerm?: (option: { flags: string }) => string;
    commandTerm?: (cmd: { name: () => string }) => string;
  }) => unknown;
}) {
  if (!isColorEnabled()) return;
  program.configureHelp({
    sectionTitle: (title) => ansi.bold(ansi.cyan(title)),
    optionTerm: (option) => ansi.yellow(option.flags),
    commandTerm: (cmd) => ansi.green(cmd.name()),
  });
}

export function styleEnvBlock(value: string) {
  if (!isColorEnabled()) return value;
  return `${ansi.dim(value)}${ansi.reset}`;
}
