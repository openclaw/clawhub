type Color = (value: string) => string;

function wrap(start: string, end = "\x1b[0m"): Color {
  return (value) => `${start}${value}${end}`;
}

const ansi = {
  reset: "\x1b[0m",
  bold: wrap("\x1b[1m"),
  dim: wrap("\x1b[2m"),
  red: wrap("\x1b[31m"),
  white: wrap("\x1b[37m"),
};

function isColorEnabled() {
  if (!process.stdout.isTTY) return false;
  if (process.env.NO_COLOR) return false;
  return true;
}

function isErrorColorEnabled() {
  if (!process.stderr.isTTY) return false;
  if (process.env.NO_COLOR) return false;
  return true;
}

export function styleTitle(value: string) {
  if (!isColorEnabled()) return value;
  return `${ansi.bold(ansi.red(value))}${ansi.reset}`;
}

export function configureCommanderHelp(program: {
  configureHelp: (config: Record<string, (value: string) => string>) => unknown;
}) {
  if (!isColorEnabled()) return;
  program.configureHelp({
    styleTitle: (value) => ansi.bold(ansi.white(value)),
    styleCommandText: (value) => ansi.white(value),
    styleSubcommandText: (value) => ansi.bold(ansi.red(value)),
    styleOptionText: (value) => ansi.white(value),
    styleOptionTerm: (value) => ansi.white(value),
    styleArgumentText: (value) => ansi.white(value),
    styleArgumentTerm: (value) => ansi.white(value),
  });
}

export function styleEnvBlock(value: string) {
  if (!isColorEnabled()) return value;
  return `${ansi.dim(value)}${ansi.reset}`;
}

export function styleError(value: string) {
  if (!isErrorColorEnabled()) return value;
  return value.replace(/^error:/i, ansi.bold(ansi.red("error:")));
}
